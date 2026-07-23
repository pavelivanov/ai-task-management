FROM node:24.18.0-alpine AS workspace
WORKDIR /app

RUN npm install --global npm@11.9.0 \
  && test "$(node --version)" = "v24.18.0" \
  && test "$(npm --version)" = "11.9.0"

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json

FROM workspace AS build
COPY tsconfig.base.json prisma.config.ts ./
COPY prisma prisma
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace apps/api
RUN node -e "require('./apps/api/dist/generated/prisma/client.js')"

FROM build AS migration
ARG IMAGE_REVISION=unknown
ENV NODE_ENV=production
LABEL org.opencontainers.image.revision=$IMAGE_REVISION
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM workspace AS production-dependencies
RUN npm ci --omit=dev --ignore-scripts \
  --workspace apps/api \
  --workspace packages/contracts \
  --workspace packages/domain

FROM node:24.18.0-alpine AS runtime
ARG IMAGE_REVISION=unknown
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
LABEL org.opencontainers.image.revision=$IMAGE_REVISION

COPY --from=production-dependencies --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/domain/package.json packages/domain/package.json
COPY --from=build --chown=node:node /app/packages/domain/dist packages/domain/dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health/ready').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
