# Release and migration procedure

This procedure is provider-neutral. A hosting adapter may automate these steps,
but it must preserve their order and make the migration job and its output
visible to an operator. Never run `prisma migrate reset` or `prisma db push`
against staging or production.

Use the concise [operations runbooks](../runbooks/README.md) during a release
or incident and the [private-pilot checklist](../pilot/checklist.md) as the
go/no-go record.

## Release candidate

1. Start from a green `main` workflow. CI installs from the lockfile, validates
   migration history and destructive SQL approvals, replays migrations from an
   empty database, runs unit, integration, browser, and production-container
   tests, and builds the repository.
2. Select the `execution-assistant-images-<commit-sha>` artifact produced by
   that workflow. Do not retag a mutable branch or `latest` image as the release
   source.
3. Confirm the web artifact was built with the intended
   `RELEASE_WEB_API_BASE_URL`. The workflow deliberately uses
   `https://api.invalid` when the repository variable is absent so an
   unconfigured image fails closed. Rebuild the same commit with the correct
   public API URL before promotion if necessary.
4. Record the three image digests and the commit SHA in the release ticket.

## Database gate

1. Confirm the managed database has a recent, restorable backup or snapshot and
   record its identifier. A backup that has not passed the environment's restore
   drill is not a rollback plan.
2. Review every migration added since the deployed SHA. Any statement matched
   by the repository's destructive-change scanner must have a narrow entry and
   rationale in `prisma/destructive-migration-allowlist.json`.
3. Rehearse the upgrade against a sanitized copy of the target environment when
   a release adds a migration. Locally, `npm run db:migration:rehearse` safely
   rebuilds only a localhost database whose name ends in `_test`, applies the
   prior migration set, inserts synthetic data, deploys the newest migration,
   and verifies data preservation and the absence of pending locks afterward.
   When more than one migration is pending, set `MIGRATION_REHEARSAL_BASELINE`
   to the last migration recorded in the target copy so the entire delta is
   exercised.
4. Decide whether the reviewed SQL needs a maintenance window. PostgreSQL
   `ALTER TABLE` operations may take an `ACCESS EXCLUSIVE` lock even when a
   local rehearsal finishes quickly. Do not infer production lock duration from
   an empty or small local database.

## Deployment order

1. Stop the release if the backup gate, digest record, configuration review, or
   migration rehearsal is incomplete.
2. Run the commit-matched migration image once with the target environment's
   runtime-injected `DATABASE_URL`. Stream and retain its logs:

   ```bash
   docker run --rm \
     --env DATABASE_URL='<runtime-injected-secret>' \
     execution-assistant-migrate:<commit-sha>
   ```

3. Require a zero exit status. Then run `prisma migrate status` through an
   equivalent restricted operational job and require “Database schema is up to
   date.” Do not start the new API after a partial or failed migration.
4. Deploy the API image by recorded digest, wait for `/health/ready`, then
   deploy the web image by recorded digest. Keep one API replica until the
   documented shared worker-claim and event pub/sub prerequisites are met.
5. Exercise login, capture, planning, focus completion, review, notifications,
   and one assistant proposal in the target environment. Observe readiness,
   coded error rates, and latency during the release window.

## Rollback and forward recovery

- If migrations succeeded but the application is unhealthy, restore the prior
  API and web image digests. Database migrations are forward-only by default;
  do not improvise reverse SQL during an incident.
- Additive migrations must remain compatible with the prior application for at
  least one release. A migration that removes or rewrites data needs a reviewed
  expand/migrate/contract sequence and a release-specific recovery plan.
- If the database migration itself fails, keep the new application stopped,
  preserve logs, and assess whether a forward fix is safe. Restore the recorded
  backup only through the environment's incident procedure after confirming
  the recovery-point data loss and stopping all writers.
- A rollback is complete only after the prior application is ready and the
  deterministic user journey and operational signals are healthy again.

## Latest rehearsal record

On 2026-07-22, `20260721160000_behavior_notifications` was rehearsed from the
seven-migration baseline against a local PostgreSQL 17 sanitized copy. Prisma
completed the upgrade in 467 ms, preserved the synthetic user row, and left
zero pending locks. The migration is additive, so the previous application can
ignore the new columns, tables, indexes, and enum types; the rollback result is
application-image rollback without reversing the database migration. The SQL
contains `ALTER TABLE`, so production must still treat its transient lock time
as workload-dependent.
