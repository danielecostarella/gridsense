import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ShellyClient } from "@gridsense/shelly-client";
import { createDb } from "@gridsense/db";
import { readingsRouter } from "./routes/readings.js";
import { energyRouter } from "./routes/energy.js";
import { liveRouter } from "./routes/live.js";

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

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Routes
app.route("/api/readings", readingsRouter(db));
app.route("/api/energy", energyRouter(db));
app.route("/api/live", liveRouter(shellyClient));

// Health
app.get("/health", (c) =>
  c.json({ status: "ok", ts: new Date().toISOString() })
);

// 404
app.notFound((c) =>
  c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404)
);

// Error handler
app.onError((err, c) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    path: c.req.path,
    error: err.message,
  }));
  return c.json({ error: "Internal server error" }, 500);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
process.on("SIGINT", async () => {
  await sql.end();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await sql.end();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    event: "gridsense_api_starting",
    port: config.port,
    shellyHost: config.shellyHost,
  })
);

Bun.serve({ fetch: app.fetch, port: config.port });
