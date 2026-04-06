import { Hono } from "hono";
import { ShellyClient, ShellyMqttCollector } from "@gridsense/shelly-client";
import { createDb, emReadings, anomaliesTable } from "@gridsense/db";
import { ReadingsPublisher } from "@gridsense/events";
import { AnomalyDetector } from "@gridsense/anomaly";
import type { ChannelReading } from "@gridsense/shelly-client";
import type { NewEmReading } from "@gridsense/db";
import type { LiveReadingsEvent } from "@gridsense/events";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const config = {
  shellyHost:      requireEnv("SHELLY_HOST"),
  shellyTimeoutMs: parseInt(process.env["SHELLY_TIMEOUT_MS"]        ?? "3000",  10),
  pollIntervalMs:  parseInt(process.env["SHELLY_POLL_INTERVAL_MS"]  ?? "5000",  10),
  mqttPrefix:      process.env["SHELLY_MQTT_PREFIX"] ?? null, // null = HTTP mode
  mqttBrokerUrl:   process.env["MQTT_BROKER_URL"] ?? "mqtt://localhost:1883",
  databaseUrl:     requireEnv("DATABASE_URL"),
  redisUrl:        requireEnv("REDIS_URL"),
  port:            parseInt(process.env["COLLECTOR_PORT"] ?? "3001", 10),
};

const MODE = config.mqttPrefix ? "mqtt" : "http";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface CollectorState {
  mode: "mqtt" | "http";
  deviceOnline: boolean | null; // null = unknown (HTTP mode has no LWT)
  lastReadings: [ChannelReading, ChannelReading] | null;
  totalReadings: number;
  failedReadings: number;
  startedAt: Date;
}

const state: CollectorState = {
  mode: MODE,
  deviceOnline: null,
  lastReadings: null,
  totalReadings: 0,
  failedReadings: 0,
  startedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function toDbRow(r: ChannelReading): NewEmReading {
  return {
    sampledAt:           r.sampledAt,
    channelId:           r.channelId,
    voltage:             r.voltage,
    current:             r.current,
    actPower:            r.actPower,
    aprtPower:           r.aprtPower,
    powerFactor:         r.powerFactor,
    frequency:           r.frequency,
    reactivePower:       r.reactivePower,
    totalActEnergy:      r.totalActEnergy,
    totalActRetEnergy:   r.totalActRetEnergy,
  };
}

function toEvent(readings: [ChannelReading, ChannelReading]): LiveReadingsEvent {
  const [ch0, ch1] = readings;
  const totalActPowerW      = ch0.actPower    + ch1.actPower;
  const totalAprtPowerVA    = ch0.aprtPower   + ch1.aprtPower;
  const totalReactivePowerVAr = ch0.reactivePower + ch1.reactivePower;
  return {
    sampledAt: ch0.sampledAt.toISOString(),
    channels: [
      {
        channelId: 0, voltageV: ch0.voltage, currentA: ch0.current,
        actPowerW: ch0.actPower, aprtPowerVA: ch0.aprtPower,
        reactivePowerVAr: ch0.reactivePower, powerFactor: ch0.powerFactor,
        frequencyHz: ch0.frequency,
        totalActEnergyKwh: ch0.totalActEnergy / 1000,
        totalActRetEnergyKwh: ch0.totalActRetEnergy / 1000,
      },
      {
        channelId: 1, voltageV: ch1.voltage, currentA: ch1.current,
        actPowerW: ch1.actPower, aprtPowerVA: ch1.aprtPower,
        reactivePowerVAr: ch1.reactivePower, powerFactor: ch1.powerFactor,
        frequencyHz: ch1.frequency,
        totalActEnergyKwh: ch1.totalActEnergy / 1000,
        totalActRetEnergyKwh: ch1.totalActRetEnergy / 1000,
      },
    ],
    system: {
      totalActPowerW, totalAprtPowerVA, totalReactivePowerVAr,
      netPowerW: totalActPowerW,
    },
  };
}

const anomalyDetector = new AnomalyDetector({
  nightLoadThresholdW:     parseFloat(process.env["ANOMALY_NIGHT_LOAD_W"]     ?? "150"),
  sustainedHighThresholdW: parseFloat(process.env["ANOMALY_SUSTAINED_HIGH_W"] ?? "3000"),
  spikeZThreshold:         parseFloat(process.env["ANOMALY_SPIKE_Z"]          ?? "3.5"),
});

async function onReadings(
  readings: [ChannelReading, ChannelReading],
  db: ReturnType<typeof createDb>["db"],
  publisher: ReadingsPublisher
): Promise<void> {
  state.lastReadings = readings;
  state.totalReadings++;

  // Run anomaly detection for both channels
  const detected = [
    ...anomalyDetector.process(0, readings[0].actPower, readings[0].sampledAt),
    ...anomalyDetector.process(1, readings[1].actPower, readings[1].sampledAt),
  ];

  const ops: Promise<unknown>[] = [
    db.insert(emReadings).values(readings.map(toDbRow)),
    publisher.publish(toEvent(readings)),
  ];

  if (detected.length > 0) {
    ops.push(
      db.insert(anomaliesTable).values(
        detected.map((a) => ({
          detectedAt:  a.detectedAt,
          channelId:   a.channelId,
          type:        a.type,
          actPowerW:   a.actPowerW,
          baselineW:   a.baselineW,
          deviation:   a.deviation,
          description: a.description,
        }))
      )
    );
    for (const a of detected) {
      log("info", "anomaly_detected", {
        type: a.type, channel: a.channelId,
        power_w: a.actPowerW, description: a.description,
      });
    }
  }

  await Promise.all(ops);
  log("debug", "reading_stored", {
    ch0_w: readings[0].actPower,
    ch1_w: readings[1].actPower,
    anomalies: detected.length,
    mode: MODE,
  });
}

function round(n: number, d = 1) { const f = 10 ** d; return Math.round(n * f) / f; }

function log(level: "info" | "debug" | "error", event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
}

// ---------------------------------------------------------------------------
// MQTT mode
// ---------------------------------------------------------------------------
async function runMqttMode(
  db: ReturnType<typeof createDb>["db"],
  publisher: ReadingsPublisher
): Promise<void> {
  log("info", "mqtt_mode_starting", { prefix: config.mqttPrefix, broker: config.mqttBrokerUrl });

  const collector = new ShellyMqttCollector({
    brokerUrl:    config.mqttBrokerUrl,
    topicPrefix:  config.mqttPrefix!,
  });

  collector.onOnline((online) => {
    state.deviceOnline = online;
    log("info", online ? "device_online" : "device_offline", { prefix: config.mqttPrefix });
  });

  collector.onReadings(async (readings) => {
    try {
      await onReadings(readings, db, publisher);
    } catch (err) {
      state.failedReadings++;
      log("error", "reading_store_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await collector.connect();
  log("info", "mqtt_subscribed");

  // In MQTT mode the event loop is driven by incoming messages.
  // Keep the process alive by waiting indefinitely.
  await new Promise<never>(() => {});
}

// ---------------------------------------------------------------------------
// HTTP polling mode (fallback)
// ---------------------------------------------------------------------------
async function runHttpMode(
  db: ReturnType<typeof createDb>["db"],
  publisher: ReadingsPublisher
): Promise<void> {
  log("info", "http_mode_starting", {
    host: config.shellyHost,
    intervalMs: config.pollIntervalMs,
  });

  const client = new ShellyClient({
    host:       config.shellyHost,
    timeoutMs:  config.shellyTimeoutMs,
  });

  while (true) {
    const t0 = Date.now();
    try {
      const readings = await client.poll();
      state.deviceOnline = true;
      await onReadings(readings, db, publisher);
    } catch (err) {
      state.failedReadings++;
      state.deviceOnline = false;
      log("error", "poll_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    await Bun.sleep(Math.max(0, config.pollIntervalMs - (Date.now() - t0)));
  }
}

// ---------------------------------------------------------------------------
// Internal HTTP API
// ---------------------------------------------------------------------------
function buildApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const healthy  = state.lastReadings !== null;
    const uptime   = Math.floor((Date.now() - state.startedAt.getTime()) / 1000);
    const errorRate = state.totalReadings > 0
      ? state.failedReadings / state.totalReadings : 0;

    return c.json({
      status:          healthy ? "ok" : "degraded",
      mode:            state.mode,
      device_online:   state.deviceOnline,
      uptime_s:        uptime,
      total_readings:  state.totalReadings,
      failed_readings: state.failedReadings,
      error_rate:      parseFloat(errorRate.toFixed(4)),
      last_sampled_at: state.lastReadings?.[0]?.sampledAt ?? null,
    }, healthy ? 200 : 503);
  });

  app.get("/latest", (c) => {
    if (!state.lastReadings)
      return c.json({ error: "No readings yet" }, 503);

    const [ch0, ch1] = state.lastReadings;
    return c.json({
      sampled_at: ch0.sampledAt,
      mode: state.mode,
      channels: {
        "0": { voltage_v: round(ch0.voltage), current_a: round(ch0.current, 3),
               act_power_w: round(ch0.actPower), power_factor: round(ch0.powerFactor, 3) },
        "1": { voltage_v: round(ch1.voltage), current_a: round(ch1.current, 3),
               act_power_w: round(ch1.actPower), power_factor: round(ch1.powerFactor, 3) },
      },
      totals: {
        act_power_w:      round(ch0.actPower + ch1.actPower),
        aprt_power_va:    round(ch0.aprtPower + ch1.aprtPower),
      },
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  log("info", "gridsense_collector_starting", { mode: MODE, port: config.port });

  const { db, sql } = createDb(config.databaseUrl);
  const publisher   = new ReadingsPublisher(config.redisUrl);
  await publisher.connect();

  const shutdown = async () => {
    log("info", "shutdown_initiated");
    await Promise.all([sql.end(), publisher.disconnect()]);
    process.exit(0);
  };
  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);

  Bun.serve({ fetch: buildApp().fetch, port: config.port });
  log("info", "http_server_listening", { port: config.port });

  if (MODE === "mqtt") {
    await runMqttMode(db, publisher);
  } else {
    await runHttpMode(db, publisher);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(), level: "error", event: "fatal",
    error: err instanceof Error ? err.message : String(err),
  }));
  process.exit(1);
});
