import mqtt from "mqtt";
import type { EM1Channel, EM1Data, ChannelReading } from "./types.js";

export interface ShellyMqttOptions {
  brokerUrl: string;       // e.g. "mqtt://localhost:1883"
  topicPrefix: string;     // e.g. "gridsense/shelly" — must match Shelly config
  /** Max age [ms] of a cached channel value before it's considered stale */
  staleness?: number;
}

export type ReadingHandler = (readings: [ChannelReading, ChannelReading]) => void;
export type StatusHandler  = (online: boolean) => void;

interface ChannelCache {
  channel: EM1Channel | null;
  data: EM1Data | null;
  updatedAt: number; // Date.now()
}

/**
 * Subscribes to a Shelly Pro EM-50 via MQTT (Gen2 RPC-over-MQTT protocol).
 *
 * The Shelly publishes four status topics independently:
 *   {prefix}/status/em1:0      — CH0 instantaneous measurements
 *   {prefix}/status/em1:1      — CH1 instantaneous measurements
 *   {prefix}/status/em1data:0  — CH0 cumulative energy counters
 *   {prefix}/status/em1data:1  — CH1 cumulative energy counters
 *
 * We buffer the four topics and emit a combined [ChannelReading, ChannelReading]
 * whenever a new message arrives and the cached values are fresh enough.
 *
 * This is strictly event-driven — no polling, no timers.
 */
export class ShellyMqttCollector {
  private client: mqtt.MqttClient | null = null;
  private readonly handlers   = new Set<ReadingHandler>();
  private readonly onlineHandlers = new Set<StatusHandler>();
  private readonly staleness: number;
  private readonly prefix: string;

  private cache: [ChannelCache, ChannelCache] = [
    { channel: null, data: null, updatedAt: 0 },
    { channel: null, data: null, updatedAt: 0 },
  ];

  constructor(private readonly options: ShellyMqttOptions) {
    this.prefix    = options.topicPrefix;
    this.staleness = options.staleness ?? 10_000;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(this.options.brokerUrl, {
        clientId: `gridsense-collector-${Math.random().toString(16).slice(2, 8)}`,
        clean: true,
        reconnectPeriod: 3000,
        connectTimeout: 10_000,
      });

      client.on("connect", () => {
        const topics = [
          `${this.prefix}/status/em1:0`,
          `${this.prefix}/status/em1:1`,
          `${this.prefix}/status/em1data:0`,
          `${this.prefix}/status/em1data:1`,
          `${this.prefix}/online`,
        ];
        client.subscribe(topics, { qos: 0 }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      client.on("message", (topic: string, payload: Buffer) => {
        this.handleMessage(topic, payload);
      });

      client.on("error", (err) => {
        // After initial connect, errors are non-fatal (auto-reconnect)
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "mqtt_error",
          error: err.message,
        }));
      });

      this.client = client;
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const suffix = topic.slice(this.prefix.length + 1); // strip "prefix/"

    if (suffix === "online") {
      const online = payload.toString() !== "false";
      for (const h of this.onlineHandlers) h(online);
      return;
    }

    try {
      const json = JSON.parse(payload.toString()) as Record<string, unknown>;
      const now  = Date.now();

      if (suffix === "status/em1:0") {
        this.cache[0]!.channel    = json as unknown as EM1Channel;
        this.cache[0]!.updatedAt  = now;
      } else if (suffix === "status/em1:1") {
        this.cache[1]!.channel    = json as unknown as EM1Channel;
        this.cache[1]!.updatedAt  = now;
      } else if (suffix === "status/em1data:0") {
        this.cache[0]!.data       = json as unknown as EM1Data;
        this.cache[0]!.updatedAt  = now;
      } else if (suffix === "status/em1data:1") {
        this.cache[1]!.data       = json as unknown as EM1Data;
        this.cache[1]!.updatedAt  = now;
      } else {
        return; // unhandled topic
      }

      this.tryEmit();
    } catch {
      // Malformed payload — ignore
    }
  }

  /**
   * Emits a combined reading if both channels have fresh, complete data.
   */
  private tryEmit(): void {
    const now = Date.now();
    const [c0, c1] = this.cache;

    const fresh = (c: ChannelCache) =>
      c.channel !== null &&
      c.data    !== null &&
      now - c.updatedAt < this.staleness;

    if (!fresh(c0!) || !fresh(c1!)) return;

    const sampledAt = new Date();
    const readings: [ChannelReading, ChannelReading] = [0, 1].map((id) => {
      const c   = this.cache[id as 0 | 1]!;
      const ch  = c.channel!;
      const dat = c.data!;
      const S   = ch.aprt_power;
      const P   = ch.act_power;
      return {
        sampledAt,
        channelId: id as 0 | 1,
        voltage:          ch.voltage,
        current:          ch.current,
        actPower:         ch.act_power,
        aprtPower:        ch.aprt_power,
        powerFactor:      ch.pf,
        frequency:        ch.freq,
        reactivePower:    Math.sqrt(Math.max(S * S - P * P, 0)),
        totalActEnergy:   dat.total_act_energy,
        totalActRetEnergy: dat.total_act_ret_energy,
      } satisfies ChannelReading;
    }) as [ChannelReading, ChannelReading];

    for (const h of this.handlers) h(readings);
  }

  onReadings(handler: ReadingHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onOnline(handler: StatusHandler): () => void {
    this.onlineHandlers.add(handler);
    return () => this.onlineHandlers.delete(handler);
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, resolve);
    });
  }
}
