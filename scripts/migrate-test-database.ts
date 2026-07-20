import 'dotenv/config';

import { spawnSync } from 'node:child_process';

import { Client } from 'pg';

function requireSafeTestDatabaseUrl(): URL {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required.');
  }

  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);

  if (!isLocalHost || !/^[a-zA-Z0-9_]+_test$/.test(databaseName)) {
    throw new Error(
      'Refusing to reset a database unless it is local and its name ends in _test.',
    );
  }

  return url;
}

async function recreateDatabase(testDatabaseUrl: URL): Promise<void> {
  const databaseName = decodeURIComponent(testDatabaseUrl.pathname.slice(1));
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

function deployMigrations(testDatabaseUrl: URL): void {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl.toString(),
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error('Prisma migration deployment failed.');
  }
}

async function main(): Promise<void> {
  const testDatabaseUrl = requireSafeTestDatabaseUrl();
  await recreateDatabase(testDatabaseUrl);
  deployMigrations(testDatabaseUrl);
}

void main();
