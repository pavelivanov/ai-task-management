# Private-pilot release checklist

The pilot tests whether the deterministic workflow helps users complete a
chosen primary outcome with focused time and less repeated carryover. It does
not assign a productivity score or rank users.

Every checked release or synthetic gate is scoped to the exact commit and image
digests in its dated rehearsal record. After application, workflow, runtime, or
configuration changes, publish a new green `main` artifact and repeat the
affected provider-backed gates before enrolling another participant. Local
verification cannot extend an earlier staging GO decision to a later commit.

## Provider and ownership gate

- [x] Hosting/database provider, region, billing owner, and environment selected.
- [x] Same-site HTTPS web/API domains and trusted proxy hops recorded.
- [x] Release, database, OAuth, assistant, privacy, and incident owners named.
- [x] Managed backup retention, RPO/RTO, and isolated restore drill approved.
- [x] Immutable API, migration, and web image digests recorded.
- [x] One API replica configured; no unsupported shared SSE/worker topology.

## Release gate

- [x] Green `main` workflow and `npm run verify`.
- [x] Configuration reviewed against `docs/deployment/environments.md`.
- [x] Pending migrations reviewed and rehearsed on a sanitized copy.
- [x] Restorable backup identifier recorded before migration.
- [x] Migration job succeeded; migration status and `/health/ready` are healthy.
- [x] Web health and compiled API origin are correct.
- [x] Rollback digests and decision-maker are available.

## Synthetic smoke

- [x] Google OAuth login and logout.
- [x] Capture → process → plan → start focus.
- [x] Pause/wait/resume and capture a distraction.
- [x] Complete or stop → close day → view daily review.
- [x] In-app notification and SSE refetch after reconnect.
- [x] One assistant suggestion when enabled; deterministic flow when unavailable.
- [x] One scoped session revocation.
- [x] No prompt/task/user content or credentials in operational logs.

## Pilot signals

Collect only consented, user-owned or privacy-approved aggregate signals:

- whether the user-selected primary outcome was completed;
- focused minutes from focus-session segments;
- planned and unplanned task completions;
- carried-over task count and repeated-carryover trend;
- successful completion of the core daily loop;
- coded reliability signals: error rate, p95 latency, queue age, and incidents.

Review signals as separate measures with cohort size and time window. Do not
combine them into a productivity score, infer causes from behavior, compare
individual users, or treat time spent as value produced.

## Go/no-go

Go only when every release/synthetic item passes, no high-severity privacy or
security issue is open, backup restore and rollback have objective evidence, and
resource signals remain inside
[the pilot thresholds](./resource-baseline.md). Otherwise record the owner,
blocker, mitigation, and next decision time; do not silently waive the gate.
