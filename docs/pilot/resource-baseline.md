# Private-pilot resource baseline

The private-pilot runtime remains one API process backed by PostgreSQL. Redis,
BullMQ, and shared pub/sub are not required while the measured workload stays
inside the thresholds below.

## Reproduce the baseline

Use the repository-pinned Node.js and npm versions, start the local PostgreSQL
service, and point `TEST_DATABASE_URL` at a localhost database whose name ends
in `_test`. The command recreates that database before running:

```bash
npm run pilot:resource-baseline
```

The command builds the API first and the harness imports that compiled artifact.
It uses only synthetic data: 2,000 tasks, 200 requests per read path with
concurrency 20, competing focus starts and day closes, 80 cycled SSE
connections, 20 queued assistant suggestions drained by two Nest application
instances, competing notification inserts, and PostgreSQL
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` summaries. It fails on duplicate open
focus sessions, duplicate daily reviews, duplicate notification keys, retained
assistant leases, missing critical indexes, SSE cleanup leaks, or database-pool
waiters.

This is an explicit staging-like diagnostic, not part of `npm run verify`.
Latency and process-memory observations depend on the host and should be rerun
on the selected staging provider before opening the pilot.

## Pilot thresholds

| Signal                                      |           Private-pilot target | Escalation                                                                     |
| ------------------------------------------- | -----------------------------: | ------------------------------------------------------------------------------ |
| Task list and current-focus request p95     |                 at most 250 ms | Investigate query plan, pool pressure, and host sizing                         |
| Individual measured request                 |                    at most 1 s | Treat repeated breaches as release-blocking                                    |
| Database pool waiting clients               |       0 at representative load | Tune bounded concurrency/pool before adding infrastructure                     |
| Assistant queue drain/oldest age            |                   at most 30 s | Tune the DB worker; evaluate BullMQ only if DB claiming remains the bottleneck |
| SSE disconnect cleanup                      |                    at most 2 s | Fix cleanup before scaling replicas                                            |
| Repeated SSE heap growth                    | at most 32 MiB for eight waves | Investigate retained streams/listeners before pilot                            |
| Duplicate focus sessions/jobs/notifications |                              0 | Release-blocking correctness failure                                           |

Every list path used by the pilot is bounded: task list returns at most 100
items by contract (50 in this harness), notifications return at most 50, and
worker claims select one eligible suggestion at a time. The harness also checks
the task-list, open-focus, assistant-claim, notification-list, notification
dedupe, and one-open-focus indexes.

## Redis decision

Current decision: **not needed for the single-process private pilot**.

Revisit that decision only with evidence from a representative environment:

- sustained request p95 exceeds 250 ms or request maxima repeatedly exceed 1 s;
- PostgreSQL reports waiting pool clients at the target concurrency;
- assistant queue age or drain time exceeds 30 seconds after worker tuning;
- availability or throughput requires more than one API replica; or
- SSE invalidations must cross process or host boundaries.

If multiple API replicas become necessary, shared pub/sub is required before
relying on cross-instance SSE invalidations. BullMQ is justified only if the
measured database-backed claim/retry path cannot meet the queue target; it is
not a prerequisite for a second replica by itself.

## Recorded local run

Recorded on 2026-07-23 with Node.js 24.18.0 on Darwin arm64 and local
PostgreSQL:

| Measurement                                          |                                                     Observed |
| ---------------------------------------------------- | -----------------------------------------------------------: |
| Task list (2,000 rows, 200 requests, concurrency 20) |                     p50 11.35 ms; p95 27.89 ms; max 30.25 ms |
| Current focus (200 requests, concurrency 20)         |                      p50 7.44 ms; p95 11.35 ms; max 11.99 ms |
| 20 competing focus starts                            |            38.52 ms; 1 success, 19 conflicts, 1 open session |
| 20 competing day closes                              | 72.02 ms; 11 closed responses, 9 version conflicts, 1 review |
| 20 queued suggestions, 2 worker instances            |         95.20 ms; 20 completed; 0 retries or retained leases |
| 8 waves of 10 SSE connections                        |    27.28 ms maximum cleanup; 10 peak; 0 retained connections |
| SSE retained heap growth across all waves            |                   23,248,696 bytes (below the 32 MiB target) |
| Database pool after the run                          |                                   1 total; 1 idle; 0 waiting |

PostgreSQL used `tasks_userId_status_createdAt_id_idx` for the task page,
`one_open_focus_session_per_user` for current focus, and
`notifications_userId_readAt_createdAt_id_idx` for the notification page. The
assistant eligibility query used a sequential scan after the queue had drained;
the table held only the small synthetic run, execution was 0.03 ms, and
`ai_suggestions_status_leaseExpiresAt_createdAt_id_idx` was present. Recheck
that plan with staging-scale queue history; an increasing scan cost or queue age
is the evidence needed before changing the queue architecture.

Result: all correctness and resource assertions passed, so Redis remains
unnecessary for the private-pilot topology.
