FROM oven/bun:1.2-alpine AS base
WORKDIR /app

COPY package.json ./
COPY packages/shelly-client/package.json ./packages/shelly-client/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

RUN bun install

COPY packages/shelly-client/src ./packages/shelly-client/src
COPY packages/db/src ./packages/db/src
COPY apps/api/src ./apps/api/src
COPY tsconfig.base.json ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "apps/api/src/index.ts"]
