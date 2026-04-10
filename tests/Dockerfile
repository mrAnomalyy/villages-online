FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app

RUN corepack enable

COPY package.json .yarnrc.yml tsconfig.base.json playwright.config.ts vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY tests ./tests

RUN yarn install

CMD ["yarn", "playwright", "test"]

