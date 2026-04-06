FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Copy all workspace manifests for bun install
COPY package.json ./
COPY packages/anomaly/package.json     ./packages/anomaly/
COPY packages/db/package.json          ./packages/db/
COPY packages/events/package.json      ./packages/events/
COPY packages/shelly-client/package.json ./packages/shelly-client/
COPY packages/tariff/package.json      ./packages/tariff/
COPY apps/api/package.json             ./apps/api/

RUN bun install

# Copy source
COPY packages/anomaly/src      ./packages/anomaly/src
COPY packages/db/src           ./packages/db/src
COPY packages/events/src       ./packages/events/src
COPY packages/shelly-client/src ./packages/shelly-client/src
COPY packages/tariff/src       ./packages/tariff/src
COPY apps/api/src              ./apps/api/src
COPY tsconfig.base.json        ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "apps/api/src/index.ts"]
