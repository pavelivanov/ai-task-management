# Plan 004: Implement daily planning, capacity warnings, and carryover

> **Executor instructions**: Execute in order and run every gate. Daily close is
> a transactional domain operation, not a controller loop. Stop on ambiguity;
> update `plans/README.md` when done.
>
> **Drift check (run first)**: verify the `MVP.md` SHA-256, then run
> `git status --short -- prisma apps/api packages/domain packages/contracts`.
> Plans 001–003 must be DONE and `npm run verify` must pass.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — timezone and close-day bugs corrupt commitments/history
- **Depends on**: `plans/003-tasks-inbox-history.md`
- **Category**: correctness / architecture / tests
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

The product hypothesis depends on limiting daily commitments without silently
rescheduling unfinished work. `MVP.md:196-257` defines daily plans and soft
capacity limits; `MVP.md:1120-1149` defines explicit carryover. This plan makes
those rules deterministic, timezone-safe, auditable, and independently useful
before any AI is introduced.

## Current state

- Plan 003 should provide user-scoped tasks, a central lifecycle service,
  append-only events, fake-clock tests, and PostgreSQL integration tests.
- A task is independent of a date. Scheduling creates `DailyPlanItem`; it never
  writes planned time fields onto `Task` (`MVP.md:164-170`).
- The “one primary/up to two secondary/available time” constraints are warnings,
  not database rejections (`MVP.md:236-257`).
- The user's IANA timezone and local workday preferences come from Plan 002.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Domain tests | `npm test --workspace packages/domain` | planning math/carryover pass |
| API tests | `npm test --workspace apps/api` | planning services pass |
| Integration | `npm run test:integration --workspace apps/api` | plan API and close pass |
| Full gate | `npm run db:migrate:test && npm run verify` | exit 0 |

## Scope

**In scope**:

- Daily-plan/item Prisma models, indexes, migrations.
- `packages/domain/src/daily-plans/**` capacity, ordering, local-date rules.
- Daily-plan contracts and `apps/api/src/modules/daily-plans/**`.
- Task lifecycle/event integration needed for schedule, unschedule, completion,
  and carryover.

**Out of scope**:

- Calendar synchronization, recurring tasks, week/month planning, hard time-slot
  collision rejection, AI plan suggestions, focus sessions, and browser UI.
- Automatically placing unfinished tasks on tomorrow's plan.

## Git workflow

- Branch: `codex/004-daily-planning-carryover`.
- Commit examples: `feat(domain): add daily planning rules`, `feat(api): close
  daily plans with carryover`, `test(api): cover timezone boundaries`.
- Do not push/open a PR unless asked.

## Steps

### Step 1: Define daily-plan models and local-date semantics

Add `DailyPlan` and `DailyPlanItem` from `MVP.md:196-234`. Enforce one plan per
user/local date and one item per task per plan. Store the plan date as a date,
workday times as local-time values, and scheduled instants consistently in UTC.
Snapshot workday start/end onto each plan so later preference changes do not
rewrite history. Add indexes for today's plan, ordered items, and task history.

Do not add a unique constraint on primary role because limits are explicitly
soft warnings. Reject writes to a closed plan.

**Verify**: migration and integration tests prove uniqueness, stable history,
closed-plan immutability, and correct local-date selection around UTC midnight.

### Step 2: Implement pure capacity and warning rules

In `packages/domain`, implement:

- available minutes from local workday start/end;
- scheduled minutes from explicit planned duration, falling back to task estimate
  only when present;
- role counts and stable item ordering;
- warnings for multiple primaries, more than two secondaries, missing estimates,
  and meaningful over-capacity.

Use configurable thresholds with defaults, not magic values in controllers.
Warnings must include codes and data, with presentation text composed in the UI.

**Verify**: table-driven tests cover empty plans, exact capacity, over-capacity,
unknown estimates, overnight/invalid workday bounds, and role limits.

### Step 3: Implement today-plan commands and queries

Implement the endpoints at `MVP.md:1015-1028`: get/create/update today, add,
patch/reorder/remove items, and close. Resolve “today” using authenticated user
timezone and an injected clock. Adding an inbox/backlog task may transition it
to `planned` and append `scheduled`; removing the task appends `unscheduled` and
returns it to backlog only if it is not planned elsewhere and not active.

Return the plan plus computed warnings after every mutation. Use optimistic
versioning or transaction conflict handling for concurrent reorder/edits.

**Verify**: integration tests cover create idempotency, item operations,
concurrent reorder conflict, warning payloads, and two-user isolation.

### Step 4: Implement atomic close and carryover

Close a day in one service transaction:

1. reject an already closed plan idempotently or return its existing result;
2. reject close with an active focus session once Plan 005 exists (leave an
   explicit integration seam/test placeholder now);
3. keep all plan items attached to the historical plan;
4. mark completed items from authoritative task completion data;
5. transition each unfinished planned/in-progress/waiting/blocked task to
   backlog according to explicit orchestration rules;
6. increment `carryoverCount` and append one `carried_over` event per unfinished
   task with source plan/date metadata;
7. set plan status/closed time;
8. return carryover threshold signals (2 warning, 3 diagnosis, 5 explicit-choice
   requirement) from configuration.

Never create tomorrow's plan or item. A task already completed/cancelled/archived
must not be carried. On any failure, roll back every task/event/plan change.

**Verify**: integration tests prove exact event/count changes, no tomorrow row,
idempotent retry, closed-history preservation, mixed-status handling, and full
rollback on injected failure.

### Step 5: Extend inbox processing with scheduling

Activate the `schedule` action on `POST /inbox/:id/process`. It must delegate to
the daily-plan service, not duplicate plan/task transitions. Accept explicit
plan date/role/duration/position and return the same warnings as a direct add.

**Verify**: tests cover inbox → today's plan, future-date draft plan, invalid
closed plan, and retry without duplicate item/event.

## Test plan

- Pure domain tests: capacity math, warnings, ordering, local date/DST behavior,
  configurable carryover thresholds.
- Integration: migrations; CRUD/reorder; schedule/unschedule event sequence;
  concurrent edits; close-day atomicity/idempotency; no automatic tomorrow plan;
  user isolation.
- Use parameterized timezone cases including UTC, a positive offset, a negative
  offset, and daylight-saving transition zones.

## Done criteria

- [ ] Tasks contain no planned start/date fields.
- [ ] Plan mutations return coded soft warnings rather than hard role/capacity errors.
- [ ] Close preserves historical items and never auto-schedules tomorrow.
- [ ] Carryover events/counts are atomic and idempotent.
- [ ] “Today” is derived from user timezone with an injected clock.
- [ ] All domain/integration tests and `npm run verify` pass.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- Plan 003 exposes no safe orchestration path for lifecycle + event writes.
- The product changes soft role/capacity limits into hard constraints.
- Close-day behavior with active focus is implemented before Plan 005 without a
  documented seam for its later guard.
- Timezone tests cannot run deterministically.
- Supporting a requested behavior would auto-populate tomorrow's plan.

## Maintenance notes

Calendar integration, breaks, and scheduling conflicts will change capacity
calculation; keep it pure and versionable. Review any new task terminal state in
carryover tests. Plan 007 consumes coded warnings and carryover signals—do not
embed AI-facing prose in this domain module.
