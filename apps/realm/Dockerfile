# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json ./
COPY .yarn ./.yarn
COPY apps/realm/package.json ./apps/realm/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/world/package.json ./packages/world/package.json

RUN --mount=type=cache,target=/root/.yarn/berry/cache,id=villages-yarn-cache \
    YARN_CACHE_FOLDER=/root/.yarn/berry/cache yarn install

COPY packages ./packages
COPY apps/realm ./apps/realm
RUN yarn workspace realm build

CMD ["yarn", "workspace", "realm", "start:tsx"]
