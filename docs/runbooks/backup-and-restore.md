# Backup and restore

## Policy

Use the managed PostgreSQL provider’s encrypted backups and point-in-time
recovery when available. The operator must define retention, RPO, RTO, region,
access control, and deletion-reconciliation ownership before staging. A backup
is not release evidence until an isolated restore has succeeded.

## Local restore drill

The repository provides a disposable Docker rehearsal:

```bash
npm run ops:backup-restore:rehearse
```

It builds the migration artifact, migrates an isolated PostgreSQL 17 database,
adds synthetic data, creates a custom-format `pg_dump`, restores into a second
database, verifies migration history and the recovery point, and removes all
containers and volumes. It never accepts a production URL.

## Managed-environment restore

1. Record incident approval, source environment, backup/snapshot identifier,
   timestamp, expected data-loss window, and target **new isolated database**.
2. Stop or isolate writers if the procedure could affect the source. Never
   restore over the only live copy.
3. Restore using the provider’s documented process and least-privileged
   operational identity.
4. Point a non-serving API job at the restored target. Run migration status,
   readiness, row-count/invariant checks that expose no user content, and the
   deterministic synthetic journey.
5. Reconcile account deletions and other legally required removals that occurred
   after the backup timestamp before considering the restored database for live
   use.
6. Obtain incident-lead approval before changing application connectivity.
   Retain the old database until the recovery window closes.

Abort on checksum/provider restore errors, missing migration history, failed
readiness, unexpected post-backup data, or inability to reconcile deletions.
Record duration and outcome without recording dump contents or row values.
