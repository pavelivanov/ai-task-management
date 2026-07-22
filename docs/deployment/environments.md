# Deployment artifacts and environment contract

The private-pilot artifact topology remains deployment-provider neutral:

- one API container from `apps/api/Dockerfile` target `runtime`;
- one static web container from `apps/web/Dockerfile` target `runtime`;
- one managed PostgreSQL database;
- one API replica until shared worker claims and SSE pub/sub are introduced.

The web artifact is intentionally separate from NestJS. It is a small non-root
Node server that serves only the compiled SPA, `/sw.js`, and `/health`. Unknown
navigation routes fall back to `index.html`; missing asset paths return 404.
Hashed assets are immutable, while `index.html` and the service worker are never
durably cached.

## Build contract

Build immutable images from the repository root:

```bash
docker build --target runtime -f apps/api/Dockerfile -t execution-assistant-api:<commit-sha> .
docker build --target runtime -f apps/web/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://api.staging.example.com \
  -t execution-assistant-web:<commit-sha> .
```

`VITE_API_BASE_URL` is public browser configuration, not a secret, and is
compiled into the web artifact. Build a distinct immutable web image for each
environment. `VITE_E2E_AUTH_ENABLED` must remain `false` outside the isolated
smoke and browser-test topology.

The API image never applies migrations on startup. The same Dockerfile exposes
a separate `migration` target containing the pinned Prisma CLI and migration
files. A release operator runs that target as a visible, one-shot step before
starting the new API image:

```bash
docker build --target migration -f apps/api/Dockerfile -t execution-assistant-migrate:<commit-sha> .
docker run --rm \
  --env DATABASE_URL='<runtime-injected-secret>' \
  execution-assistant-migrate:<commit-sha>
```

Do not put the database URL or other secrets in image build arguments, image
layers, Compose manifests, or source control.

## Runtime variables

| Variable                                              | Local                         | Staging / production                   | Secret |
| ----------------------------------------------------- | ----------------------------- | -------------------------------------- | ------ |
| `NODE_ENV`                                            | `development` or `test`       | `production`                           | No     |
| `PORT`                                                | `3000`                        | platform-assigned or `3000`            | No     |
| `DATABASE_URL`                                        | local PostgreSQL              | managed PostgreSQL connection URL      | Yes    |
| `GOOGLE_CLIENT_ID`                                    | test/client value             | environment-specific OAuth client      | No     |
| `GOOGLE_CLIENT_SECRET`                                | local placeholder             | secret store                           | Yes    |
| `GOOGLE_CALLBACK_URL`                                 | local API callback            | exact public API callback              | No     |
| `AUTH_ALLOWED_CALLBACK_URLS`                          | local callback                | explicit comma-separated callbacks     | No     |
| `WEB_APP_URL`                                         | local web origin              | exact public web origin                | No     |
| `WEB_ORIGINS`                                         | local web origin              | explicit comma-separated web origins   | No     |
| `SESSION_COOKIE_NAME`                                 | default                       | stable per environment                 | No     |
| `TRUST_PROXY_HOPS`                                    | `0`                           | exact trusted reverse-proxy hop count  | No     |
| `LOG_LEVEL`                                           | `info` or `silent` in tests   | `info` or `error`                      | No     |
| `ASSISTANT_PROVIDER`                                  | `disabled` or `fake` in tests | `disabled` or `openai`                 | No     |
| `OPENAI_API_KEY`                                      | optional                      | secret store when provider is `openai` | Yes    |
| `OPENAI_MODEL`                                        | configured default            | pinned release model                   | No     |
| `PUSH_PROVIDER`                                       | `disabled` or `fake` in tests | `disabled` or `web-push`               | No     |
| `VAPID_SUBJECT`                                       | optional                      | configured contact URI                 | No     |
| `VAPID_PUBLIC_KEY`                                    | optional                      | deployment config                      | No     |
| `VAPID_PRIVATE_KEY`                                   | optional                      | secret store                           | Yes    |
| retention, rate, lease, and worker interval variables | `.env.example` defaults       | explicitly reviewed values             | No     |

`E2E_AUTH_ENABLED=true`, `ASSISTANT_PROVIDER=fake`, and `PUSH_PROVIDER=fake`
are rejected by production configuration and must never be used in staging or
production.

## Domain and cookie topology

Production must use HTTPS for both public origins. Because authentication uses
secure `SameSite=Lax` cookies and browser requests include credentials, the web
and API origins must be same-site—normally sibling hosts under one registrable
domain, such as `app.example.com` and `api.example.com`. Configure
`WEB_ORIGINS`, `WEB_APP_URL`, `GOOGLE_CALLBACK_URL`, and
`AUTH_ALLOWED_CALLBACK_URLS` with exact HTTPS origins/URLs; wildcard origins are
not supported.

The reverse proxy must preserve the public scheme and host and must not add more
trusted forwarding hops than `TRUST_PROXY_HOPS` declares. `/health` is liveness,
`/health/ready` is the traffic/readiness gate, and `/health/metrics` should be
restricted to the platform's private operational network.

## Local production-artifact smoke

`npm run container:smoke` uses `compose.production-smoke.yaml` with a unique
Compose project name and an in-memory PostgreSQL data directory. It builds the
migration, API, and web targets, applies migrations, waits for readiness, checks
non-root UIDs and SPA/service-worker behavior, and completes the deterministic
execution loop. It always removes the isolated containers, network, and volume
state when finished.

This smoke topology deliberately uses `NODE_ENV=test` and the test-login route
against production-built JavaScript. It validates artifacts without weakening
the production configuration, where test login is rejected.
