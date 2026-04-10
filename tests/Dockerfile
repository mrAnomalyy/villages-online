# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json playwright.config.ts vitest.config.ts ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/realm/package.json ./services/realm/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/world/package.json ./packages/world/package.json

RUN --mount=type=cache,target=/root/.yarn/berry/cache,id=villages-yarn-cache \
    YARN_CACHE_FOLDER=/root/.yarn/berry/cache yarn install

COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY tests ./tests

CMD ["yarn", "playwright", "test"]
