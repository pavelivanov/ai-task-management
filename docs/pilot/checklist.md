# Private-pilot release checklist

The pilot tests whether the deterministic workflow helps users complete a
chosen primary outcome with focused time and less repeated carryover. It does
not assign a productivity score or rank users.

## Provider and ownership gate

- [ ] Hosting/database provider, region, billing owner, and environment selected.
- [ ] Same-site HTTPS web/API domains and trusted proxy hops recorded.
- [ ] Release, database, OAuth, assistant, privacy, and incident owners named.
- [ ] Managed backup retention, RPO/RTO, and isolated restore drill approved.
- [ ] Immutable API, migration, and web image digests recorded.
- [ ] One API replica configured; no unsupported shared SSE/worker topology.

## Release gate

- [ ] Green `main` workflow and `npm run verify`.
- [ ] Configuration reviewed against `docs/deployment/environments.md`.
- [ ] Pending migrations reviewed and rehearsed on a sanitized copy.
- [ ] Restorable backup identifier recorded before migration.
- [ ] Migration job succeeded; migration status and `/health/ready` are healthy.
- [ ] Web health and compiled API origin are correct.
- [ ] Rollback digests and decision-maker are available.

## Synthetic smoke

- [ ] Google OAuth login and logout.
- [ ] Capture → process → plan → start focus.
- [ ] Pause/wait/resume and capture a distraction.
- [ ] Complete or stop → close day → view daily review.
- [ ] In-app notification and SSE refetch after reconnect.
- [ ] One assistant suggestion when enabled; deterministic flow when unavailable.
- [ ] One scoped session revocation.
- [ ] No prompt/task/user content or credentials in operational logs.

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
