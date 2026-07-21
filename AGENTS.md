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

## Strict worktree and Git workflow

- Perform every implementation task in a new, task-specific Git worktree based
  on the latest `main`. Read-only inspection and explanation tasks are exempt.
- Keep the primary checkout clean and checked out on `main`. Never edit, commit,
  or switch to a feature branch in the primary checkout. If an implementation
  request starts there, stop before editing and move the task to a worktree.
- Use exactly one `codex/<task-slug>` branch and one worktree per task. A
  Codex-managed detached worktree must be attached to that branch before the
  first commit. Never reuse a worktree or branch from another task.
- Run the narrowest relevant checks while iterating and `npm run verify` before
  completion. Audit the diff, stage only intended files, and create a
  Conventional Commit in the worktree.
- Do not push or open a pull request automatically when implementation is
  complete. Report the verified local commit and tell the user to invoke
  `$create-pr` (or select `create-pr` through `/skills`) when they want to
  publish it. A project-local `/create-pr` slash command is not supported.
- When `$create-pr` is invoked, follow `.agents/skills/create-pr/SKILL.md`. It
  pushes the task branch, opens a draft pull request by default, and starts the
  merge watcher. Never force-push.
- After the pull request is merged, the merge watcher must fast-forward the
  primary checkout on `main`, remove the task worktree, delete the local task
  branch, and delete the remote task branch if GitHub did not already do so. It
  must refuse destructive cleanup when either checkout has uncommitted changes
  and leave a recovery log instead.
