# Release rehearsal record

## Plan 010 audit-remediation rehearsal — 2026-07-26

Environment: Node.js 24.18.0, npm 11.9.0, Docker Compose 5.1.2, PostgreSQL
17, and a Darwin arm64 host. All data was synthetic. The database commands used
only localhost databases ending in `_test`, and every disposable Compose project
was removed after its drill.

| Gate                                     | Command                                                                   | Fresh result                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration transport stability          | ten consecutive `npm run test:integration` runs                           | PASS — 10/10 runs; all 9 suites and 52 tests passed in every run; no retry setting                                                                           |
| Tooling lint coverage                    | `npm run lint`                                                            | PASS — the gate failed on an intentional error under `scripts/`, then passed after the probe was removed                                                     |
| Migration upgrade                        | `npm run db:migration:rehearse`                                           | PASS — `20260721160000_behavior_notifications` applied in 574 ms; 1 sanitized row preserved; 0 pending locks                                                 |
| Backup and isolated restore              | `npm run ops:backup-restore:rehearse`                                     | PASS — 69,513 bytes; backup 214 ms; restore 197 ms; 8 migrations; pre-backup row restored; post-backup row absent                                            |
| GC-corrected resource/load behavior      | `npm run pilot:resource-baseline`                                         | PASS — 701,408 retained SSE heap bytes against 2 MiB; 2.41 ms maximum cleanup; 10 peak/0 retained connections; 0 database waiters; 154.13 ms queue drain     |
| Retained-listener negative control       | temporary listener-retention probe with `npm run pilot:resource-baseline` | PASS — the harness failed on the 2 MiB retained-heap assertion; the temporary probe was removed                                                              |
| Production artifacts and execution smoke | `npm run container:smoke`                                                 | PASS — non-root API/web, migration/readiness, SPA/service worker, fake assistant, and deterministic execution loop                                           |
| Repository gate                          | `npm run verify`                                                          | PASS — schema, format, 59-route/18-table matrix, 277-file secret scan, lint, typecheck, 195 unit tests, 53 integration tests, builds, and Compose validation |
| Browser deterministic/assistant journeys | `npm run test:e2e`                                                        | PASS — all 6 Chromium tests, including accessibility, responsive layout, behavior, and assistant-confirmation flows                                          |

The resource figures above are the final post-remediation run and are also
recorded in [the resource baseline](./resource-baseline.md). The ten-run
transport sample preceded the added fingerprint log-capture test, which is why
those runs contained 52 integration tests while the final repository gate
contained 53. Each figure maps directly to the command in its row and was
produced during this rehearsal rather than copied from the earlier record.

## Local provider-neutral rehearsal — 2026-07-23

Environment: Node.js 24.18.0, npm 11.9.0, Docker Compose 5.1.2, PostgreSQL
17.10, Darwin arm64 host. All data was synthetic and all Compose state was
removed after each drill.

| Gate                                                        | Command                               | Result                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Migration upgrade                                           | `npm run db:migration:rehearse`       | PASS — notification migration applied in 418 ms; synthetic row preserved; 0 pending locks                         |
| Backup and isolated restore                                 | `npm run ops:backup-restore:rehearse` | PASS — 69,514 bytes; backup 210 ms; restore 199 ms; 8 migrations; pre-backup row restored; post-backup row absent |
| Resource/load behavior                                      | `npm run pilot:resource-baseline`     | PASS — recorded in `resource-baseline.md`                                                                         |
| Production artifacts and deterministic/fake-assistant smoke | `npm run container:smoke`             | PASS — non-root API/web, readiness, SPA/service worker, fake suggestion, and full execution loop                  |
| Repository gate                                             | `npm run verify`                      | PASS — schema, format, security, lint, typecheck, 191 unit tests, 52 integration tests, builds, and Compose       |

The combined local command is:

```bash
npm run pilot:rehearse:local
```

It rehearses migration, backup/restore, bounded resources, production-built
containers, the deterministic loop, and a fake structured assistant response.
The combined command completed successfully on 2026-07-23.

## External staging gate

Status: **blocked by an intentional Plan 009 STOP condition**. No hosting
provider, same-site domain, managed database, registry, approved credentials, or
prior deployed image digest has been selected in the repository.

The following actions were therefore not performed:

- external artifact promotion by immutable digest;
- managed backup/snapshot and restore;
- real Google OAuth callback;
- real OpenAI or web-push smoke;
- application rollback to a previously deployed digest.

An operator must complete the provider/ownership section of
[the pilot checklist](./checklist.md), then follow the
[release runbook](../runbooks/release-and-rollback.md). This record must be
updated with provider identifiers, timestamps, digests, backup ID, migration
result, synthetic smoke result, rollback result, and approver before Plan 009
can be marked DONE.
