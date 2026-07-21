import { defineConfig, devices } from '@playwright/test';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://execution_assistant:local-development-only@localhost:5432/execution_assistant_test';
const apiUrl = 'http://127.0.0.1:3002';
const webUrl = 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  outputDir: './output/playwright/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }],
  ],
  use: {
    baseURL: webUrl,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run start:dev --workspace apps/api',
      url: `${apiUrl}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: '3002',
        DATABASE_URL: testDatabaseUrl,
        GOOGLE_CLIENT_ID: 'e2e-google-client-id',
        GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
        GOOGLE_CALLBACK_URL: `${apiUrl}/auth/google/callback`,
        AUTH_ALLOWED_CALLBACK_URLS: `${apiUrl}/auth/google/callback`,
        WEB_APP_URL: webUrl,
        WEB_ORIGINS: webUrl,
        E2E_AUTH_ENABLED: 'true',
        SSE_HEARTBEAT_SECONDS: '1',
        ASSISTANT_PROVIDER: 'fake',
        ASSISTANT_WORKER_INTERVAL_MS: '200',
        BEHAVIOR_SCHEDULER_INTERVAL_MS: '200',
        NOTIFICATION_WORKER_INTERVAL_MS: '200',
        PUSH_PROVIDER: 'fake',
        WAITING_SUGGESTION_MINUTES: '0',
      },
    },
    {
      command:
        'npm run dev --workspace apps/web -- --host 127.0.0.1 --port 5174',
      url: webUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        VITE_API_BASE_URL: apiUrl,
        VITE_E2E_AUTH_ENABLED: 'true',
      },
    },
  ],
});
