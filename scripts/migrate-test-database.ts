import 'dotenv/config';

import {
  recreateTestDatabase,
  requireSafeTestDatabaseUrl,
  runPrisma,
} from './test-database.js';

async function main(): Promise<void> {
  const testDatabaseUrl = requireSafeTestDatabaseUrl();
  await recreateTestDatabase(testDatabaseUrl);
  runPrisma(['migrate', 'deploy'], {
    DATABASE_URL: testDatabaseUrl.toString(),
  });
}

void main();
