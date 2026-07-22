import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Client } from 'pg';

import {
  deriveTestDatabaseUrl,
  recreateTestDatabase,
  requireSafeTestDatabaseUrl,
  runPrisma,
} from './test-database.js';

const migrationsDirectory = join(process.cwd(), 'prisma', 'migrations');

async function createBaselineMigrationsDirectory(): Promise<{
  baselineDirectory: string;
  migrationsRehearsed: string[];
  temporaryDirectory: string;
}> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrations.length < 2) {
    throw new Error('Migration rehearsal requires at least two migrations.');
  }

  const configuredBaseline = process.env.MIGRATION_REHEARSAL_BASELINE;
  const baselineIndex = configuredBaseline
    ? migrations.indexOf(configuredBaseline)
    : migrations.length - 2;
  if (baselineIndex < 0 || baselineIndex >= migrations.length - 1) {
    throw new Error(
      'MIGRATION_REHEARSAL_BASELINE must name an existing migration that is not the latest migration.',
    );
  }
  const migrationsRehearsed = migrations.slice(baselineIndex + 1);

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'execution-assistant-migration-rehearsal-'),
  );
  const baselineDirectory = join(temporaryDirectory, 'migrations');
  await mkdir(baselineDirectory);
  await cp(
    join(migrationsDirectory, 'migration_lock.toml'),
    join(baselineDirectory, 'migration_lock.toml'),
    { recursive: false },
  );

  for (const migration of migrations.slice(0, baselineIndex + 1)) {
    await cp(
      join(migrationsDirectory, migration),
      join(baselineDirectory, migration),
      { recursive: true },
    );
  }

  return { baselineDirectory, migrationsRehearsed, temporaryDirectory };
}

async function main(): Promise<void> {
  const testDatabaseUrl = requireSafeTestDatabaseUrl();
  const rehearsalDatabaseUrl = deriveTestDatabaseUrl(
    testDatabaseUrl,
    'migration_rehearsal',
  );
  const { baselineDirectory, migrationsRehearsed, temporaryDirectory } =
    await createBaselineMigrationsDirectory();

  try {
    await recreateTestDatabase(rehearsalDatabaseUrl);
    runPrisma(['migrate', 'deploy'], {
      DATABASE_URL: rehearsalDatabaseUrl.toString(),
      PRISMA_MIGRATIONS_PATH: baselineDirectory,
    });

    const client = new Client({
      connectionString: rehearsalDatabaseUrl.toString(),
    });
    await client.connect();

    try {
      const userId = randomUUID();
      await client.query(
        'INSERT INTO "users" ("id", "email", "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [userId, `migration-rehearsal-${userId}@example.test`],
      );

      const startedAt = performance.now();
      runPrisma(['migrate', 'deploy'], {
        DATABASE_URL: rehearsalDatabaseUrl.toString(),
      });
      const durationMilliseconds = performance.now() - startedAt;

      const preservedRow = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "users" WHERE "id" = $1',
        [userId],
      );
      const pendingLocks = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM pg_locks WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND NOT granted',
      );

      if (preservedRow.rows[0]?.count !== '1') {
        throw new Error('Sanitized rehearsal data was not preserved.');
      }
      if (pendingLocks.rows[0]?.count !== '0') {
        throw new Error('Migration deployment left pending database locks.');
      }

      console.log(
        JSON.stringify(
          {
            migrationsRehearsed,
            durationMilliseconds: Math.round(durationMilliseconds),
            sanitizedRowsPreserved: 1,
            pendingLocksAfterDeploy: 0,
          },
          null,
          2,
        ),
      );
    } finally {
      await client.end();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main();
