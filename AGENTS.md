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

## Completion and Git workflow

- Treat a successful commit, push, and pull request as mandatory parts of the
  definition of done for every completed implementation task.
- After the required verification passes, audit the diff, stage only the
  intended files, create a Conventional Commit, and push the current branch.
  If it has no upstream, set one with `git push --set-upstream origin <branch>`.
- Immediately after the push succeeds, open a pull request from the current
  branch to the repository's default branch. Create it as a draft unless the
  user explicitly requests a ready-for-review pull request.
- Do not report the work as complete while intended changes remain only in the
  working tree, only in the index, only in a local commit, or on a pushed branch
  without a pull request. If the push or pull-request creation is blocked,
  report the blocker instead of claiming completion.
- Never force-push unless the user explicitly requests it.
