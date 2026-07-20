process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://execution_assistant:local-development-only@localhost:5432/execution_assistant_test';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/auth/google/callback';
process.env.AUTH_ALLOWED_CALLBACK_URLS =
  'http://localhost:3000/auth/google/callback';
process.env.WEB_APP_URL = 'http://localhost:5173';
process.env.WEB_ORIGINS = 'http://localhost:5173';
process.env.SSE_HEARTBEAT_SECONDS = '1';
