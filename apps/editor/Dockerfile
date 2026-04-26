# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json ./
COPY apps/editor/package.json ./apps/editor/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/world/package.json ./packages/world/package.json

RUN --mount=type=cache,target=/root/.yarn/berry/cache,id=villages-yarn-cache \
    YARN_CACHE_FOLDER=/root/.yarn/berry/cache yarn install

COPY apps/editor ./apps/editor
COPY packages ./packages
RUN yarn workspace editor build

CMD ["yarn", "workspace", "editor", "start"]
