# Operations runbooks

These provider-neutral runbooks cover the private-pilot topology: one API
process, one static web artifact, and PostgreSQL. Provider dashboards, secret
stores, backup identifiers, domains, and image registries must be filled in by
the operator after a hosting provider is selected.

## Before any operation

1. Name one incident or release lead and one operator. For an incident, record
   the UTC start time, environment, deployed commit and image digests, safe
   request IDs/error codes, and every state-changing action.
2. Do not paste database URLs, cookies, OAuth codes, API keys, VAPID private
   keys, push endpoints, user IDs, emails, task text, prompts, provider
   responses, or database rows into tickets or chat.
3. Prefer read-only health, aggregate metrics, migration status, and coded logs.
   Stop and obtain approval before restoring a backup, revoking all sessions,
   changing retention, or running direct SQL that mutates state.
4. Keep one API replica. A second replica requires the shared-worker and SSE
   coordination decision documented in
   [the resource baseline](../pilot/resource-baseline.md).

## Index

- [Clean setup and environment preflight](./setup.md)
- [Release, migration, and rollback](./release-and-rollback.md)
- [Backup and restore](./backup-and-restore.md)
- [OAuth failure and session revocation](./authentication-and-sessions.md)
- [Assistant-provider outage and stuck leases](./assistant-operations.md)
- [Push-delivery failure](./push-notifications.md)
- [Deletion, retention, and incident-safe logging](./privacy-and-logging.md)

## Shared health checks

| Check                 | Healthy                                                 | Unhealthy action                                                  |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /health`         | HTTP 200                                                | Restart/roll back the API process if it cannot start              |
| `GET /health/ready`   | HTTP 200 with database and migrations `ok`              | Stop traffic promotion; inspect DB connectivity and migration job |
| Web `GET /health`     | HTTP 200 with service `web`                             | Roll back the web digest or correct routing                       |
| API `/health/metrics` | zero DB waiters at pilot load; bounded queue age/errors | Use the relevant worker runbook; keep this endpoint private       |

Close an incident only after the deterministic user journey passes and the
relevant metrics stay healthy for an agreed observation window.
