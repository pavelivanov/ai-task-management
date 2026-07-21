# AI Execution Assistant

A TypeScript modular monolith for helping people turn intentions into completed
work. The repository contains the verified deterministic execution loop:
user-scoped task and inbox workflows, timezone-aware daily planning, soft
capacity warnings, explicit carryover, segment-based focus tracking,
deterministic daily reviews, lightweight projects, and append-only task
history. A responsive React workspace exposes Today, Focus, Inbox, Backlog,
Review, Notifications, and Settings without requiring an LLM key.

## Prerequisites

- Node.js `24.18.0` (see `.nvmrc`)
- npm `11.9.0`
- Docker with Docker Compose

## Setup

```bash
nvm use
npm ci
cp .env.example .env
npm run db:up
```

Wait until `docker compose ps` reports PostgreSQL as healthy.

Validate the Prisma schema and apply migrations to the isolated local test
database:

```bash
npm run db:validate
npm run db:migrate:test
```

`db:migrate:test` intentionally recreates its target. It refuses to operate
unless `TEST_DATABASE_URL` points to localhost and the database name ends in
`_test`.

## Development

Run the API and web application in separate terminals:

```bash
npm run start:dev --workspace apps/api
npm run dev --workspace apps/web
```

The API listens on `http://localhost:3000`; its stable health endpoint is
`GET /health`. Google login starts at `GET /auth/google`; authenticated clients
can use `GET /auth/me` and `GET/PATCH /users/me/preferences`. The web app listens
on `http://localhost:5173`.

Authenticated task workflows are available through `GET/POST /tasks`, task
detail, patch, delete, archive, complete, and history routes. `GET /inbox` plus
the inbox capture and processing routes support an oldest-first workflow,
including scheduling into a daily plan. `/daily-plans/today` supports
timezone-derived plan creation, edits, ordered items, coded capacity warnings,
and atomic close with explicit carryover. `/projects` provides the minimal
project grouping used by task filters. `/focus` exposes the single-active focus
lifecycle and reconnect-safe current state; authenticated `GET /events` streams
content-minimized invalidations with heartbeat comments. Every mutation
requires an allowlisted `Origin` header.

Event invalidations use bounded in-process subscribers for the MVP's single API
instance. A multi-replica deployment must introduce shared pub/sub before it can
rely on cross-instance delivery.

Daily reviews are generated from authoritative plan items, task events, and
focus segments when a day closes or through the explicit review-generation
endpoint. Regeneration preserves the user's reflection and never assigns a
productivity score.

Proactive support is deterministic: the API evaluates bounded planning,
waiting, carryover, estimate, deadline, and review triggers with durable dedupe
keys and an auditable outcome. Interruption level and reminder preferences gate
delivery. Protected work hours filter personal work from automatic suggestions
and show a warning—not a prohibition—before an explicit start. Waiting sessions
can surface at most three stable, eligible short-task choices.

The in-app notification center is always available at `/notifications` when a
signal is recorded. Browser push is opt-in and requested only after the user
selects a specific notification benefit in Settings. Set `PUSH_PROVIDER` to
`web-push` and supply `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and
`VAPID_PRIVATE_KEY` through deployment secrets to enable production delivery;
`disabled` is the safe default and `fake` is reserved for non-production tests.
The notification worker sends a content-minimized payload and treats expired
subscriptions as revoked. Subscription keys, VAPID private material, and task
bodies must never be logged.

Production hosting must serve the web app and `/sw.js` from a secure context
(HTTPS) with the intended service-worker scope. Permission denial only disables
browser delivery; it does not disable the in-app center. Changing timezone or
notification preferences clears pending deliveries so the scheduler can
recompute them from current settings.

Bounded assistant proposals are available for task extraction, daily planning,
task decomposition, carryover diagnosis, and outcome summaries. Every proposal
is stored and validated before it is shown, and every task or plan write still
requires explicit user confirmation. The app defaults to
`ASSISTANT_PROVIDER=disabled`; use `fake` for deterministic local testing or
`openai` with an externally supplied `OPENAI_API_KEY`. The OpenAI adapter uses
the Responses API with strict structured output and a configurable
`OPENAI_MODEL` (default `gpt-5.6-sol`).

Assistant routes live under `/assistant/suggestions`: create a bounded request,
fetch its current status, then explicitly accept/edit or reject it. Plan and
review requests run through the durable database worker and publish
content-free `suggestion.changed` invalidations. Prompt bodies are not logged;
stored context expires on the configured retention boundary, and deleting a
task purges retained assistant context for that owner.

The API applies Helmet security headers, strict configured CORS, an explicit
request-body limit, a global per-IP request limit, tighter authentication IP
limits, and per-user assistant limits. `TRUST_PROXY_HOPS` defaults to `0`; set it
only to the exact trusted reverse-proxy hop count so client-supplied forwarding
headers cannot bypass IP controls.

Account deletion is available in Settings and through `DELETE /users/me`. It
requires a session created by a recent sign-in, the exact `DELETE` phrase, the
signed-in email address, and an allowlisted Origin. It clears every user-owned
database row, closes live event streams, and clears the session cookie. See
`docs/security/data-retention-and-deletion.md` for assistant, notification,
session, and push-subscription expiry boundaries.

## Verification

Run the complete non-browser gate with:

```bash
npm run verify
```

Individual gates are available as `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run test:integration`, and
`npm run build`. The fixed offline assistant evaluation suite runs with
`npm run eval:ai` and never requires an API key. The isolated Playwright journey,
responsive smoke checks, and
automated accessibility gate run with:

```bash
npm run test:e2e:install
npm run test:e2e
```

`npm run security:matrix` verifies that every controller route and Prisma model
appears in `docs/security/control-matrix.md`. `npm run security:secrets` scans
tracked and pending files for credential files and known provider token formats.
Both checks are part of `npm run verify`.

Integration and browser tests recreate the isolated test database. The API's
deterministic test-login endpoint is disabled by default and is rejected in
production; the Playwright configuration enables it only for its isolated test
servers. Validate the local service definition with `npm run compose:validate`.

Stop the local database without deleting its named volume:

```bash
npm run db:down
```

## Repository boundaries

- `apps/web` owns browser presentation and client integration.
- `apps/api` owns HTTP delivery and feature-module orchestration.
- `packages/contracts` owns runtime transport schemas and inferred types.
- `packages/domain` owns framework-free business rules.
- `packages/config` owns shared TypeScript and lint configuration.

All user-owned API reads and writes receive the owner ID from the authenticated
session. Request bodies must never select an owner. Cookie-authenticated
mutations also require an allowlisted `Origin` header.

Feature controllers must delegate lifecycle changes to domain services. They
must not write task or workflow status fields directly.
