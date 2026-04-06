import { Hono } from "hono";
import { ShellyClient } from "@gridsense/shelly-client";
import { createDb, emReadings } from "@gridsense/db";
import type { ChannelReading } from "@gridsense/shelly-client";
import type { NewEmReading } from "@gridsense/db";

// ---------------------------------------------------------------------------
// Config — all tunables live in env vars, with safe defaults
// ---------------------------------------------------------------------------
const config = {
  shellyHost: requireEnv("SHELLY_HOST"),
  shellyTimeoutMs: parseInt(process.env["SHELLY_TIMEOUT_MS"] ?? "3000", 10),
  pollIntervalMs: parseInt(process.env["SHELLY_POLL_INTERVAL_MS"] ?? "5000", 10),
  databaseUrl: requireEnv("DATABASE_URL"),
  port: parseInt(process.env["COLLECTOR_PORT"] ?? "3001", 10),
};

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

// ---------------------------------------------------------------------------
// State shared between the poll loop and the HTTP layer
// ---------------------------------------------------------------------------
interface CollectorState {
  lastReadings: [ChannelReading, ChannelReading] | null;
  totalPolls: number;
  failedPolls: number;
  startedAt: Date;
}

const state: CollectorState = {
  lastReadings: null,
  totalPolls: 0,
  failedPolls: 0,
  startedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------
function toDbRow(r: ChannelReading): NewEmReading {
  return {
    sampledAt: r.sampledAt,
    channelId: r.channelId,
    voltage: r.voltage,
    current: r.current,
    actPower: r.actPower,
    aprtPower: r.aprtPower,
    powerFactor: r.powerFactor,
    frequency: r.frequency,
    reactivePower: r.reactivePower,
    totalActEnergy: r.totalActEnergy,
    totalActRetEnergy: r.totalActRetEnergy,
  };
}

async function runPollLoop(
  client: ShellyClient,
  db: ReturnType<typeof createDb>["db"]
): Promise<void> {
  log("info", "poll_loop_started", { intervalMs: config.pollIntervalMs });

  while (true) {
    const pollStart = Date.now();

    try {
      const readings = await client.poll();
      state.lastReadings = readings;
      state.totalPolls++;

      await db.insert(emReadings).values(readings.map(toDbRow));

      log("debug", "poll_ok", {
        ch0_w: readings[0].actPower,
        ch1_w: readings[1].actPower,
        durationMs: Date.now() - pollStart,
      });
    } catch (err) {
      state.failedPolls++;
      log("error", "poll_failed", {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - pollStart,
      });
    }

    // Sleep for the remainder of the interval (saturates at 0 if poll was slow)
    const elapsed = Date.now() - pollStart;
    const sleep = Math.max(0, config.pollIntervalMs - elapsed);
    await Bun.sleep(sleep);
  }
}

// ---------------------------------------------------------------------------
// HTTP API — minimal, just enough to verify the loop is alive and healthy
// ---------------------------------------------------------------------------
function buildApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const healthy = state.lastReadings !== null;
    const uptime = Math.floor((Date.now() - state.startedAt.getTime()) / 1000);
    const errorRate =
      state.totalPolls > 0 ? state.failedPolls / state.totalPolls : 0;

    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        uptime_s: uptime,
        total_polls: state.totalPolls,
        failed_polls: state.failedPolls,
        error_rate: parseFloat(errorRate.toFixed(4)),
        last_sampled_at: state.lastReadings?.[0]?.sampledAt ?? null,
      },
      healthy ? 200 : 503
    );
  });

  app.get("/latest", (c) => {
    if (!state.lastReadings) {
      return c.json({ error: "No readings collected yet" }, 503);
    }

    const [ch0, ch1] = state.lastReadings;

    return c.json({
      sampled_at: ch0.sampledAt,
      channels: {
        "0": formatChannel(ch0),
        "1": formatChannel(ch1),
      },
      totals: {
        act_power_w: round(ch0.actPower + ch1.actPower),
        aprt_power_va: round(ch0.aprtPower + ch1.aprtPower),
        reactive_power_var: round(ch0.reactivePower + ch1.reactivePower),
      },
    });
  });

  return app;
}

function formatChannel(r: ChannelReading) {
  return {
    voltage_v: round(r.voltage),
    current_a: round(r.current, 3),
    act_power_w: round(r.actPower),
    aprt_power_va: round(r.aprtPower),
    reactive_power_var: round(r.reactivePower),
    power_factor: round(r.powerFactor, 3),
    frequency_hz: round(r.frequency, 2),
    total_act_energy_kwh: round(r.totalActEnergy / 1000, 3),
    total_act_ret_energy_kwh: round(r.totalActRetEnergy / 1000, 3),
  };
}

function round(n: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Structured logging — JSON lines, easy to pipe into any log aggregator
// ---------------------------------------------------------------------------
function log(
  level: "info" | "debug" | "error",
  event: string,
  data?: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level, event, ...data })
  );
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  log("info", "gridsense_collector_starting", {
    shellyHost: config.shellyHost,
    pollIntervalMs: config.pollIntervalMs,
    port: config.port,
  });

  const { db, sql } = createDb(config.databaseUrl);
  const client = new ShellyClient({
    host: config.shellyHost,
    timeoutMs: config.shellyTimeoutMs,
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    log("info", "shutdown_initiated");
    await sql.end();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    log("info", "shutdown_initiated");
    await sql.end();
    process.exit(0);
  });

  // Start HTTP server (non-blocking)
  const app = buildApp();
  Bun.serve({ fetch: app.fetch, port: config.port });
  log("info", "http_server_listening", { port: config.port });

  // Start poll loop (blocking — runs for the lifetime of the process)
  await runPollLoop(client, db);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "fatal",
      error: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
