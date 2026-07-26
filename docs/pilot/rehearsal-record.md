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

### Railway staging rehearsal — 2026-07-23–2026-07-25

Status: **PASS — GO**. Artifact, backup/restore, migration, readiness,
application rollback, same-site DNS/HTTPS, real Google OAuth, external
deterministic/SSE/notification/disabled-assistant/scoped-revocation synthetics,
and privacy-log gates all have objective evidence. Pavel Ivanov approved the
private-pilot staging release at `2026-07-25T08:56:38Z`.

#### Selection and ownership

| Item                                                              | Recorded decision                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Hosting and database                                              | Railway project `execution-assistant` (`bd8fe2b5-0ed5-40ab-afb6-4ba8938fc81c`) with managed PostgreSQL        |
| Workspace and billing owner                                       | Pavel Ivanov; personal workspace `b0b23dbd-819d-410d-b42c-1d1fd6d25432`                                       |
| Environment                                                       | `staging` (`d9dbeb36-1304-408c-ba93-88a475ecf9b3`)                                                            |
| Region and topology                                               | EU West, Amsterdam (`europe-west4-drams3a`); one API replica, one web replica, one PostgreSQL instance        |
| Same-site public URLs                                             | `https://assistant-staging.pavelivanov.info` and `https://api.assistant-staging.pavelivanov.info`             |
| Google callback                                                   | `https://api.assistant-staging.pavelivanov.info/auth/google/callback`                                         |
| Trusted proxy hops                                                | `1`                                                                                                           |
| Release, database, OAuth, assistant, privacy, and incident owners | Pavel Ivanov                                                                                                  |
| Optional providers                                                | OpenAI and web push disabled; deterministic workflow and in-app notifications remain required                 |
| Backup policy                                                     | Private managed object storage, 30-day lifecycle retention, 24-hour staging RPO, 2-hour staging RTO; approved |

Railway service identifiers are:

| Service       | Identifier                             |
| ------------- | -------------------------------------- |
| PostgreSQL    | `b0b166b8-8d9f-410f-be82-45fa33950f91` |
| API           | `b407e651-383e-42e1-9fab-21e08e524f2f` |
| Web           | `cc643598-3b43-49d0-a278-54d077c939cf` |
| Migration job | `3e16e226-3a77-4437-9f37-a4c906125cc3` |

The API configuration uses a Railway private-network `DATABASE_URL` reference,
production flags, an `HttpOnly` staging session cookie, exact callback/origin
allowlists, one trusted proxy hop, bounded SSE/worker/retention settings, and
disabled optional providers. Google OAuth project
`execution-assistant-staging` uses client
`471929862160-u3csvd0m02tqirib0f3h3fhpokugluqo.apps.googleusercontent.com`;
its client secret is stored only in Railway staging configuration. No secret
value is recorded here.

#### Immutable artifacts

Baseline `main` workflow `30037036116` passed at commit
`3c9e4a254ffb6327649d121975c7690bdfc85ffd`. Candidate workflow
`30038706381` passed verification, container smoke, and release artifact
publication. Artifact
`execution-assistant-images-31f6c2623c781bb7e5131800387b79ce23cc1a3b`
(`8576480508`) recorded:

| Artifact  | Digest                                                                    |
| --------- | ------------------------------------------------------------------------- |
| API       | `sha256:69871b9048232926647a1929ef911c41d4a53d13fbef425ba544703069aa2728` |
| Migration | `sha256:b1ea7c4535cbba4bf713382379b8db1d33b99b9d50309d22aa03249440ee3d64` |
| Web       | `sha256:f6986d679fcb8ca2e5072920c3cee815e2802bfd016ea85ff330dddf15d519d7` |
| Prior API | `sha256:279d65cdc4ebd85ea104ceec6e9e3df43fc8a287040931431f20babda87f5e5e` |
| Prior web | `sha256:05b903d4bf1313f398be8c701528bdb0e9e46df26feeb5d6dd4919f0fc45aa50` |

The release commit is `31f6c2623c781bb7e5131800387b79ce23cc1a3b`,
the rollback commit is `3c9e4a254ffb6327649d121975c7690bdfc85ffd`,
and the web bundle was compiled with
`https://api.assistant-staging.pavelivanov.info`. All five registry manifests
were independently resolved by digest before deployment.

#### Managed backup and isolated restore

At `2026-07-23T19:48:33Z`, a PostgreSQL custom-format pre-migration backup was
written to private Railway bucket
`execution-assistant-backups-sdgetc`
(`2a65793c-59a0-492c-815b-76c924875ddf`) at
`execution-assistant/staging/pre-migration/20260723T194833Z.dump`.

| Field                   | Evidence                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Size                    | 860 bytes; empty staging data set plus database metadata                                 |
| SHA-256                 | `6901461cca37d5de1ea9b38a2b9cdf47ab4e7d4587838c65b36689643159f06e`                       |
| ETag                    | `8a51ab2c1b04defeef9dcf16d1823ca1`                                                       |
| Lifecycle               | Enabled for the staging prefix; expires objects after 30 days                            |
| Independent download    | PASS; object metadata and downloaded-file SHA-256 matched                                |
| Isolated restore target | `Postgres-zVn2` (`ce049a6f-17f8-4711-befb-5d99e0f50326`)                                 |
| Restore job             | `e43bfe68-1768-4f8f-a9e8-0f838dd34c95`; checksum matched and `pg_restore` exited cleanly |

The immutable migration image was then run against the isolated restore as
deployment `43c560ff-86e8-4a68-80ca-1ce8bb42c795`. All eight migrations applied.
The follow-up status deployment
`8dd038bd-260c-4c15-bc09-54742edc14d8` reported
`Database schema is up to date!`.

#### Live migration, deployment, and rollback

The live migration deployment
`6b935854-3227-4194-9c64-3b93be3c3d6d` applied all eight migrations to the
source managed database. Status deployment
`fcc43da8-48c8-4272-9eb9-e0b7a7fe957e` subsequently reported
`Database schema is up to date!`.

| UTC time               | Gate                                                            | Result                                                                                                                  |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `2026-07-23T20:24:43Z` | Candidate API deployment `c8b357f7-5586-4e5f-a154-0ee02301943e` | PASS; recorded digest and `/health/ready` returned database/migrations `ok`                                             |
| `2026-07-23T20:25:22Z` | Candidate web deployment `cb8e740e-b4ab-437e-a208-0add6ac100c6` | PASS; recorded digest, `/health` returned `ok`, and deployed bundle contained the selected API origin                   |
| `2026-07-23T20:26:43Z` | Prior API rollback `5e455b49-bc11-4060-a5a1-401e8b3014c0`       | PASS; prior digest was ready against the additive schema                                                                |
| `2026-07-23T20:27:21Z` | Prior web rollback `cb4b4637-c99a-44f0-9264-f73315433b85`       | PASS; prior digest returned healthy                                                                                     |
| `2026-07-23T20:28:12Z` | Candidate API recovery `023e567b-3070-48c3-8848-9bd41414b08b`   | PASS; candidate digest restored and ready                                                                               |
| `2026-07-23T20:28:38Z` | Candidate web recovery `087cc6a2-328e-4cdb-83d0-7d7f4b3f1367`   | PASS; candidate digest restored and healthy                                                                             |
| `2026-07-23T20:35:58Z` | Amsterdam API correction `3eaaeb6c-fa47-43f5-ab23-99a0bd71da39` | PASS; audit found and corrected a US West region drift; one Amsterdam replica became ready                              |
| `2026-07-23T20:36:28Z` | Amsterdam web correction `b5265105-c7bb-44ad-84c5-d62365d0f4d8` | PASS; one Amsterdam replica returned healthy                                                                            |
| `2026-07-23T20:50:10Z` | Final API deployment `46f6f226-6f66-4a8e-aa05-220e841b0e1e`     | PASS; candidate digest, Amsterdam replica, normal 60-second scheduler, and readiness reverified after synthetic cleanup |

#### External deterministic and privacy synthetic

At `2026-07-23T20:47:55Z`, private one-shot deployment
`e2531bcf-7944-45b2-afb1-36f4c7a71aab` created two random, disposable,
database-backed sessions for one synthetic user. Tokens existed only inside the
bounded runner process; the production test-login route remained disabled.

The public Railway API endpoint was exercised from outside the project network:

| Gate                          | Result                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Two-session authentication    | PASS; both random sessions authenticated the same synthetic user                                                                    |
| Capture and process           | PASS; captured an inbox task and accepted it into backlog                                                                           |
| Plan and focus                | PASS; created a plan, added the primary outcome, and started focus                                                                  |
| Pause/wait/resume/distraction | PASS; all state transitions succeeded and a distraction was captured                                                                |
| Complete/close/review         | PASS; completed the primary outcome, closed the day, and generated a review with one planned completion                             |
| Assistant unavailable         | PASS; task extraction returned stable `provider_disabled`, while the deterministic workflow remained usable                         |
| In-app notification           | PASS; a deadline-risk notification appeared with web push disabled                                                                  |
| Initial SSE stream            | PASS; received `plan.changed`, `focus.changed`, `suggestion.changed`, and `notification.changed`                                    |
| SSE reconnect/refetch         | PASS; a new stream received `notification.changed`, then authoritative notification state was refetched                             |
| Scoped session revocation     | PASS; revoking the primary session returned 401 for it while the second session remained authenticated; the second was then revoked |

Synthetic result identifiers were task
`3c0d7d67-7bf0-4871-a8bf-674fed9d7d27`, focus session
`cdef896f-52af-479c-897c-10c63270e310`, review
`0260507c-71d1-40c7-9c5b-2b23b57054be`, assistant suggestion
`af480ca5-346c-486b-8257-801cf913ad5c`, and notification
`96bd23e1-59de-4646-9443-1d66adcf6283`.

Bounded Railway log queries found zero matches for every synthetic task,
description, process reason, focus intent, pause/wait reason, distraction,
outcome, notification-task, assistant-prompt, email, authorization, and cookie
canary. A sanitized 401 log contained only request ID, method, route, status,
duration, and safe error code. Cleanup deployment
`acdee8cc-76b7-464f-8e71-d56d09f5f5d1` deleted the synthetic user and its
cascaded data (`DELETE 1`); both sessions had already been revoked.

#### Same-site DNS, Google OAuth, and final decision

The final audit was recorded at `2026-07-25T08:56:38Z`.

| Gate                    | Evidence                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare DNS          | Account `fbfa2cea589a6f920a81b005364939a1`; DNS-only web/API CNAMEs resolve to `xljmkw5z.up.railway.app` and `6pyed4e6.up.railway.app`; both `_railway-verify` TXT records resolve with the exact Railway ownership tokens                                                                                 |
| Same-site HTTPS         | `https://assistant-staging.pavelivanov.info/health` returned 200/`ok`; `https://api.assistant-staging.pavelivanov.info/health/ready` returned 200 with database and migrations `ok`                                                                                                                        |
| Google OAuth client     | Project `execution-assistant-staging`; web client created at `2026-07-25T08:47:14Z`; exact JavaScript origin and API callback recorded above; client ID recorded above; secret transferred to Railway through secret stdin and excluded from source/evidence                                               |
| OAuth API rollout       | Deployment `9a4714e0-ab1b-4d14-aec4-8cd2b7708a13`, created `2026-07-25T08:50:26.404Z`, reached `SUCCESS` on API digest `sha256:69871b9048232926647a1929ef911c41d4a53d13fbef425ba544703069aa2728` with one Amsterdam replica                                                                                |
| Browser OAuth smoke     | PASS; real Google account selection and consent returned to `/today`, logout returned to `/login`, and a clean re-login returned to `/today`                                                                                                                                                               |
| Post-OAuth privacy scan | PASS; 110 bounded recent log entries contained zero exact email, OAuth client ID, secret-prefix, token/header, or cookie matches; a separate bounded error query returned zero entries                                                                                                                     |
| Configuration contract  | PASS; production flags, private managed PostgreSQL, exact callback/origin allowlists, staging cookie, one trusted proxy hop, disabled test auth, disabled optional providers, bounded workers/retention/rates, one API replica, immutable sources, and Amsterdam placement matched the documented contract |

Pavel Ivanov, acting as release, database, OAuth, assistant, privacy, and
incident owner, approved the recorded 30-day backup retention, 24-hour staging
RPO, 2-hour staging RTO, and isolated restore result. No high-severity privacy
or security issue is open. The final decision is **GO for the private-pilot
staging release**; it is not approval for a public production launch.

After retaining identifiers and results, the temporary backup-export and
restore-import helpers, isolated `Postgres-zVn2` service, and both public
PostgreSQL TCP proxies were removed. The isolated restore volume
`68ca76ac-043c-4cf5-858a-105fabeb380b` is pending Railway's recoverable
deletion window. The live private PostgreSQL service/volume, API, migration job,
web service, and managed backup object remain.

Temporary Railway-provided URLs were used only for pre-DNS health probes. The
selected same-site domains, real OAuth, browser login/logout smoke, backup
approval, approver, and explicit go/no-go decision are now recorded and passed.
