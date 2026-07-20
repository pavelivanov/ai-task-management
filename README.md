# AI Execution Assistant

A TypeScript modular monolith for helping people turn intentions into completed
work. The repository currently contains the verified application foundation:
a React/Vite client, a NestJS API, shared domain and transport packages, and a
local PostgreSQL service.

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

## Verification

Run the complete non-browser gate with:

```bash
npm run verify
```

Individual gates are available as `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run test:integration`, and
`npm run build`. Integration tests recreate the isolated test database. Validate
the local service definition with `npm run compose:validate`.

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
