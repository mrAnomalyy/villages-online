FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json vitest.config.ts playwright.config.ts ./
COPY packages ./packages
COPY services/gateway ./services/gateway

RUN yarn install
RUN yarn workspace gateway build

CMD ["yarn", "workspace", "gateway", "start:tsx"]
