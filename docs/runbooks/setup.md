# Clean setup and environment preflight

## Local verification

1. Install Node.js 24.18.0 and npm 11.9.0. From a clean checkout, verify:

   ```bash
   node --version
   npm --version
   npm ci
   ```

2. Copy `.env.example` to an untracked local environment file and replace only
   documented placeholders. Never commit that file. Start PostgreSQL, then run:

   ```bash
   npm run db:validate
   npm run db:migration:check
   npm run verify
   npm run test:e2e
   npm run container:smoke
   ```

3. For destructive test commands, set `TEST_DATABASE_URL` to localhost and a
   database name ending in `_test`. Repository safety checks reject other
   targets.

## Staging preflight

Before provisioning or deploying, the operator must record:

- provider, project/account, region, environment name, and billing owner;
- web and API HTTPS origins on the same registrable site;
- managed PostgreSQL endpoint and tested backup policy;
- immutable image registry/repository and retention policy;
- exact trusted proxy hop count;
- Google OAuth client/callback registration;
- whether assistant and push providers are disabled or explicitly configured;
- owners for deploy, database, OAuth, AI, privacy, and incident response.

Review every variable in
[the environment contract](../deployment/environments.md). Production rejects
test authentication and fake providers. Validate configuration in a non-serving
job before allowing traffic.

## Stop conditions

Do not continue when the provider/domain is unselected, credentials would need
to be committed or exposed, the backup has no successful restore drill, the
migration check is red, more than one API replica is required, or any required
owner is absent.
