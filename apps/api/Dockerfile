FROM node:24.18.0-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/config packages/config
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:24.18.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
