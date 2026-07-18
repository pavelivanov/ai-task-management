# Plan 008: Add proactive behavior support and browser notifications

> **Executor instructions**: Proactive behavior is deterministic and bounded.
> A trigger may enqueue a specific suggestion/notification; it may not let an
> LLM decide when to interrupt. Run every gate and update `plans/README.md`.
>
> **Drift check (run first)**: verify the MVP hash and inspect assistant,
> notification, preference, focus, and service-worker paths. Plans 001–007 must
> be DONE and passing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED — timezone/DST, duplicate jobs, and push permission are fragile
- **Depends on**: `plans/006-deterministic-web-review.md`,
  `plans/007-ai-suggestions-evals.md`
- **Category**: direction / correctness / UX
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

The MVP should support focus at specific moments without becoming noisy.
`MVP.md:622-659` requires deterministic triggers; `MVP.md:861-905` limits useful
notifications; `MVP.md:1151-1171` defines protected work hours. This plan adds
those supports with explicit eligibility, deduplication, quiet behavior, and
user control.

## Current state

- Plan 002 stores timezone/workday/notification/interruption preferences.
- Plans 004–006 expose planning, carryover, focus, review, SSE, and the SPA.
- Plan 007 exposes typed suggestions and a durable DB-backed worker.
- Distraction capture already creates an inbox task from Focus. This plan adds
  provenance/reporting, not a second capture system.
- Reliable “user idle” detection is not defined by the spec. Do not infer it from
  a long-running session or add invasive activity tracking; defer that trigger.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Domain/API tests | `npm test` | trigger/work-hours tests pass |
| Integration | `npm run test:integration --workspace apps/api` | scheduler/push tests pass |
| Browser E2E | `npm run test:e2e -- --grep @behavior` | permission/confirm flows pass |
| Full gate | `npm run verify && npm run test:e2e` | exit 0 |

## Suggested executor toolkit

- Use `find-docs` for current Service Worker, Push API, web-push, and NestJS
  scheduling APIs before implementation.
- Use `playwright` for notification-permission UI and protected-hours flows.

## Scope

**In scope**:

- Assistant-trigger, notification, and push-subscription models/migrations.
- Pure protected-hours, trigger eligibility, dedupe, and scheduling rules.
- API trigger scheduler, notification service/push gateway, endpoints/tests.
- Service Worker/push registration, contextual permission UI, notification
  center/read state, waiting suggestions, protected-hours confirmation.
- Distraction and estimate-vs-actual reporting refinements.

**Out of scope**:

- Arbitrary AI messages, idle surveillance, mobile/native push, email/SMS,
  WebSockets, Redis/BullMQ, calendar synchronization, generic motivation,
  recurring-task engine, weekly summaries, and autonomous task starts.

## Git workflow

- Branch: `codex/008-behavior-notifications`.
- Commit by rules, scheduler, push delivery, and web UX. Never commit VAPID
  private keys or real push endpoints in fixtures.

## Steps

### Step 1: Implement protected-work-hour eligibility

Build a pure service using user IANA timezone, local workday, category, explicit
urgent override, and planned personal-admin blocks. During protected hours:

- exclude personal tasks from automatic/waiting suggestions;
- starting personal work returns a warning requiring explicit Start anyway,
  Schedule after work, or Cancel;
- allow urgent override and planned personal-admin exceptions;
- never make this a hard database prohibition.

Use injected clocks and timezone-safe libraries already selected by the repo.

**Verify**: table-driven tests cover inside/outside, DST boundaries, overnight
workday invalidity, category, urgent override, and planned exception.

### Step 2: Model deterministic triggers with deduplication

Add `AssistantTrigger` with type, user, related resource/date, status, eligible/
fired/resolved timestamps, dedupe key, and outcome. Implement explicit rules for:

- morning plan missing;
- estimate exceeded;
- task repeatedly carried (threshold signals from Plan 004);
- current task waiting (at least configured 5 minutes and no active session);
- end-of-day review;
- plan over capacity.

Each rule produces a bounded action type and prompt template, or a plain
notification. Do not implement `focus_session_idle` until a privacy-reviewed,
reliable signal exists. Use unique dedupe keys so scheduler retries do not spam.

**Verify**: eligibility/property tests and concurrent scheduler tests prove one
trigger per user/resource/window and correct reset/resolution.

### Step 3: Add waiting-state short-task suggestions

When a focus task has waited at least the threshold and no active session exists,
select up to three eligible short backlog/optional-plan tasks using deterministic
filters: estimate fits expected wait, protected-hours rules, no blocked/cancelled
task, user ownership, stable priority/due ordering. AI may explain the list but
cannot add candidates or start them. The user explicitly starts one.

**Verify**: tests cover no eligible tasks, work/personal filtering, more than
three candidates, stale waiting session, and explanation disabled/unavailable.

### Step 4: Implement notification records and idempotent scheduling

Add `Notification` from `MVP.md:886-905` plus delivery status/attempt fields, and
`PushSubscription` with user ownership, endpoint fingerprint/uniqueness, keys
stored as sensitive data, created/last-used/revoked timestamps. Use the existing
DB worker/lease pattern for morning reminders, due risk, repeated carryover,
waiting, and end-of-day review. Scheduling uses user timezone and recomputes
future occurrences after preference/timezone changes.

Do not send generic motivation, every AI message, or every scheduled start.

**Verify**: scheduler tests cover DST, restart lease recovery, duplicate run,
preference opt-out, timezone change, and revoked/expired subscriptions.

### Step 5: Add the push gateway and browser permission UX

Implement a gateway interface with fake test transport and Web Push/VAPID
production adapter. Treat 404/410 endpoints as revocation; back off transient
failures; never log subscription keys or task bodies. Payloads are minimal and
deep-link to an authenticated route that refetches content.

Register the Service Worker and request permission only after a user enables a
specific benefit in Settings or an in-context prompt. Support denial gracefully;
the in-app notification record remains available. Add subscribe/unsubscribe and
mark-read endpoints with CSRF/user-scoping controls.

**Verify**: integration/browser tests cover contextual prompt, grant/deny,
subscribe/unsubscribe, fake delivery, click/deep-link, 410 cleanup, and logout.

### Step 6: Add distraction and estimate-learning feedback

Tag focus-time captures with safe source metadata so Review can count
interruptions without storing sensitive text in telemetry. Compare estimates
with actual focused minutes and display a small factual reflection; do not
automatically rewrite future estimates or create a productivity score.

**Verify**: review tests cover distraction count and estimate/actual calculation
for multiple segments while preserving the existing deterministic metrics.

## Test plan

- Pure tests: protected hours, trigger eligibility/dedupe, candidate selection,
  timezone/DST scheduling, estimate comparisons.
- PostgreSQL integration: concurrent trigger/schedule claims, retries, delivery
  state, subscription ownership/revocation, preference changes.
- Browser: permission requested contextually, denial fallback, protected-personal
  confirmation, waiting suggestion start, notification deep link.
- All clocks, workers, AI, and push gateways are fake/injected in CI.

## Done criteria

- [ ] Trigger timing/eligibility is deterministic and auditable.
- [ ] No user receives duplicate notification for the same dedupe window.
- [ ] Protected hours warn/filter but preserve explicit user override.
- [ ] Waiting suggestions contain at most three deterministically eligible tasks.
- [ ] Push permission is contextual; denial leaves the app functional.
- [ ] Subscription secrets/task content are absent from logs.
- [ ] No idle surveillance, Redis, or generic motivational spam was added.
- [ ] Full verification and behavior E2E pass.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The required browser targets do not support the chosen Push/Service Worker flow.
- Push delivery requires logging or exposing subscription secret material.
- The deployment topology cannot serve a secure Service Worker scope.
- A trigger cannot be expressed as a deterministic, testable condition.
- Stakeholders request idle detection without defining signal/privacy behavior.
- Multiple API replicas make the current DB worker/in-process SSE assumptions invalid.

## Maintenance notes

Audit notification usefulness and opt-out rates before adding trigger types.
Timezone/preference changes must invalidate future schedules. If the API scales
to multiple replicas, preserve DB claim/dedupe semantics and add shared SSE
delivery; do not merely run more uncoordinated cron instances.
