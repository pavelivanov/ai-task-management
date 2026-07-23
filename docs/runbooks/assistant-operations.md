# Assistant-provider outage and stuck leases

The assistant is optional: provider availability is deliberately excluded from
`/health/ready`, and deterministic task/focus/review workflows must remain
available.

## Provider outage

1. Confirm API/DB readiness, then inspect aggregate assistant metrics and coded
   logs by prompt version/provider/outcome. Never inspect prompt text or raw
   provider responses in operational logs.
2. Recognize stable provider codes: `provider_rate_limited`,
   `provider_timeout`, `provider_unavailable`, `provider_refusal`,
   `provider_incomplete`, and `provider_invalid_output`.
3. Allow bounded retries to run. Do not mark a suggestion completed, edit its
   output, or accept it for a user. Failed suggestions remain explicit and the
   user can retry after recovery.
4. If a deployment changed provider configuration, roll back the application
   digest or correct the secret/configuration through the provider’s secret
   store. Never place the key in a command transcript.
5. After recovery, run one synthetic suggestion, verify coded success and queue
   age, then observe failure rate before closing the incident.

## Stuck suggestion lease

An eligible `running` suggestion whose `leaseExpiresAt` is in the past is
automatically reclaimable. The worker’s optimistic update prevents two
instances from claiming the same version.

1. Inspect aggregate counts by status and the oldest eligible age without
   selecting `inputContext` or `output`.
2. Confirm the worker is running, database pool has no waiters, and system time
   is correct. Wait at least `ASSISTANT_LEASE_SECONDS` before intervention.
3. Restart or roll back a failed worker process. Recovered workers reclaim
   expired leases; do not clear healthy leases.
4. If a specific expired lease remains stuck after restart, obtain approval for
   a narrowly scoped operational update that sets only its `leaseExpiresAt` to
   the current time. Preserve status, context, output, retry count, and version.
5. Verify exactly one subsequent claim, no retained lease, and a terminal or
   explicitly requeued status.

Escalate when queue age exceeds 30 seconds under pilot load, failures continue
after provider recovery, or more than one API replica is required. Use
[the resource thresholds](../pilot/resource-baseline.md) before proposing
BullMQ or shared pub/sub.
