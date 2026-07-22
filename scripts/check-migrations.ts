import 'dotenv/config';

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  deriveTestDatabaseUrl,
  recreateTestDatabase,
  requireSafeTestDatabaseUrl,
  runPrisma,
} from './test-database.js';

type ApprovedStatement = {
  migration: string;
  statement: string;
  reason: string;
};

type Allowlist = {
  approvedStatements: ApprovedStatement[];
};

const migrationsDirectory = join(process.cwd(), 'prisma', 'migrations');
const allowlistPath = join(
  process.cwd(),
  'prisma',
  'destructive-migration-allowlist.json',
);
const expectedSchemaDiffPath = join(
  process.cwd(),
  'prisma',
  'migration-schema-diff.sql',
);

const destructivePatterns = [
  /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|DATABASE|CONSTRAINT|INDEX)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i,
  /\bALTER\s+COLUMN\b[\s\S]*\bSET\s+NOT\s+NULL\b/i,
];

async function verifyDestructiveStatements(): Promise<void> {
  const allowlist = JSON.parse(
    await readFile(allowlistPath, 'utf8'),
  ) as Allowlist;
  const approved = new Map(
    allowlist.approvedStatements.map((entry) => [
      approvalKey(entry.migration, entry.statement),
      entry,
    ]),
  );
  const usedApprovals = new Set<string>();
  const migrationDirectories = await readdir(migrationsDirectory, {
    withFileTypes: true,
  });

  for (const directory of migrationDirectories) {
    if (!directory.isDirectory()) {
      continue;
    }

    const path = join(migrationsDirectory, directory.name, 'migration.sql');
    const migration = relative(migrationsDirectory, path).replaceAll('\\', '/');
    const sql = await readFile(path, 'utf8');
    const statements = sql
      .replaceAll(/--.*$/gm, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean);

    for (const statement of statements) {
      if (!destructivePatterns.some((pattern) => pattern.test(statement))) {
        continue;
      }

      const key = approvalKey(migration, statement);
      const approval = approved.get(key);
      if (!approval || approval.reason.trim().length < 20) {
        throw new Error(
          `Unreviewed destructive migration statement in ${migration}:\n${statement}\n` +
            'Add a narrowly scoped entry with a meaningful reason to prisma/destructive-migration-allowlist.json.',
        );
      }
      usedApprovals.add(key);
    }
  }

  const staleApprovals = [...approved.keys()].filter(
    (key) => !usedApprovals.has(key),
  );
  if (staleApprovals.length > 0) {
    throw new Error(
      `Stale destructive migration approvals:\n${staleApprovals.join('\n')}`,
    );
  }
}

async function verifyMigrationHistory(): Promise<void> {
  const testDatabaseUrl = requireSafeTestDatabaseUrl();
  const shadowDatabaseUrl = deriveTestDatabaseUrl(
    testDatabaseUrl,
    'migration_shadow',
  );

  await recreateTestDatabase(testDatabaseUrl);
  await recreateTestDatabase(shadowDatabaseUrl);

  const environment = {
    DATABASE_URL: testDatabaseUrl.toString(),
    SHADOW_DATABASE_URL: shadowDatabaseUrl.toString(),
  };

  runPrisma(['migrate', 'deploy'], environment);
  runPrisma(['migrate', 'status'], environment);
  runPrisma(
    [
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-config-datasource',
      '--exit-code',
    ],
    environment,
  );

  const expectedSchemaDiff = normalizeSql(
    await readFile(expectedSchemaDiffPath, 'utf8'),
  );
  const actualSchemaDiff = normalizeSql(
    runPrisma(
      [
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema',
        'prisma/schema.prisma',
        '--script',
      ],
      environment,
      { captureOutput: true },
    ),
  );
  if (actualSchemaDiff !== expectedSchemaDiff) {
    throw new Error(
      'Prisma schema and migration history differ from prisma/migration-schema-diff.sql. ' +
        'Add or correct the migration; update the baseline only for a reviewed, intentional representation difference.',
    );
  }
}

function normalizeStatement(statement: string): string {
  return statement.replaceAll(/\s+/g, ' ').trim();
}

function approvalKey(migration: string, statement: string): string {
  return `${migration}:${normalizeStatement(statement)}`;
}

function normalizeSql(sql: string): string {
  return sql.replaceAll('\r\n', '\n').trim();
}

async function main(): Promise<void> {
  await verifyDestructiveStatements();
  await verifyMigrationHistory();
  console.log('Migration history and destructive-change safeguards passed.');
}

void main();
