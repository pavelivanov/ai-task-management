# Plan 001: Bootstrap the monorepo and verification baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `shasum -a 256 MVP.md`
> must print
> `3d915b094c35349f196af316567305647d0443211189ad046b0dfcb30ab5d268`.
> There is no planned-at Git SHA because `main` had no commits when this plan
> was written. If the hash differs, compare the live spec to the cited sections
> and stop if stack, scope, or phase boundaries changed.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED — scaffolding choices become conventions for every later plan
- **Depends on**: none
- **Category**: dx / architecture
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

The repository contains only the untracked specification and IDE metadata.
There is no reproducible runtime, test command, or architecture boundary. This
plan creates the smallest monorepo and quality baseline capable of supporting
the modular-monolith design in `MVP.md:22-96` and the repository shape in
`MVP.md:1428-1478`.

## Current state

- `MVP.md` — sole product/architecture source; lines 63–95 choose React/Vite,
  NestJS, Prisma, PostgreSQL, and optional Redis.
- `.idea/` — user-owned IDE metadata; leave untouched and exclude from commits.
- There is no `package.json`, lockfile, README, root `.gitignore`, CI workflow,
  application directory, or verification command.
- Local tooling observed during planning: Node `v25.6.1`, npm `11.9.0`. Node 25
  is EOL. Pin Node `24.18.0` LTS in `.nvmrc`/engines/CI, use the Node 24 runtime
  container line, and pin `npm@11.9.0` in `packageManager`.
- Current NestJS guidance supports feature modules with controllers/providers
  encapsulated by module, and explicit provider exports only when another
  module needs them. Follow that pattern; avoid a global service registry.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 from a clean checkout |
| Dev DB | `docker compose up -d postgres` | PostgreSQL container healthy |
| Format | `npm run format:check` | exit 0, no changed files |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, strict TS errors absent |
| Unit tests | `npm test` | all workspace tests pass |
| Integration | `npm run test:integration` | baseline API health test passes |
| Build | `npm run build` | web and API build artifacts produced |
| Aggregate | `npm run verify` | all non-E2E gates above pass |

## Suggested executor toolkit

- Use the `find-docs` skill/Context7 before relying on current NestJS, Vite, or
  Prisma CLI syntax.
- Use `vercel-react-best-practices` for React-specific architecture choices.
- Current NestJS module reference used during planning:
  `https://docs.nestjs.com/modules`.

## Scope

**In scope**:

- Root: `.gitignore`, `.editorconfig`, `.nvmrc` (or equivalent active-LTS pin),
  `package.json`, `package-lock.json`, `tsconfig.base.json`, ESLint/Prettier
  configuration, `README.md`, `AGENTS.md`, `.env.example`, `compose.yaml`.
- `apps/api/**` — minimal NestJS application with `/health`.
- `apps/web/**` — minimal React/Vite application with a health shell.
- `packages/contracts/**`, `packages/domain/**`, `packages/config/**`.
- `.github/workflows/ci.yml`.

**Out of scope**:

- `MVP.md` and `.idea/**`.
- Prisma domain models, authentication, task features, AI calls, Redis, queues,
  deployment-provider files, and a shared UI package.

## Git workflow

- Branch: `codex/001-bootstrap-monorepo`.
- The repository has no prior commit convention. Use Conventional Commits,
  e.g. `chore: bootstrap TypeScript monorepo`.
- Commit the lockfile. Never commit `.env` or local IDE files.
- Do not push or open a PR unless the operator asks.

## Steps

### Step 1: Create the workspace skeleton

Create a private npm-workspaces root with `apps/*` and `packages/*`. Pin Node
`24.18.0` and `npm@11.9.0` before generating the
lockfile. Scaffold a
React/TypeScript Vite SPA and NestJS API, then add small buildable packages:

- `@execution/contracts`: Zod schemas plus inferred transport types.
- `@execution/domain`: framework-free domain rules and value objects.
- `@execution/config`: shared TypeScript and lint configuration only.

Enable strict TypeScript. Keep the API organized by feature modules; export a
provider only when a second module imports it. Do not introduce Nx/Turborepo,
dependency-injection abstractions, or a UI package.

**Verify**: `npm install && npm run typecheck` → exit 0 for every workspace.

### Step 2: Establish root quality commands

Add root scripts that call each workspace with `--workspaces --if-present` and
have stable names matching the command table. Configure lint, formatting,
testing, typecheck, and production builds. Unit tests must run without a
database or network.

Create one domain smoke test, one API unit test, and one web component test so
the commands prove discovery is wired correctly rather than succeeding with
zero tests.

**Verify**: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` → all exit 0 and at least three tests run.

### Step 3: Add local PostgreSQL and environment contracts

Add `compose.yaml` with one PostgreSQL service, a named volume, health check,
and non-production credentials. Document every variable in `.env.example`
without real secrets. Add scripts to start/stop the development database, but
do not add Redis.

**Verify**: `docker compose config` → exit 0; `docker compose up -d postgres`
followed by `docker compose ps` → PostgreSQL is healthy.

### Step 4: Add application health and integration baseline

Implement `GET /health` in the API and a web shell that clearly reports the app
name and API reachability. Add an API integration test using Nest's test module;
it must not depend on production credentials. Configure CORS from an allowlist
environment variable rather than `*`.

**Verify**: `npm run test:integration` → health test returns HTTP 200 with a
stable machine-readable body.

### Step 5: Document conventions and automate CI

Write `README.md` setup/run/verify instructions and `AGENTS.md` with repository
boundaries, exact commands, naming rules, and the requirement that lifecycle
changes flow through domain services. Add CI jobs for install, format, lint,
typecheck, tests, build, and Compose configuration validation. Cache npm files,
not generated application artifacts.

**Verify**: `npm run verify` → exit 0; inspect `.github/workflows/ci.yml` and
confirm it invokes the same root commands, not duplicate hand-written variants.

## Test plan

- `packages/domain`: one pure-function smoke test.
- `apps/api`: one unit test and one integration test for `/health`.
- `apps/web`: one render test for the application shell.
- Run `npm test` and `npm run test:integration`; both must fail if their sample
  assertions are deliberately inverted, then pass after restoring them.

## Done criteria

- [ ] `npm ci` works from the committed lockfile.
- [ ] `npm run verify` exits 0 and runs nonzero tests in domain, API, and web.
- [ ] `docker compose config` exits 0 and PostgreSQL reports healthy.
- [ ] `npm run build` produces both deployable applications.
- [ ] CI calls the root verification commands.
- [ ] `git status --short` shows no `.env`, `.idea`, or generated build output.
- [ ] No Redis, AI SDK, authentication, or business-domain implementation was added.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The MVP hash differs and changes the selected stack or modular-monolith goal.
- An active Node LTS cannot support the current NestJS/Vite/Prisma toolchain.
- Scaffolding requires modifying `MVP.md` or `.idea/**`.
- A root gate cannot be made deterministic without adding feature code.
- Verification fails twice after a reasonable configuration correction.

## Maintenance notes

Keep root commands stable; every later plan and CI gate depends on them. Add a
workspace only when it represents a real boundary. If UI patterns stabilize
after Plan 006, a separate plan may extract `packages/ui`; do not preemptively
create it here.
