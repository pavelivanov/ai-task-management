# Release, migration, and rollback

The authoritative ordered procedure is
[the release and migration procedure](../deployment/release-procedure.md). This
runbook is the operator’s incident card; it does not replace that gate.

## Release

1. Select a green `main` commit and record the commit, three immutable image
   digests, compiled public web API URL, configuration review, and restorable
   backup identifier.
2. Rehearse every pending migration on a sanitized copy. Review lock behavior
   and destructive-statement approvals.
3. Run the commit-matched migration image once. Retain its logs and require a
   zero exit status plus an up-to-date `prisma migrate status`.
4. Start the API by digest. Do not promote traffic until `/health/ready` is
   healthy. Start the web image by digest and verify its health.
5. Run the private-pilot deterministic journey and an assistant smoke only when
   that provider is enabled and synthetic input is approved.

## Roll back the application

Use rollback when the new application is unhealthy but migrations completed
successfully and remain compatible with the prior release.

1. Stop promotion and record the failure’s request IDs/error codes.
2. Redeploy the previously recorded API and web image digests. Do not rebuild a
   branch or use a mutable tag.
3. Do not reverse database migrations during the incident. The prior release
   must be compatible with additive migrations; otherwise follow the
   release-specific recovery plan.
4. Require API readiness, web health, the deterministic journey, and stable
   metrics before declaring rollback complete.

## Failed migration

Keep the new application stopped. Preserve migration output, check
`_prisma_migrations` through the approved operational job, and choose a reviewed
forward fix or backup restore. Never run `prisma migrate reset`, `prisma db
push`, ad hoc reverse SQL, or an unreviewed manual edit in staging/production.

## Evidence to retain

Commit and digests, backup identifier, migration names/duration, readiness
timestamps, smoke result, rollback digest if used, and the decision-maker. Store
no user content or secrets.
