import Redis from "ioredis";
import type { LiveReadingsEvent } from "./types.js";
import { CHANNEL_READINGS } from "./types.js";

export type ReadingsHandler = (event: LiveReadingsEvent) => void;

export class ReadingsSubscriber {
  private readonly redis: Redis;
  private handlers = new Set<ReadingsHandler>();

  constructor(redisUrl: string) {
    // Subscriber connections are dedicated — cannot issue other commands
    this.redis = new Redis(redisUrl, { lazyConnect: true });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
    await this.redis.subscribe(CHANNEL_READINGS);

    this.redis.on("message", (_channel: string, payload: string) => {
      try {
        const event = JSON.parse(payload) as LiveReadingsEvent;
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        // Malformed payload — ignore
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
