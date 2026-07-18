# Plan 005: Enforce focus-session invariants and reliable time tracking

> **Executor instructions**: The database invariant and transactional tests are
> mandatory. Do not substitute a frontend check. Run every gate and update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**: verify the MVP hash and inspect changes under
> `prisma`, `apps/api`, `packages/domain`, and `packages/contracts`. Plans
> 001–004 must be DONE and passing.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — races can create two active tasks or corrupt focus duration
- **Depends on**: `plans/003-tasks-inbox-history.md`,
  `plans/004-daily-planning-carryover.md`
- **Category**: correctness / performance / tests
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

Protecting one active focus task is the product's strongest invariant.
`MVP.md:259-318` explicitly requires server/database enforcement, while
`MVP.md:810-841` rejects per-second server updates. This plan implements atomic
session transitions, explicit timing segments, reconnection-safe queries, and
SSE invalidation without introducing WebSockets or Redis.

## Current state

- Task transitions and events must go through Plan 003's lifecycle service.
- Today's plan and item completion/carryover belong to Plan 004.
- `FocusSession` statuses are active, paused, waiting, blocked, completed, and
  stopped. A task may have many sessions; only one session with status `active`
  may exist per user.
- Explicit `FocusSessionSegment` rows are selected even though optional in
  `MVP.md:970-988`, because analytics requires reliable durations.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Domain tests | `npm test --workspace packages/domain` | focus state machine passes |
| API tests | `npm test --workspace apps/api` | service tests pass |
| Integration | `npm run test:integration --workspace apps/api` | concurrency/API/SSE pass |
| Full gate | `npm run db:migrate:test && npm run verify` | exit 0 |

## Scope

**In scope**:

- Focus-session and segment Prisma models, migration SQL, indexes.
- `packages/domain/src/focus/**` transitions and duration calculations.
- Focus contracts, API module/endpoints, and SSE invalidation endpoint.
- Narrow task/plan orchestration needed for start/wait/block/complete.
- Reconciliation of Plan 004's close-day active-session guard.

**Out of scope**:

- Frontend timer, browser notifications, waiting-task recommendations, WebSocket,
  Redis/pub-sub, collaboration, automatic idle detection, and AI.

## Git workflow

- Branch: `codex/005-focus-sessions-sse`.
- Suggested commits: `feat(db): enforce one active focus session`, `feat(api):
  add focus lifecycle`, `test(api): race concurrent focus starts`.
- Never weaken a DB constraint to make a test pass.

## Steps

### Step 1: Model sessions, segments, and the partial unique index

Add the focus models from `MVP.md:259-284` and segment model from
`MVP.md:970-988`. Each segment has a type (`focused`, `paused`, `waiting`), start,
and optional end. Add a hand-authored PostgreSQL partial unique index equivalent
to:

```sql
CREATE UNIQUE INDEX one_active_session_per_user
ON focus_sessions (user_id)
WHERE status = 'active';
```

Also index user/status and task/start time. Document why the raw migration SQL
must survive future Prisma migrations.

**Verify**: database tests issue two concurrent active inserts for one user and
prove exactly one succeeds; different users both succeed.

### Step 2: Define exhaustive focus transitions and timing rules

Define legal session transitions and segment effects in `packages/domain`:

- start → active + open focused segment;
- active → paused/waiting/blocked/completed/stopped, closing focused segment;
- paused/waiting/blocked → active only after the one-active check, closing prior
  segment and opening focused;
- waiting may own an open waiting segment; blocked has no focused time;
- terminal sessions cannot resume.

Duration is the sum of closed focused segments plus the current active segment
to an injected `now`. Reject negative/overlapping segments.

**Verify**: table-driven transition and duration tests cover repeated commands,
clock skew, open segments, and terminal states.

### Step 3: Implement transactional focus commands

Implement endpoints from `MVP.md:1030-1041`. Each command must lock/check the
user's current session, change focus session/segments, transition the task using
the lifecycle service, append the correct event, and update today's plan item on
completion in one transaction. Map the DB unique violation to HTTP 409 with the
authoritative current session.

Starting an inbox task is invalid. Starting backlog/planned is allowed; starting
personal work during protected hours is handled in Plan 008. Resume from waiting
or blocked moves the task back to in-progress. Complete records an outcome and
task completion; stop returns unfinished work to backlog unless an explicit
valid state is supplied.

**Verify**: integration tests cover every command, exact events/segments, retry
idempotency, task/plan side effects, injected rollback, and concurrent start or
resume races.

### Step 4: Make current state and close-day behavior authoritative

`GET /focus/current` returns the current active session, timing anchors, task
summary, and server timestamp; it does not stream a ticking duration. Browser
reconnects will recompute locally. Update daily-plan close to return 409 while a
session is active, including a safe current-session summary.

**Verify**: reconnect/current-state tests calculate the same elapsed focus time
as the server within a clock-tolerance; close-day tests reject active and accept
paused/waiting/blocked according to documented product rules.

### Step 5: Add SSE invalidation events

Add an authenticated SSE endpoint for coarse events such as
`focus.changed`, `plan.changed`, and later `suggestion.changed`. Events carry an
ID, type, occurred time, and resource ID/version only—never full sensitive task
or prompt content. Send heartbeat comments, handle disconnect cleanup, and bound
per-process subscriber resources. The client is expected to refetch HTTP state.

For the MVP's single API instance, an in-process event publisher is acceptable.
Document that multiple replicas require shared pub/sub later.

**Verify**: integration test subscribes, performs a focus command, receives one
invalidation, refetches current state, and confirms listener cleanup on abort.

## Test plan

- Domain: full transition table, segment validation, focused-minute math.
- Database: partial unique index under actual concurrent PostgreSQL writes.
- Integration: start/pause/resume/wait/block/complete/stop; current state;
  idempotency; rollback; two-user isolation; task/plan/event effects; SSE cleanup.
- Add at least one test with two API requests racing at a synchronization barrier,
  not merely sequential duplicate calls.

## Done criteria

- [ ] PostgreSQL, not only application code, prevents two active sessions/user.
- [ ] Focus duration derives from segments; no per-second writes exist.
- [ ] Focus/task/event/plan changes are atomic.
- [ ] `GET /focus/current` supports reconnect and clock reconciliation.
- [ ] SSE sends content-minimized invalidations and cleans up subscribers.
- [ ] Daily close rejects an active session deterministically.
- [ ] All concurrency and verification gates pass.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- Prisma migration generation removes or cannot preserve the partial index.
- Cross-module transaction composition cannot use one PostgreSQL transaction.
- Product behavior for closing a day with paused/waiting/blocked work changes.
- SSE requires multiple replicas before a shared pub/sub decision is made.
- A design requires timer writes every second.

## Maintenance notes

Any new focus status requires updates to the DB partial-index predicate, domain
transition table, segment accounting, and race tests. Multi-replica deployment
must add shared invalidation delivery or sticky single-instance semantics; do
not assume the in-process publisher crosses instances.
