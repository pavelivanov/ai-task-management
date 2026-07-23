# Release rehearsal record

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
