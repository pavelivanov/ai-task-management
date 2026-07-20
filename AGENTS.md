# Repository instructions

## Architecture boundaries

- Keep the system a TypeScript modular monolith. Do not add a service or queue
  boundary without an approved implementation plan.
- Put browser code in `apps/web`, HTTP orchestration in `apps/api`, runtime
  schemas in `packages/contracts`, and framework-free rules in
  `packages/domain`.
- Organize API features as NestJS modules. Export a provider only when another
  feature module imports it; do not create a global service registry.
- Route lifecycle state changes through domain services with their event writes.
  Controllers and generic patch repositories must not set lifecycle status.
- Never commit `.env`, credentials, generated output, or `.idea` metadata.

## Required commands

Use Node.js `24.18.0` and npm `11.9.0`.

```bash
npm ci
npm run db:validate
npm run db:migrate:test
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run compose:validate
npm run verify
```

Run the narrowest relevant workspace command while iterating, then run
`npm run verify` before handing off a completed change.

`npm run db:migrate:test` is destructive only to the database named by
`TEST_DATABASE_URL`; the safety script requires a localhost database ending in
`_test`. Never point integration tests at development or production data.

## Naming and tests

- Use lower-case, hyphenated feature directories and descriptive file names.
- Keep tests beside source as `*.spec.ts` or `*.test.ts`; API integration tests
  live in `apps/api/test` as `*.integration-spec.ts`.
- Add deterministic tests for every domain rule. Unit tests must not require a
  database or network.
- Every user-owned repository or service method must require `userId` from the
  authenticated request context; never accept ownership authority from a body.
- Use Conventional Commits for commit messages.
