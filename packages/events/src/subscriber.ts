import Redis from "ioredis";
import type { LiveReadingsEvent } from "./types.js";
import { CHANNEL_READINGS } from "./types.js";

export type ReadingsHandler = (event: LiveReadingsEvent) => void;

export class ReadingsSubscriber {
  private readonly redis: Redis;
  private handlers = new Set<ReadingsHandler>();

  constructor(redisUrl: string) {
    // Subscriber connections are dedicated — cannot issue regular commands
    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 200, 3000),
      enableReadyCheck: true,
    });

    this.redis.on("error", (err: Error) => {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "redis_sub_error",
          error: err?.message ?? String(err),
        })
      );
    });
  }

  async connect(): Promise<void> {
    if (this.redis.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        this.redis.once("ready", resolve);
        this.redis.once("error", reject);
      });
    }

    await this.redis.subscribe(CHANNEL_READINGS);

    this.redis.on("message", (_channel: string, payload: string) => {
      try {
        const event = JSON.parse(payload) as LiveReadingsEvent;
        for (const handler of this.handlers) handler(event);
      } catch {
        // Ignore malformed payload
      }
    });
  }

  onReadings(handler: ReadingsHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async disconnect(): Promise<void> {
    await this.redis.unsubscribe(CHANNEL_READINGS);
    await this.redis.quit();
  }
}
