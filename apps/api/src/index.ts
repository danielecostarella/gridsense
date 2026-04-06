import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ShellyClient } from "@gridsense/shelly-client";
import { createDb } from "@gridsense/db";
import { ReadingsSubscriber } from "@gridsense/events";
import { readingsRouter } from "./routes/readings.js";
import { energyRouter } from "./routes/energy.js";
import { liveRouter } from "./routes/live.js";
import { buildWsRouter, websocket, wsConnectionCount } from "./routes/ws.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  redisUrl: requireEnv("REDIS_URL"),
  shellyHost: requireEnv("SHELLY_HOST"),
  shellyTimeoutMs: parseInt(process.env["SHELLY_TIMEOUT_MS"] ?? "3000", 10),
  port: parseInt(process.env["API_PORT"] ?? "3000", 10),
};

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const { db, sql } = createDb(config.databaseUrl);
const shellyClient = new ShellyClient({
  host: config.shellyHost,
  timeoutMs: config.shellyTimeoutMs,
});
const subscriber = new ReadingsSubscriber(config.redisUrl);
await subscriber.connect();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.route("/api/readings", readingsRouter(db));
app.route("/api/energy", energyRouter(db));
app.route("/api/live", liveRouter(shellyClient));
app.route("/ws", buildWsRouter(subscriber));

app.get("/health", (c) =>
  c.json({
    status: "ok",
    ts: new Date().toISOString(),
    ws_connections: wsConnectionCount(),
  })
);

app.notFound((c) =>
  c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404)
);

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      path: c.req.path,
      error: err.message,
    })
  );
  return c.json({ error: "Internal server error" }, 500);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const shutdown = async () => {
  await Promise.all([sql.end(), subscriber.disconnect()]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Start — note: websocket handler is required for Bun's WS upgrade
// ---------------------------------------------------------------------------
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    event: "gridsense_api_starting",
    port: config.port,
  })
);

Bun.serve({ fetch: app.fetch, websocket, port: config.port });
