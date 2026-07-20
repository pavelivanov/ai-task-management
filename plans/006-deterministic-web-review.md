# Plan 006: Build reviews and the deterministic web execution loop

> **Executor instructions**: This is an XL vertical-slice plan. Keep each step
> independently reviewable and passing. Do not add AI placeholders that mutate
> state. Run all gates, including browser E2E, and update `plans/README.md`.
>
> **Drift check (run first)**: verify the MVP hash and inspect `apps/web`,
> `apps/api/src/modules/reviews`, contracts, and affected Prisma files. Plans
> 001–005 must be DONE; the full backend integration suite must pass.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: MED — broad UI surface, but domain rules already live on the server
- **Depends on**: `plans/004-daily-planning-carryover.md`,
  `plans/005-focus-sessions-sse.md`
- **Category**: direction / tests / UX
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

This plan delivers the first product that can validate the core hypothesis
without an LLM. It exposes the five screens at `MVP.md:718-781`, implements
local timer presentation at `MVP.md:810-841`, and turns deterministic events and
segments into the daily outcome model at `MVP.md:1173-1213`. Completion of this
plan is the earliest sensible private-pilot checkpoint.

## Current state

- The API should already support identity/preferences, tasks/inbox/backlog,
  daily planning/carryover, focus lifecycle, and SSE invalidations.
- TanStack Query owns server state. Zustand is allowed only for ephemeral UI
  drafts/modals/timer display (`MVP.md:783-808`).
- The server is authoritative for focus state. The client derives elapsed time
  from server anchors and resynchronizes on focus/reconnect/SSE.
- The Today screen must not expose the entire inbox/backlog. Focus must remain
  minimal. Review emphasizes outcomes rather than a productivity score.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API integration | `npm run test:integration --workspace apps/api` | reviews pass |
| Web tests | `npm test --workspace apps/web` | component/feature tests pass |
| Browser E2E | `npm run test:e2e` | deterministic loop passes |
| Accessibility | `npm run test:e2e -- --grep @a11y` | core screens have no serious violations |
| Full gate | `npm run verify && npm run test:e2e` | exit 0 |

## Suggested executor toolkit

- Use `frontend-skill` for coherent screen hierarchy and interaction design.
- Use `vercel-react-best-practices` for query/render boundaries.
- Use `playwright` for browser E2E and screenshots.
- Use `web-design-guidelines` for the final accessibility/UX review.

## Scope

**In scope**:

- Daily-review model/migration, contracts, API service/endpoints/tests.
- `apps/web/src/routes/**`, `features/{auth,tasks,inbox,daily-plan,focus,reviews,
  settings}/**`, API client/query setup, app shell, service worker shell only if
  required for later notification registration.
- Playwright configuration, deterministic-loop E2E fixtures, responsive and
  accessibility tests.

**Out of scope**:

- AI calls/chat/suggestions, web push delivery, proactive triggers, week review,
  advanced projects, gamification, charts/productivity score, native mobile,
  calendar/email integrations, and generalized design-system extraction.

## Git workflow

- Branch: `codex/006-deterministic-web-review`.
- Split commits by review backend, app shell/data client, each feature screen,
  and E2E suite. Use Conventional Commits.
- Do not push/open a PR unless asked.

## Steps

### Step 1: Implement deterministic daily reviews

Add `DailyReview` fields from `MVP.md:1191-1213`, unique by user/date. Generate
or upsert it from authoritative plan items, task completion events, and focus
segments when a day closes or `POST /reviews/daily/:date/generate` is invoked.
Metrics: primary outcome completed, focused minutes, planned/unplanned completed
tasks, carried-over tasks, number of sessions/interruptions as useful. Support a
user reflection and leave assistant summary nullable for Plan 007.

Generation must be idempotent and recomputable; do not copy a mutable score.
Defer weekly review.

**Verify**: API tests cover empty day, mixed planned/unplanned completion,
primary outcome, focus segments across midnight, carryover, regeneration, and
user isolation.

### Step 2: Establish authenticated SPA shell and server-state client

Add routes for login/callback, Today, Focus, Inbox, Backlog, Review, and Settings.
Create one typed HTTP client based on shared contracts and a single normalized
error shape. Configure TanStack Query cache keys by authenticated user/resource.
On logout, clear the entire private cache. Add SSE invalidation handling that
invalidates/refetches relevant queries; reconnect always refetches current
focus/today plan.

Use Zustand only for modal/form/DnD drafts. Never mirror tasks, plan, or current
focus as durable Zustand state.

**Verify**: web tests cover auth routing, 401 logout/cache clearing, typed error
rendering, SSE invalidation, and reconnect refetch.

### Step 3: Build Inbox and Backlog workflows

Inbox supports quick capture and explicit processing actions that exist on the
server: accept, schedule, archive/cancel/delete. Do not render unsupported Note
or merge actions. Backlog supports pagination and work/personal, due-soon,
postponed, blocked, and lightweight-project filters. Provide accessible create,
edit, archive, complete, and add-to-plan flows.

Use optimistic UI only for reversible ordering/presentation; lifecycle changes
wait for server acknowledgement and surface conflicts.

**Verify**: component tests cover empty/loading/error/conflict states, keyboard
operation, and query invalidation after mutations.

### Step 4: Build Today planning around constrained commitments

Render workday range, one visually dominant primary outcome, up to two
secondaries, optional queue, workload totals/warnings, planned blocks, Start,
and quick capture. Support adding from a bounded backlog search and DnD reorder
with keyboard alternative. Warnings come from coded backend data; do not
recalculate authoritative capacity differently in the client.

The Today route must never fetch/render the full inbox or unbounded backlog.

**Verify**: tests cover no-plan onboarding, draft/active/closed plans, warning
messages, ordering conflict recovery, quick capture staying in inbox, and Start.

### Step 5: Build the minimal Focus experience and robust timer

Render task title, concrete intent/action, elapsed time, start time, and only the
pause/resume, waiting, blocked, complete, stop, and distraction-capture actions.
Compute elapsed time from server-recorded focused duration/active segment and a
monotonic local presentation clock. Resync on tab focus, network reconnect, SSE,
and every command. Never POST timer ticks.

Distraction capture creates an inbox item and returns the user to focus without
navigating away. Record the focus session ID as safe event metadata if supported.

**Verify**: fake-clock tests cover active/paused/waiting/reconnect drift; mutation
conflicts display the authoritative current session; no timer-tick request is
observed.

### Step 6: Build Review and Settings screens

Review shows outcome summary, primary completion, focused time, completed
planned/unplanned work, carryovers, and reflection. Leave one bounded slot for
an AI recommendation but hide it when absent. Settings edits timezone, workday,
planning limits, notification preferences, and AI interruption level. Explain
the effect of protected hours without implementing Plan 008 behavior yet.

Avoid productivity scores and dense dashboards.

**Verify**: component tests cover empty/recomputed review, reflection save,
timezone validation, and absent assistant content.

### Step 7: Add the deterministic browser journey and accessibility gates

Use Playwright against isolated API/database fixtures. Cover:

1. fake-provider login;
2. capture two tasks and process inbox;
3. create today's plan and see an over-capacity warning;
4. start primary, pause/resume, capture distraction, wait/resume, complete;
5. close the day with unfinished secondary work;
6. confirm carryover returns to backlog and tomorrow is not auto-populated;
7. view deterministic daily review;
8. refresh mid-focus and prove timer reconciliation.

Add keyboard and automated accessibility checks for the five main screens and
responsive smoke coverage at phone/tablet/desktop widths.

**Verify**: `npm run test:e2e` passes twice consecutively from reset fixtures.

## Test plan

- Review API integration tests from Step 1.
- Web unit/component tests for every route's empty/loading/error/success and
  lifecycle conflicts.
- Timer tests use fake clocks; no real sleeps.
- Playwright journey covers the entire deterministic loop with request assertions
  ensuring no AI endpoint/key is used and no timer polling writes occur.
- Accessibility checks cover keyboard focus, landmarks, dialog focus trapping,
  names/labels, reduced motion, and contrast-critical states.

## Done criteria

- [x] A user can complete the full deterministic loop without an LLM key.
- [x] Five primary screens exist with intentional information boundaries.
- [x] TanStack Query owns server state; Zustand contains no canonical task data.
- [x] Timer survives refresh/reconnect without per-second server writes.
- [x] Daily review is deterministic, idempotent, and contains no productivity score.
- [x] E2E passes twice consecutively and core accessibility gate passes.
- [x] `npm run verify && npm run test:e2e` exit 0.
- [x] `plans/README.md` status row is updated.

## STOP conditions

- A screen requires duplicating server lifecycle rules in the client.
- Timer correctness would require per-second writes.
- Unsupported note/merge/weekly/project-management scope becomes necessary.
- Cross-origin auth topology invalidates Plan 002's cookie/CSRF assumptions.
- E2E cannot isolate/reset its database safely.
- A step requires AI to make the deterministic loop usable.

## Maintenance notes

Treat this plan's E2E journey as the permanent core regression test. Review any
new Today content against the rule that it must not become a backlog dashboard,
and any Focus content against minimalism. Extract a shared UI package only after
at least three stable, genuinely reused component patterns exist.
