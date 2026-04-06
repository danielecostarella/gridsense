import Redis from "ioredis";
import type { LiveReadingsEvent, ReadingsPayload } from "./types.js";
import { CHANNEL_READINGS } from "./types.js";

export class ReadingsPublisher {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      enableReadyCheck: true,
    });

    this.redis.on("error", (err: Error) => {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "redis_pub_error",
          error: err?.message ?? String(err),
        })
      );
    });
  }

  async connect(): Promise<void> {
    if (this.redis.status === "ready") return;
    await new Promise<void>((resolve, reject) => {
      this.redis.once("ready", resolve);
      this.redis.once("error", reject);
    });
  }

  async publish(event: LiveReadingsEvent): Promise<void> {
    const payload: ReadingsPayload = JSON.stringify(event);
    await this.redis.publish(CHANNEL_READINGS, payload);
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
