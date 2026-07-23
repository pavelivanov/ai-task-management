# Deletion, retention, and incident-safe logging

## Account deletion

The implemented workflow is documented in
[the retention and deletion policy](../security/data-retention-and-deletion.md).
A user must recently reauthenticate, submit the exact `DELETE` confirmation and
their signed-in email, and use an allowed origin.

For a support report:

1. Give the user the reauthentication and confirmation steps. Never ask them to
   send a cookie, OAuth code, or screenshot containing personal task data.
2. Use safe request IDs and stable codes:
   `ACCOUNT_REAUTHENTICATION_REQUIRED`, `ACCOUNT_CONFIRMATION_MISMATCH`, or
   `ACCOUNT_DELETE_FAILED`.
3. After a reported success, verify only that the user row and cascaded owned
   row counts are zero through an approved privacy operation. Do not export the
   deleted rows as evidence.
4. Record the deletion time for backup reconciliation. No MVP application
   tombstone is retained, so restored backups must reapply deletions that
   occurred after the recovery point before serving traffic.

Do not manually delete child tables, task events, or assistant context around a
live account. Fix the workflow or escalate to the privacy owner.

## Retention

The in-process sweep expires assistant content and removes old conversations,
sessions, notifications, and revoked push subscriptions at configured bounds.
Investigate scheduler health and aggregate old-row counts. Do not lower
retention during an incident without policy-owner approval.

## Incident-safe logging

- Keep `LOG_LEVEL=info` normally and `error` for reduced volume. Never enable
  Prisma query logging or ad hoc request/body logging in production.
- Search only by timestamp, request ID, route template, status class, safe error
  code, suggestion/notification UUID, and prompt version.
- Redact any accidentally captured cookie, authorization value, email, task
  text, prompt, push endpoint/key, provider response, or database URL. Rotate
  exposed credentials and follow the privacy incident process.
- Export only the minimal time-bounded coded records needed for the incident.
  Record who accessed them and delete temporary copies after the ticket closes.
