FROM node:22-alpine AS base

# ── deps: install in the correct monorepo path so relative paths resolve ──
FROM base AS deps
WORKDIR /workspace/apps/web
COPY apps/web/package.json ./
RUN npm install

# ── builder: mirror the monorepo layout so ../../tsconfig.base.json resolves ──
FROM base AS builder
WORKDIR /workspace

COPY tsconfig.base.json ./
COPY --from=deps /workspace/apps/web/node_modules ./apps/web/node_modules
COPY apps/web/ ./apps/web/

WORKDIR /workspace/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runner: minimal production image ──────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S gridsense && adduser -S gridsense -G gridsense

COPY --from=builder /workspace/apps/web/public ./public
COPY --from=builder --chown=gridsense:gridsense /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=gridsense:gridsense /workspace/apps/web/.next/static ./.next/static

USER gridsense
EXPOSE 3002
ENV PORT=3002
CMD ["node", "server.js"]
