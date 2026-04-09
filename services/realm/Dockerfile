FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json ./
COPY packages ./packages
COPY services/realm ./services/realm

RUN yarn install
RUN yarn workspace realm build

CMD ["node", "services/realm/dist/index.js"]

