# Plan 002: Establish persistence, identity, and user boundaries

> **Executor instructions**: Follow every step and verification gate. Stop on a
> STOP condition rather than inventing a new auth or tenancy design. Update the
> status row in `plans/README.md` when complete.
>
> **Drift check (run first)**: verify the MVP hash with `shasum -a 256 MVP.md`,
> then run `git status --short -- prisma apps/api packages/contracts`. This plan
> was written before the repository had a first commit. If Plan 001's expected
> modules or root scripts are missing, stop and complete Plan 001 first.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — authentication and query scoping protect all private data
- **Depends on**: `plans/001-bootstrap-monorepo.md`
- **Category**: security / architecture
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

Every task, prompt, and review is sensitive personal data. `MVP.md:100-120`
requires simple auth and user preferences; `MVP.md:1215-1235` requires
authenticated, user-scoped API access. Establish these boundaries before any
user-owned feature so later modules cannot accidentally grow unscoped queries.

## Current state

- Plan 001 should provide the NestJS app, shared contract package, PostgreSQL,
  environment validation, and root verification commands.
- `MVP.md:100-120` permits magic-link or Google auth. This plan deliberately
  selects Google OAuth to avoid operating transactional email in the MVP.
- The API convention is feature modules plus narrowly exported providers. Put
  database infrastructure in `DatabaseModule`, auth in `AuthModule`, and users
  in `UsersModule`; do not create a global catch-all application service.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate schema | `npm run db:validate` | Prisma schema valid |
| Migrate test DB | `npm run db:migrate:test` | fresh test DB at latest migration |
| Unit tests | `npm test --workspace apps/api` | auth/user tests pass |
| Integration | `npm run test:integration --workspace apps/api` | auth boundary tests pass |
| Full gate | `npm run verify` | exit 0 |

## Suggested executor toolkit

- Use `find-docs`/Context7 for the current Prisma and NestJS authentication
  setup before installing or calling their APIs.
- Prefer current official OAuth/OIDC guidance. Do not implement an OAuth flow
  from memory or invent token-validation rules.

## Scope

**In scope**:

- `prisma/schema.prisma`, `prisma/migrations/**`, database seed/test utilities.
- `apps/api/src/database/**`, `config/**`, `auth/**`, `users/**`, common request
  identity/authorization helpers, and related API tests.
- `packages/contracts/src/auth/**`, `packages/contracts/src/users/**`.
- Root database scripts and `.env.example` variable names.

**Out of scope**:

- Task, planning, focus, AI, and notification tables or endpoints.
- Password auth, magic links, teams, organizations, roles, API keys, and social
  providers other than Google.
- Real credentials, production deployment, or browser application screens.

## Git workflow

- Branch: `codex/002-persistence-auth` after Plan 001 lands.
- Use commits such as `feat(api): add user-scoped session authentication` and
  `test(api): cover authentication boundaries`.
- Never commit OAuth credentials or session secrets.

## Steps

### Step 1: Add Prisma lifecycle and migration gates

Configure Prisma against PostgreSQL and a singleton `PrismaService` owned by
`DatabaseModule`. Add graceful connection shutdown. Root scripts must validate
the schema and apply migrations to an isolated test database. Integration tests
must never point at development or production URLs.

**Verify**: `npm run db:validate && npm run db:migrate:test` → both exit 0 on a
fresh test database.

### Step 2: Model users, preferences, identities, and sessions

Add:

- `User`: UUID, unique normalized email, optional display name/avatar, IANA
  timezone, timestamps, soft-disabled/deletion lifecycle as needed.
- `UserPreferences`: one-to-one user relation, workday start/end local time,
  planning limits, protected-hours preferences, notification preferences, and
  AI interruption level with safe defaults.
- `AuthIdentity`: provider plus immutable provider subject, unique together;
  provider profile fields are not authoritative identity keys.
- `AuthSession`: random opaque token hash, user, expiry, created/last-used time,
  revocation time, and minimal device metadata. Never persist the raw token.

Use cascading deletion only after checking the privacy lifecycle. Store IANA
zone IDs rather than numeric UTC offsets. Validate workday start/end ordering in
the service because it is user-local data.

**Verify**: migrate a fresh test database, then run a database integration test
that creates a user, preferences, identity, and session and proves unique
constraints.

### Step 3: Implement Google OAuth and opaque cookie sessions

Implement authorization-code login with `state` validation and a configured
callback allowlist. On callback, upsert the identity/user, create a high-entropy
session, store only its hash, and issue a cookie that is `HttpOnly`, `Secure` in
production, appropriately `SameSite`, path-scoped, and expiring. Rotate the
session on login. Add logout/revocation and `GET /auth/me`.

For local and automated tests, inject a fake identity provider; do not add a
production-accessible bypass endpoint. Keep the SPA and API on a same-site
deployment topology unless a separately reviewed CSRF design is introduced.

**Verify**: integration tests cover state mismatch, callback success, duplicate
callback/upsert behavior, expired/revoked sessions, logout, and cookie flags.

### Step 4: Make authenticated user context mandatory

Add an auth guard and typed current-user decorator/context. Define a repository
or service convention where every user-owned read/write receives `userId` from
the authenticated context; request bodies may never choose the owner. Add an
Origin check or equivalent CSRF protection for cookie-authenticated mutation
requests. Return stable 401/403 error contracts without internal stack traces.

**Verify**: a two-user integration test proves user A cannot read or mutate user
B's preferences by guessing IDs; unauthenticated mutation returns 401.

### Step 5: Implement preferences API and operational hygiene

Add `GET/PATCH /users/me/preferences` with shared runtime schemas. Validate IANA
timezones, local `HH:mm` values, planning limits, notification toggles, and the
AI interruption enum. Redact cookies, OAuth tokens, and headers from logs. Add
session cleanup as an idempotent scheduled method, but do not add Redis.

**Verify**: preference contract tests cover valid updates, invalid timezone and
time ranges, unknown fields, and cross-user access; `npm run verify` exits 0.

## Test plan

- Unit: preference validation, session hashing/lookup, cookie configuration,
  OAuth-state validation.
- Integration: migration from empty DB; login callback with fake provider;
  current-user lookup; logout; expired/revoked session; two-user isolation;
  CSRF/Origin rejection; sanitized errors.
- Use a fresh isolated PostgreSQL schema/database per test run and deterministic
  clock injection for expiry tests.

## Done criteria

- [ ] `npm run db:validate`, `npm run db:migrate:test`, and `npm run verify` pass.
- [ ] No user-owned endpoint can accept `userId` as the authority for ownership.
- [ ] Raw session/OAuth tokens are absent from persisted rows and logs.
- [ ] Cookie and CSRF/Origin controls are asserted in tests.
- [ ] Cross-user access tests return not-found/forbidden without data leakage.
- [ ] No real secret appears in tracked files or test snapshots.
- [ ] No task or AI feature was added.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The chosen production topology requires cross-site cookies and there is no
  approved CSRF/token design.
- Google OAuth credentials or callback domains are unavailable for staging;
  use the fake provider only in tests and report the external blocker.
- Current provider guidance conflicts with the proposed flow.
- A feature would need a production auth-bypass route.
- A required cascade could delete audit/history data contrary to privacy rules.

## Maintenance notes

Review every future repository/service for mandatory `userId` scoping. Session
storage is intentionally database-backed for the MVP; if traffic later demands
Redis, preserve revocation and rotation semantics. Changing deployment domains
requires a focused cookie/CSRF review.
