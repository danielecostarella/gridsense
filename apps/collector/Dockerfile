FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json ./
COPY packages/shelly-client/package.json ./packages/shelly-client/
COPY packages/db/package.json ./packages/db/
COPY apps/collector/package.json ./apps/collector/

RUN bun install

# Copy source
COPY packages/shelly-client/src ./packages/shelly-client/src
COPY packages/db/src ./packages/db/src
COPY apps/collector/src ./apps/collector/src
COPY tsconfig.base.json ./

ENV NODE_ENV=production

EXPOSE 3001

CMD ["bun", "run", "apps/collector/src/index.ts"]
