FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY apps/web/package.json ./
RUN npm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S gridsense && adduser -S gridsense -G gridsense

COPY --from=builder /app/public ./public
COPY --from=builder --chown=gridsense:gridsense /app/.next/standalone ./
COPY --from=builder --chown=gridsense:gridsense /app/.next/static ./.next/static

USER gridsense
EXPOSE 3002
ENV PORT=3002
CMD ["node", "server.js"]
