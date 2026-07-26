# Plan 010: Stabilize verification gates and close audit findings

> **Executor instructions**: This plan repairs verification infrastructure and
> observability gaps found by a repository audit on 2026-07-26. It adds no
> product behavior. Do not redesign features, do not change domain rules, and do
> not weaken any existing control. Every step must leave `npm run verify` green.
> Update `plans/README.md` when complete.
>
> **Drift check (run first)**: confirm Plans 001–008 are DONE and Plan 009 is
> still IN PROGRESS, run `git status --short`, then run `npm run verify` at
> least three times before changing anything so the pre-existing flake rate is
> observed rather than assumed.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: LOW — test-harness, lint, and logging changes with no product surface
- **Status**: DONE
- **Depends on**: Plans 001–008 DONE; overlaps `plans/009-release-hardening-pilot.md`
- **Category**: dx / correctness / observability
- **Planned at**: `main` at `3c9e4a2`, 2026-07-26

## Why this matters

Plan 009 requires that "all global gates in `plans/README.md` pass from a clean
checkout" before a private pilot. That criterion is not currently satisfiable in
a repeatable way: the integration suite fails roughly one run in seven for
reasons unrelated to the code under test, so a green CI run is partly luck. Two
further gaps mean the repository asserts more coverage than it has — the lint
gate skips the directory containing the release tooling, and the pilot resource
baseline reports a leak metric that cannot detect a leak.

None of these are product defects. All of them reduce the trustworthiness of the
evidence Plan 009 depends on, so they should land before Plan 009 is closed or
new feature work begins on top of them.

## Current state

Audited on 2026-07-26 at `3c9e4a2` with PostgreSQL 17 in Docker. Verified
working and explicitly **not** in scope to change: full `npm run verify` exits 0;
the security matrix covers 59 routes and 18 tables; the secret scan covers 273
files; all 13 user-owned tables cascade from `User`; every mutating route across
all 14 controllers carries `CsrfOriginGuard`; production config hard-blocks
`E2E_AUTH_ENABLED=true` and the fake assistant/push providers; the migration,
backup/restore, container-smoke, and pilot-baseline rehearsals all reproduce
their recorded numbers.

Open findings this plan addresses:

1. **Integration flake, ~15%.** Two failures in 13 full-suite runs, in two
   different suites, with two different symptoms: a 404 from
   `POST /focus/:sessionId/complete` on a route that exists with the row present,
   and `Parse Error: Expected HTTP/, RTSP/ or ICE/` on a strictly sequential
   request in `tasks-inbox`. Eight of nine suites bootstrap with `app.init()`
   only, so supertest binds and closes a fresh ephemeral port for every request.
   `apps/api/test/focus-sessions.integration-spec.ts:188` already uses
   `await app.listen(0, '127.0.0.1')` and did not fail in any observed run,
   including the runs where other suites failed. The fix is to propagate the
   pattern that suite already proves.
2. **Lint gate hole.** `npm run lint` fans out to per-workspace
   `eslint src [test]`, so `scripts/`, `e2e/`, `playwright.config.ts`,
   `prisma.config.ts`, and `apps/web/public/sw.js` are never linted.
   `eslint.config.mjs` globs `**/*.{js,mjs,cjs,ts,tsx}` and was clearly intended
   to cover them. Eleven real errors are present today.
3. **SSE retention metric measures allocation, not retention.**
   `scripts/run-pilot-resource-baseline.ts:437` takes a raw `heapUsed` delta with
   no forced collection. The observed value was 25,795,832 bytes against a
   33,554,432 threshold — 77% of budget — so the gate can fail spuriously and can
   equally hide a real leak.
4. **No diagnostic path for a 5xx.** `ApiExceptionFilter` returns a generic
   `INTERNAL_ERROR` and has no logger; `StructuredLogger.error()` keeps only
   `messageType` and `errorName`. `docs/security/observability.md` documents this
   as intentional, so the privacy property must be preserved — but an operator
   currently has no route from a production 500 to a cause.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Flake measurement | `for i in $(seq 1 10); do npm run test:integration \|\| echo FAIL; done` | 10 consecutive passes |
| Lint (after Step 2) | `npm run lint` | exit 0, covers scripts/e2e/config/sw.js |
| Baseline | `npm run pilot:resource-baseline` | exit 0 with GC-corrected heap figure |
| Full gate | `npm run verify` | exit 0 |
| Browser E2E | `npm run test:e2e` | deterministic and assistant journeys pass |

## Scope

**In scope**:

- Integration-suite bootstrap, lint script coverage and the errors it exposes.
- Heap-retention measurement in the pilot baseline harness and its recorded doc.
- A privacy-preserving error fingerprint plus its redaction test.
- Small bounded hardening items listed in Step 5.
- Doc updates for anything whose measured value or wording changes.

**Out of scope**:

- Product features, domain rules, schema changes, and new endpoints.
- Weakening or removing any existing security control, redaction rule, or gate.
- Adding Redis, a queue, or a second replica.
- Provider selection or external deployment, which remain Plan 009 STOP conditions.

## Git workflow

- Branch: `codex/010-audit-remediation`.
- Commit each step separately so a regression can be bisected to one concern.
- Do not force-push. Open a draft pull request unless told otherwise.

## Steps

### Step 1: Make the integration suite deterministic

Replace `await app.init()` with `await app.listen(0, '127.0.0.1')` in the eight
suites that still use it: `assistant-suggestions`, `auth-preferences`,
`behavior-notifications`, `daily-plans`, `daily-reviews`, `health`,
`security-privacy`, and `tasks-inbox`. `focus-sessions` is already correct and
should be left alone as the reference. Confirm each suite's `afterAll` still
calls `await app.close()` so the listener is released between files.

Do not paper over the flake with a Jest retry setting. A retry would hide the
same class of failure in CI that this step removes, and `plans/README.md` treats
integration results as release evidence.

**Verify**: ten consecutive `npm run test:integration` runs pass. Record the run
count in the pull-request description, because a single green run is not
evidence for a defect that reproduces at roughly 15%.

### Step 2: Close the lint gate and fix what it exposes

Add a root-level lint command covering the paths the workspace commands miss —
`scripts`, `e2e`, `playwright.config.ts`, `prisma.config.ts`, and
`apps/web/public` — and chain it into the root `lint` script so `npm run verify`
picks it up with no separate gate.

Then fix the eleven errors rather than suppressing them:

- `apps/web/public/sw.js` — five `no-undef` on `self`. Add a service-worker
  globals block to `eslint.config.mjs` scoped to `apps/web/public/**`; do not add
  a file-level eslint-disable.
- Five `no-console` violations in `scripts/check-migrations.ts`,
  `scripts/rehearse-migrations.ts`, `scripts/scan-secrets.mjs`,
  `scripts/smoke-production-images.mjs`, and `scripts/verify-security-matrix.mjs`.
  These are deliberate CLI success output. Either widen `sharedRules` for a
  `scripts/**` block or switch them to `process.stdout.write`. Prefer the scoped
  config block so intent stays visible.
- `scripts/run-pilot-resource-baseline.ts:424` — `cleanupStartedAt` is dead;
  `waitFor` already returns the elapsed value. Delete it.

**Verify**: `npm run lint` exits 0 and, when run against a deliberately broken
file under `scripts/`, fails. Prove the gate is live rather than merely quiet.

### Step 3: Make the SSE retention check measure retention

Force a collection before both heap samples in
`scripts/run-pilot-resource-baseline.ts` and run the harness under
`node --expose-gc`, failing fast with a clear message if `global.gc` is
unavailable so the check can never silently degrade to the current behavior.

Re-measure after the change. If the GC-corrected figure is far below the current
25.8 MB, tighten `sseHeapGrowthBytes` to a threshold that would actually catch a
regression; a 32 MiB ceiling against a genuinely retained few hundred kilobytes
is not a useful gate. Rename the reported field only if the surrounding docs are
updated in the same commit.

**Verify**: the baseline passes with the corrected measurement, and
`docs/pilot/resource-baseline.md` records the new figure, the new threshold, and
the fact that the number is now GC-corrected. State plainly in the doc that the
previously recorded 23,248,696-byte figure was uncollected allocation.

### Step 4: Give a 5xx a diagnostic handle without logging content

Preserve the documented guarantee that logs carry no exception messages, stack
traces, or user content. Add instead a stable, content-free fingerprint: hash the
normalized stack frames of an unhandled exception and log
`{ errorCode: 'INTERNAL_ERROR', errorFingerprint }` alongside the existing
request ID and route template, so repeated failures can be grouped and located in
source without exposing any payload.

`ApiExceptionFilter` currently takes no constructor dependencies and is
instantiated directly in `configureApplication`; wire it through the Nest
injector or pass the logger explicitly, and keep the fingerprint out of the HTTP
response body.

**Verify**: extend the log-capture test so a thrown error containing seeded
canary values produces a log line with a fingerprint and none of the canaries,
and so two occurrences of the same fault produce the same fingerprint while a
different fault produces a different one. Update
`docs/security/observability.md` to describe the fingerprint and restate that
message and stack content remain excluded.

### Step 5: Bounded hardening batch

Small, independent items; each needs a test:

- `DataRetentionService.expireSuggestionBatch` caps at 100 rows per sweep against
  a one-hour default interval, an effective ceiling near 2,400 expiries per day.
  Loop until the batch drains or a bounded iteration cap is hit, and record the
  chosen ceiling.
- `SlidingWindowRateLimiter.prune()` is not called on the deny path, so a key
  under sustained abuse never triggers pruning. Call it on both paths.
- `apps/web/server.mjs` answers `POST /health` with 200 because the health branch
  precedes the method check. Move the method check first.

**Verify**: unit tests for the retention drain loop and the limiter prune path;
a server test asserting `POST /health` returns 405.

### Step 6: Re-run the release evidence and update the record

With Steps 1–5 merged, re-run the migration rehearsal, backup/restore rehearsal,
container smoke, pilot baseline, `npm run verify`, and `npm run test:e2e`. Update
`docs/pilot/rehearsal-record.md` with the new date, the corrected heap figure,
and the observed integration run count.

Do not restate the previous rehearsal's numbers. The record's value is that its
figures were independently reproducible; keep that property.

**Verify**: every figure in the rehearsal record maps to a command a second
operator can run from a clean checkout.

## Test plan

- Ten consecutive integration runs, recorded, after Step 1.
- A deliberately introduced lint error under `scripts/` fails `npm run lint`.
- Baseline heap assertion passes with forced GC and fails when a retained
  listener is deliberately introduced.
- Log-capture test proves fingerprint stability and canary absence.
- Unit coverage for retention drain, limiter prune, and the web `405`.
- Full `npm run verify` and `npm run test:e2e` green.

## Done criteria

- [x] Ten consecutive `npm run test:integration` runs pass with no retry setting added.
- [x] `npm run lint` covers `scripts`, `e2e`, root configs, and `apps/web/public`, and exits 0.
- [x] The SSE heap figure is GC-corrected, its threshold is meaningful, and the doc says so.
- [x] An unhandled 5xx yields a stable fingerprint with no message, stack, or user content in logs.
- [x] Step 5 items are fixed with tests.
- [x] `docs/pilot/rehearsal-record.md` reflects a fresh run, not a restated one.
- [x] `plans/README.md` records this plan and its status.

## STOP conditions

- Step 1 does not reduce the flake rate across ten runs. The transport diagnosis
  would then be wrong; capture a failing run's server-side state and report
  rather than adding retries.
- A lint fix would require weakening a rule for `apps/api/src` or `apps/web/src`
  rather than a scoped block for tooling paths.
- The GC-corrected heap measurement reveals genuine retained growth across waves.
  That is a real leak and becomes its own investigation, not a threshold edit.
- Any change here would require relaxing a redaction rule, a security control, or
  a Plan 009 gate.

## Maintenance notes

New integration suites must bootstrap with `app.listen(0, '127.0.0.1')`; treat
`focus-sessions` as the reference. When a new top-level directory of tooling is
added, extend the root lint command in the same commit — the gap this plan closes
was created by adding `scripts/` without touching the lint script. Re-measure the
resource baseline on the selected staging provider before the pilot opens; the
local figures are host-dependent and are not a substitute for that run.
