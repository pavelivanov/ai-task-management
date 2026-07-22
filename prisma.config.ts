import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const developmentDatabaseUrl =
  'postgresql://execution_assistant:local-development-only@localhost:5432/execution_assistant';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: process.env.PRISMA_MIGRATIONS_PATH ?? 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? developmentDatabaseUrl,
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
