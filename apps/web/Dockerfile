FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages

RUN yarn install
RUN yarn workspace web build

CMD ["yarn", "workspace", "web", "start"]

