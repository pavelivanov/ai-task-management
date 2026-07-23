import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const project = `execution-assistant-backup-${process.pid}`;
const composeArguments = [
  'compose',
  '--project-name',
  project,
  '-f',
  'compose.production-smoke.yaml',
];
const sourceDatabase = 'execution_assistant_smoke';
const restoredDatabase = 'execution_assistant_restore';
const databaseUser = 'execution_assistant';
const maximumDumpBytes = 50 * 1024 * 1024;

function compose(...arguments_) {
  return execFileSync('docker', [...composeArguments, ...arguments_], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
}

function postgres(arguments_, options = {}) {
  return execFileSync(
    'docker',
    [...composeArguments, 'exec', '-T', 'postgres', ...arguments_],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: maximumDumpBytes,
      ...options,
    },
  );
}

function scalar(database, sql) {
  return postgres(['psql', '-U', databaseUser, '-d', database, '-Atqc', sql], {
    encoding: 'utf8',
  }).trim();
}

function printDiagnostics() {
  console.error(`Backup rehearsal project ${project} failed.`);
  for (const arguments_ of [
    ['ps', '--all'],
    ['logs', '--no-color', '--tail', '200', 'postgres', 'migrate'],
  ]) {
    try {
      compose(...arguments_);
    } catch (error) {
      console.error(
        `Could not collect \`docker compose ${arguments_.join(' ')}\` diagnostics.`,
      );
      console.error(error);
    }
  }
}

async function rehearse() {
  const backupUserId = randomUUID();
  const postBackupUserId = randomUUID();
  const startedAt = performance.now();

  compose('up', '--detach', '--wait', '--wait-timeout', '60', 'postgres');
  compose('build', 'migrate');
  compose('run', '--rm', 'migrate');

  postgres([
    'psql',
    '-U',
    databaseUser,
    '-d',
    sourceDatabase,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO "users" ("id", "email", "updatedAt")
     VALUES ('${backupUserId}', 'backup-rehearsal-${backupUserId}@example.test', CURRENT_TIMESTAMP)`,
  ]);

  const backupStartedAt = performance.now();
  const dump = postgres([
    'pg_dump',
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '-U',
    databaseUser,
    '-d',
    sourceDatabase,
  ]);
  const backupDurationMs = performance.now() - backupStartedAt;
  if (dump.length === 0 || dump.length > maximumDumpBytes) {
    throw new Error(`Unexpected backup size: ${String(dump.length)} bytes.`);
  }

  postgres([
    'psql',
    '-U',
    databaseUser,
    '-d',
    sourceDatabase,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO "users" ("id", "email", "updatedAt")
     VALUES ('${postBackupUserId}', 'post-backup-${postBackupUserId}@example.test', CURRENT_TIMESTAMP)`,
  ]);
  postgres([
    'createdb',
    '-U',
    databaseUser,
    '--template=template0',
    restoredDatabase,
  ]);

  const restoreStartedAt = performance.now();
  const restore = spawnSync(
    'docker',
    [
      ...composeArguments,
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '-U',
      databaseUser,
      '-d',
      restoredDatabase,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      input: dump,
      maxBuffer: maximumDumpBytes,
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
  if (restore.status !== 0) {
    throw new Error(`pg_restore exited with ${String(restore.status)}.`);
  }
  const restoreDurationMs = performance.now() - restoreStartedAt;

  const sourceMigrationCount = scalar(
    sourceDatabase,
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const restoredMigrationCount = scalar(
    restoredDatabase,
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const restoredBackupUser = scalar(
    restoredDatabase,
    `SELECT COUNT(*) FROM "users" WHERE "id" = '${backupUserId}'`,
  );
  const restoredPostBackupUser = scalar(
    restoredDatabase,
    `SELECT COUNT(*) FROM "users" WHERE "id" = '${postBackupUserId}'`,
  );

  if (restoredBackupUser !== '1') {
    throw new Error('The pre-backup synthetic user was not restored.');
  }
  if (restoredPostBackupUser !== '0') {
    throw new Error('The restore unexpectedly contains post-backup data.');
  }
  if (
    sourceMigrationCount === '0' ||
    restoredMigrationCount !== sourceMigrationCount
  ) {
    throw new Error('Restored migration history does not match the source.');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        backupBytes: dump.length,
        backupDurationMs: Math.round(backupDurationMs),
        migrationCount: Number(restoredMigrationCount),
        postBackupRowsRestored: 0,
        preBackupRowsRestored: 1,
        restoreDurationMs: Math.round(restoreDurationMs),
        totalDurationMs: Math.round(performance.now() - startedAt),
      },
      null,
      2,
    )}\n`,
  );
}

let failure = null;
try {
  await rehearse();
} catch (error) {
  failure = error;
  printDiagnostics();
}
try {
  compose('down', '--volumes', '--remove-orphans');
} catch (error) {
  console.error(`Failed to clean up isolated Compose project ${project}.`);
  failure ??= error;
}
if (failure) throw failure;
