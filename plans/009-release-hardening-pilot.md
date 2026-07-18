# Plan 009: Harden privacy, operations, deployment, and pilot readiness

> **Executor instructions**: This is a release gate, not permission to redesign
> the product. Verify controls with tests and a staging rehearsal. Provider-
> specific deployment requires an operator choice; stop rather than guessing.
> Update `plans/README.md` when complete.
>
> **Drift check (run first)**: verify the MVP hash, run `git status --short`, and
> confirm Plans 001–008 are DONE. Run the complete verification suite before
> changing infrastructure so pre-existing failures are not misattributed.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — release configuration protects sensitive user and AI data
- **Depends on**: Plans 001–008
- **Category**: security / dx / deployment / docs
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

The feature loop is not pilot-ready until deletion, rate limits, logging,
migration safety, health signals, backups, and environment separation are proven.
`MVP.md:1215-1284` states the minimum privacy/deployment/CI requirements. This
plan converts those requirements into machine-checked gates and runbooks while
keeping the runtime a simple one-API/one-database modular monolith.

## Current state

- Plans 001–008 should already include user scoping, session security, prompt-log
  minimization, AI endpoint limits, append-only audit events, container-buildable
  apps, CI, PostgreSQL, and DB-backed background work.
- The deployment provider is intentionally not selected by `MVP.md`; frontend
  may be static-hosted, API container-hosted, and PostgreSQL managed.
- Redis remains optional. A single API replica is the assumed SSE/scheduler
  topology unless this plan documents and tests a multi-replica design.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Full CI | `npm ci && npm run db:validate && npm run verify` | exit 0 |
| Integration | `npm run test:integration` | security/privacy/ops pass |
| E2E | `npm run test:e2e` | deterministic and assistant journeys pass |
| Container | `docker build -f apps/api/Dockerfile .` | production API image builds |
| Compose | `docker compose config` | valid local/staging-like config |
| Migration rehearsal | documented release command | forward migration succeeds on DB copy |

## Scope

**In scope**:

- Security middleware/config/tests, rate limits, deletion/retention services.
- Structured logging, request IDs, health/readiness, minimal operational metrics.
- Production Dockerfiles/build config, environment validation, CI migration and
  container gates, deployment-neutral manifest/docs where possible.
- `docs/runbooks/**`, `docs/pilot/**`, backup/restore and rollback rehearsal docs.
- Load/resource smoke tests for critical endpoints, SSE, worker claims, and DB.

**Out of scope**:

- New product features, teams, integrations, Redis without measured need,
  microservices, Kubernetes, multi-region, 24/7 enterprise SLOs, public launch,
  paid-provider provisioning, or actual production deployment without approval.

## Git workflow

- Branch: `codex/009-release-hardening-pilot`.
- Commit security, observability, container/CI, runbooks, and pilot artifacts
  separately. Never commit production secrets or exported user data.
- Do not deploy, push, or open a PR unless explicitly instructed.

## Steps

### Step 1: Complete the security and privacy control matrix

Inventory every endpoint/table against authentication, ownership, validation,
rate limiting, logging, retention, and deletion. Add Helmet/security headers,
strict configured CORS, request-size limits, stable sanitized exceptions, and
per-user/IP rate limits especially for auth and AI. Verify cookies, CSRF/Origin,
SSE auth, push endpoints, and OAuth callbacks under production flags.

Implement account deletion as an explicit re-authenticated workflow that removes
tasks and associated AI context/conversations/push subscriptions while retaining
only legally/operationally approved minimal tombstones, if any. Implement
configurable AI-history expiry. Do not mutate task-event history independently
of its owning task except through the approved deletion workflow.

**Verify**: integration tests cover the endpoint matrix, deletion cascade,
retention expiry, rate limits, redaction, and sanitized errors. Secret scanning
finds no credentials.

### Step 2: Add observable but privacy-minimized operations

Use structured logs with request/correlation ID, route template, status, latency,
job/suggestion ID, and safe error code. Exclude cookies, authorization headers,
push keys, prompt/task text, raw provider responses, and PII. Add liveness and
readiness endpoints; readiness checks DB/migration compatibility without making
external LLM availability a hard dependency. Emit bounded metrics for request
errors/latency, DB pool, worker queue age/failures, AI usage/latency by version,
SSE connections, and push delivery outcomes.

**Verify**: automated log-capture tests send seeded sensitive values and assert
none appear; health/readiness failure-mode tests return correct status.

### Step 3: Produce reproducible production artifacts

Create multi-stage API and web builds using the pinned Node `24.18.0` LTS line. Run as a
non-root user, include only runtime files, expose health checks, and keep secrets
runtime-injected. Decide whether static web hosting or a tiny web container is
the deployment artifact; avoid serving the SPA from Nest unless an operator
explicitly prefers one-container deployment.

Document local/staging/production variable contracts and same-site frontend/API
domain requirements from auth. Keep VAPID, OAuth, session, DB, and OpenAI secrets
outside manifests/source control.

**Verify**: build and start images with test configuration, call health/auth
routes, serve SPA fallback routes, and run a smoke deterministic loop.

### Step 4: Strengthen CI/CD and migration safety

CI on pull requests must run lockfile install, schema validation, formatting,
lint, typecheck, unit/integration, migration-from-empty, build, and deterministic
E2E. Add migration drift/destructive-change detection appropriate to the current
Prisma version. On main, build immutable artifacts before deployment. The
release procedure applies migrations as a separate visible step with backup and
rollback guidance; it does not silently reset databases.

Do not encode an actual deploy until the operator selects the hosting provider
and authorizes credentials/external changes.

**Verify**: run the CI workflow locally where feasible; rehearse migrations on a
sanitized database copy and document observed duration/locks/rollback result.

### Step 5: Validate resource behavior and the no-Redis assumption

Run small staging-like load/resource tests for task list pagination, current
focus, concurrent focus start, day close, SSE connection cleanup, queued AI
suggestion claims, and notification dedupe. Inspect query plans/indexes for the
bounded critical queries. Record latency/resource baselines and a concrete
threshold that would trigger Redis/BullMQ/shared pub-sub adoption.

Do not add Redis merely because a load tool exists. If a single API process
meets the private-pilot target and jobs recover correctly, record “not needed.”

**Verify**: tests complete within documented pilot targets without duplicate
jobs/sessions, unbounded memory growth, or unpaginated queries.

### Step 6: Write runbooks and execute a staging release rehearsal

Write concise runbooks for setup, deploy, migrate, rollback, backup/restore,
OAuth failure, AI-provider outage, stuck suggestion lease, push failure, session
revocation, data deletion, and incident-safe logging. Define a private-pilot
checklist and success signals tied to the hypothesis: primary-outcome completion,
focus minutes, carryover, and completion of the core loop—not a composite score.

With operator-approved staging credentials/provider, rehearse deploy → migrate
→ smoke deterministic loop → assistant fake/real smoke as allowed → restore
backup → rollback application. Actual external deployment is outside this plan
unless separately authorized.

**Verify**: a second operator/agent can follow runbooks from a clean checkout
without undocumented values; all checklist items have objective evidence.

## Test plan

- Security matrix tests for every route group, two-user isolation, CSRF/CORS,
  rate limits, size limits, error redaction, account deletion, AI retention.
- Log-redaction tests with synthetic canary secrets/PII.
- Container smoke and E2E against production builds.
- Migration from empty and prior schema plus backup/restore rehearsal.
- Bounded load/resource checks for API, DB, worker, and SSE cleanup.

## Done criteria

- [ ] All global gates in `plans/README.md` pass from a clean checkout.
- [ ] Security/privacy matrix has no unowned endpoint or data table.
- [ ] Account deletion removes associated AI/push context as specified.
- [ ] Logs/metrics contain no raw prompts, task bodies, tokens, or push keys.
- [ ] Production artifacts run non-root and pass health/E2E smoke tests.
- [ ] Migration, backup/restore, rollback, and provider-outage runbooks are rehearsed.
- [ ] No Redis/microservice was added without a recorded failed threshold.
- [ ] Pilot success criteria measure outcomes, not a productivity score.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- No deployment provider/domain topology has been selected for provider-specific work.
- External staging/deployment would require credentials or spend without approval.
- Migration rehearsal shows destructive change or unacceptable locks/data loss.
- Privacy deletion/retention policy is unresolved for a persisted data type.
- Multi-replica deployment is required without shared SSE/worker coordination.
- A serious/high security control cannot be verified before pilot.

## Maintenance notes

Repeat the security matrix when adding route groups or stored data. Treat runbooks
as release artifacts and test them after infrastructure changes. Revisit Redis,
shared pub/sub, and separate workers only when recorded pilot measurements cross
the thresholds from Step 5.
