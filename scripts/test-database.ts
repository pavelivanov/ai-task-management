import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { Client } from 'pg';

const safeDatabaseName = /^[a-zA-Z0-9_]+_test$/;

export function requireSafeTestDatabaseUrl(
  environmentVariable = 'TEST_DATABASE_URL',
): URL {
  const value = process.env[environmentVariable];
  if (!value) {
    throw new Error(`${environmentVariable} is required.`);
  }

  const url = new URL(value);
  assertSafeTestDatabaseUrl(url);
  return url;
}

export function deriveTestDatabaseUrl(baseUrl: URL, qualifier: string): URL {
  if (!/^[a-z][a-z0-9_]*$/.test(qualifier)) {
    throw new Error(`Unsafe database qualifier: ${qualifier}`);
  }

  const baseName = databaseName(baseUrl).replace(/_test$/, '');
  const derivedUrl = new URL(baseUrl);
  derivedUrl.pathname = `/${baseName}_${qualifier}_test`;
  assertSafeTestDatabaseUrl(derivedUrl);
  return derivedUrl;
}

export async function recreateTestDatabase(databaseUrl: URL): Promise<void> {
  assertSafeTestDatabaseUrl(databaseUrl);
  const name = databaseName(databaseUrl);
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name],
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

export function runPrisma(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  options: { captureOutput?: boolean } = {},
): string {
  const executable = join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
  );
  const result = spawnSync(executable, arguments_, {
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    stdio: options.captureOutput ? 'pipe' : 'inherit',
  });

  if (result.status !== 0) {
    if (options.captureOutput) {
      process.stderr.write(result.stderr ?? '');
      process.stderr.write(result.stdout ?? '');
    }
    throw new Error(
      `Prisma command failed (${String(result.status)}): prisma ${arguments_.join(' ')}`,
    );
  }

  return result.stdout ?? '';
}

function assertSafeTestDatabaseUrl(url: URL): void {
  const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (!isLocalHost || !safeDatabaseName.test(databaseName(url))) {
    throw new Error(
      'Refusing to reset a database unless it is local and its name ends in _test.',
    );
  }
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}
