FROM node:20-alpine
WORKDIR /workspace

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json vitest.config.ts playwright.config.ts ./
COPY .yarn ./.yarn
COPY apps/editor/package.json ./apps/editor/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY apps/realm/package.json ./apps/realm/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/world/package.json ./packages/world/package.json

RUN YARN_CACHE_FOLDER=/root/.yarn/berry/cache yarn install

COPY apps ./apps
COPY packages ./packages
