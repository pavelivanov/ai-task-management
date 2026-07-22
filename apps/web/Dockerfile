FROM node:24.18.0-alpine AS build
WORKDIR /app

RUN npm install --global npm@11.9.0 \
  && test "$(node --version)" = "v24.18.0" \
  && test "$(npm --version)" = "11.9.0"

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --ignore-scripts

COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build --workspace packages/contracts

ARG VITE_API_BASE_URL=http://127.0.0.1:3000
ARG VITE_E2E_AUTH_ENABLED=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_E2E_AUTH_ENABLED=$VITE_E2E_AUTH_ENABLED
RUN npm run build --workspace apps/web

FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV=production
ENV WEB_PORT=8080
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/dist dist
COPY --chown=node:node apps/web/server.mjs server.mjs

USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.WEB_PORT + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
