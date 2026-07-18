# Plan 003: Implement task lifecycle, inbox, and append-only history

> **Executor instructions**: Follow each step and gate. All status changes must
> go through the domain transition service and an atomic event write. Stop if a
> required transition is ambiguous. Update `plans/README.md` when done.
>
> **Drift check (run first)**: verify `MVP.md` has the planned SHA-256 and run
> `git status --short -- prisma apps/api packages/domain packages/contracts`.
> Confirm Plans 001–002 are DONE and `npm run verify` passes before editing.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — every later workflow depends on lifecycle correctness
- **Depends on**: `plans/002-persistence-auth.md`
- **Category**: correctness / architecture / tests
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

Tasks are the central aggregate. `MVP.md:122-194` separates captured inbox
thoughts from accepted backlog work, while `MVP.md:342-387` requires append-only
history and `MVP.md:1062-1118` defines explicit transitions. Centralizing these
rules prevents controllers, AI handlers, and future jobs from creating invalid
states or losing history.

## Current state

- Plans 001–002 should provide strict TypeScript, Zod transport contracts,
  Prisma transactions, authenticated user context, and isolated integration DBs.
- The permitted task statuses are `inbox`, `backlog`, `planned`, `in_progress`,
  `waiting`, `blocked`, `completed`, `cancelled`, and `archived`.
- Event history is additive, not event sourcing. Current state lives on `Task`;
  `TaskEvent` records meaningful changes in the same transaction.
- Inbox-to-note is deferred because the spec defines no Note entity. Complex
  dependencies are excluded. Keep only a lightweight optional project grouping.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Domain tests | `npm test --workspace packages/domain` | transition matrix passes |
| API tests | `npm test --workspace apps/api` | task services pass |
| Integration | `npm run test:integration --workspace apps/api` | task/inbox API passes |
| Migration | `npm run db:migrate:test` | fresh DB migrated |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope**:

- Task/project/event Prisma models and migrations.
- `packages/domain/src/tasks/**` lifecycle rules and value objects.
- `packages/contracts/src/tasks/**`, `inbox/**`, `projects/**`.
- `apps/api/src/modules/tasks/**`, `inbox/**`, `projects/**` and tests.

**Out of scope**:

- Daily-plan rows, focus sessions, AI decomposition, notes, dependency graphs,
  attachments, recurring tasks, full-text search, and browser UI.
- Direct task-status writes from controllers or generic patch repositories.

## Git workflow

- Branch: `codex/003-tasks-inbox-history`.
- Suggested commits: `feat(domain): define task lifecycle`, `feat(api): add
  task and inbox modules`, `test(api): cover atomic task history`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define the task aggregate and transition matrix

In `packages/domain`, define enums and an exhaustive transition function. Match
the graph at `MVP.md:1062-1118`; also define terminal-state rules and the exact
conditions for reopening (none in MVP). The function returns a typed result or
domain error; it never mutates persistence. Reject no-op and unsupported
transitions. Treat title/category/priority/estimate/due date validation as value
rules shared with contracts.

**Verify**: table-driven tests cover every allowed edge and representative
rejected edge; an exhaustive enum assertion fails when a status is added without
updating the matrix.

### Step 2: Add Task, TaskEvent, and minimal Project persistence

Model `Task` fields from `MVP.md:128-162`, adding `carryoverCount` default 0 for
Plan 004 and optional `projectId`/`parentTaskId`. Model a lightweight `Project`
with user owner, name, color/label, archived timestamp, and uniqueness sensible
for one user. Model `TaskEvent` with user/task/type, JSON metadata, timestamp,
and indexes for task history and per-user recent events.

Use database enums where migration ergonomics remain acceptable. Add ownership
relations and deletion behavior that satisfies privacy deletion later. Do not
add task-dependency tables.

**Verify**: fresh migration succeeds; constraint tests reject cross-user parent
or project association at the service boundary and invalid self-parenting.

### Step 3: Implement the atomic lifecycle service

Create `TaskLifecycleService.transition({ taskId, userId, to, reason,
metadata })`. Inside one transaction, load the user-scoped task, validate the
current `from` state, update current fields/timestamps, and append exactly one
matching event. Handle concurrent writes using optimistic versioning or a
transaction/isolation strategy; a losing transition must return a conflict and
must not append an event.

Creation writes `created`. Field changes write `updated` or
`estimate_changed` with only safe, minimal metadata. Completion sets
`completedAt`; leaving completion is not supported. Events are never patched or
deleted by normal feature endpoints.

**Verify**: integration tests prove atomic rollback, exactly-one event, stale
concurrent transition conflict, completed timestamp, and append-only API access.

### Step 4: Implement task, project, and backlog endpoints

Implement shared-contract-validated endpoints from `MVP.md:990-1005`: create,
list/filter/paginate, get, safe patch, delete, archive, complete, and history.
Add minimal project create/list/update/archive for the backlog filter; do not add
project planning. Every query is user-scoped. Pagination has a bounded maximum.
Deletion is hard delete for now only when no later protected history exists;
otherwise return an explicit conflict or perform the privacy-safe cascade.

**Verify**: API integration tests cover validation, pagination, filters, 404
without cross-user leakage, lifecycle delegation, and stable error contracts.

### Step 5: Implement inbox capture and processing

`POST /inbox/capture` creates a task with status `inbox` and a `created` event.
`GET /inbox` returns only authenticated user's inbox tasks, paginated oldest
first. `POST /inbox/:id/process` accepts a discriminated action:

- `accept` → backlog;
- `archive` → archived;
- `cancel` → cancelled;
- `delete` → privacy-safe delete.

Reserve contract variants for `schedule` and `decompose` only when their owning
plans implement them. Do not claim support for note conversion or merge yet.

**Verify**: integration tests cover all actions, invalid action/status pairs,
idempotent client retry behavior, and two-user isolation.

## Test plan

- Domain: full transition matrix, terminal states, invalid values, exhaustive
  enum coverage.
- Persistence: migrations, constraints, user ownership, parent cycles at least
  self-reference rejection, event indexes/query order.
- Integration: task CRUD, filters/pagination, exact event sequence, rollback,
  concurrency conflict, inbox processing, cross-user denial.
- Model tests after the authenticated preference integration tests from Plan
  002; reuse its isolated DB and fake clock patterns.

## Done criteria

- [ ] All status updates occur only inside `TaskLifecycleService`.
- [ ] Every meaningful mutation and its event commit atomically.
- [ ] `TaskEvent` has no normal update/delete endpoint.
- [ ] All list endpoints are paginated and user-scoped.
- [ ] Full transition and concurrent-transition tests pass.
- [ ] `npm run db:migrate:test && npm run verify` exit 0.
- [ ] No note, dependency, AI, plan, focus, or recurring-task feature was added.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The live task transition graph differs from `MVP.md:1062-1118`.
- A transition requires direct controller status writes.
- Cross-user project/parent integrity cannot be guaranteed in service tests.
- Privacy-safe delete semantics require an unplanned retention product decision.
- Concurrency cannot be tested against PostgreSQL.

## Maintenance notes

New task statuses or event types require an exhaustive domain-test update and a
migration/compatibility review. Plan 004 extends lifecycle side effects for plan
items; Plan 005 extends them for focus sessions. Keep orchestration in owning
services while preserving `TaskLifecycleService` as the single transition gate.
