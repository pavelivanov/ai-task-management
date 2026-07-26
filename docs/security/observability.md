# Privacy-minimized observability

The private-pilot API emits one-line JSON application logs. Each completed HTTP
request has a validated or generated `X-Request-ID`, HTTP method, Nest route
template, status, duration, and a stable error code when applicable. Assistant
suggestion IDs may appear only when they are UUID path parameters. Logs never
include raw URLs, query values, headers, cookies, authorization, request or
response bodies, user IDs, email addresses, task text, prompts, push endpoints,
subscription keys, provider responses, exception messages, or stack traces.

Unhandled 5xx failures also emit an error-level `http.request.failed` record
with the request ID, method, route template, `INTERNAL_ERROR`, and a stable
`errorFingerprint`. The fingerprint is a versioned SHA-256 digest of normalized
stack frames; it groups repeated faults without logging the frames themselves.
It is operational metadata only and is never included in the HTTP response.
Exception messages, stack content, and user content remain excluded from both
the failure record and the normal request-completion record.

`LOG_LEVEL=info` is the operational default. Use `error` when only failures
should be emitted, and `silent` only in automated tests. Do not enable Prisma
query logging in production: SQL parameter values can contain user-owned data.

## Probes

- `GET /health` is liveness only and has no external dependency.
- `GET /health/ready` verifies PostgreSQL connectivity, the expected application
  schema, and the absence of unfinished Prisma migrations. It does not call the
  assistant or push provider. A failure returns HTTP 503 with coded check state.
- `GET /health/metrics` returns bounded, process-local JSON aggregates. It is
  suitable for the MVP's single API process and resets after restart.

Metrics cover HTTP request counts and latency buckets by route template and
status class, PostgreSQL pool occupancy and last readiness-probe latency,
assistant calls/latency/token totals by prompt version and coded outcome,
assistant worker claims/failures/queue age, current SSE connections, and coded
push delivery outcomes. Request and assistant series have hard cardinality caps;
unknown labels collapse to an overflow series.

Treat the metrics endpoint as operational metadata even though it contains no
user content. Restrict it at the ingress or private network before a public
launch. A multi-replica deployment needs a real metrics backend and shared
worker/SSE coordination; summing these local snapshots is not sufficient.
