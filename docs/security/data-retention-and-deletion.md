# Data retention and deletion policy

This is the implemented private-pilot policy. It must be reviewed before any
legal hold, billing record, team ownership, export, or public-launch requirement
is introduced.

## Policy boundaries

- Primary user data—tasks, projects, plans, focus history, reviews, preferences,
  trigger audit records—remains while the account exists. The user may delete a
  task when no retained plan/focus/subtask relationship requires it, or delete
  the entire account.
- Task events are append-only while their task exists. Task deletion removes the
  events by database cascade and purges all retained AI suggestions for that
  owner so task text cannot survive in a broader plan snapshot.
- Assistant suggestion context and output expire after
  `ASSISTANT_RETENTION_DAYS` (30 by default). Expiration replaces context with a
  non-sensitive marker, clears output/provider request IDs and leases, and marks
  the suggestion expired regardless of its former workflow status.
- Conversation-message content older than the same AI boundary is deleted.
  Empty conversations are then deleted. These tables are reserved for bounded
  assistant context; they are not a general chat archive.
- Expired and revoked sessions are deleted by the retention sweep.
- Notification records are deleted after `NOTIFICATION_RETENTION_DAYS` (90 by
  default). Revoked push subscriptions are deleted after
  `REVOKED_PUSH_RETENTION_DAYS` (30 by default). Active push subscriptions remain
  until explicit revocation or account deletion.
- The sweep runs every `RETENTION_SWEEP_INTERVAL_MS` (one hour by default), is
  idempotent, drains 100-row suggestion-expiry batches, and skips an overlapping
  invocation. Each sweep stops when a partial batch is reached or after 100
  batches (10,000 selected suggestions, an effective default ceiling of 240,000
  per day).

## Account deletion

`DELETE /users/me` requires all of the following:

1. a valid session owned by the account;
2. a session created by authentication within
   `ACCOUNT_DELETION_REAUTH_MINUTES` (10 minutes by default);
3. an allowlisted Origin;
4. the exact confirmation phrase `DELETE` and the signed-in email address.

If the session is older, the user must complete Google sign-in again before
retrying. Successful deletion hard-deletes the `User` row and every related
identity, session, preference, task/event, plan/item, focus/segment, review,
assistant context, trigger, notification, and push-subscription row through
declared cascades. Any in-process SSE connection for that user is closed and the
session cookie is cleared. No application tombstone is retained for the MVP.

Database backups are a separate operational retention domain and must define
their own expiry before staging or production deployment. Until that runbook is
approved, a restored backup must be treated as containing accounts deleted
after the backup timestamp and must not be used as a live replacement without a
deletion reconciliation step.
