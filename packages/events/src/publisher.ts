import Redis from "ioredis";
import type { LiveReadingsEvent, ReadingsPayload } from "./types.js";
import { CHANNEL_READINGS } from "./types.js";

export class ReadingsPublisher {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async publish(event: LiveReadingsEvent): Promise<void> {
    const payload: ReadingsPayload = JSON.stringify(event);
    await this.redis.publish(CHANNEL_READINGS, payload);
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
