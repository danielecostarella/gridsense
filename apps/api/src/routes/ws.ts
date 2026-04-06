import { createBunWebSocket } from "hono/bun";
import { Hono } from "hono";
import { ReadingsSubscriber } from "@gridsense/events";
import type { LiveReadingsEvent } from "@gridsense/events";

/**
 * WebSocket endpoint — /ws
 *
 * Streams live readings to every connected browser client.
 * The subscriber receives events from Redis (published by the collector)
 * and fans them out to all open WS connections.
 *
 * One Redis subscription is shared across all clients — O(1) Redis load
 * regardless of how many browser tabs are open.
 */

export const { upgradeWebSocket, websocket } = createBunWebSocket();

type WSContext = Parameters<
  Parameters<typeof upgradeWebSocket>[0]
>[0]["raw"];

// Active connections — keyed by a simple incrementing ID for logging
const connections = new Map<number, { send: (data: string) => void }>();
let nextId = 0;

export function buildWsRouter(subscriber: ReadingsSubscriber): Hono {
  const app = new Hono();

  // Fan out every Redis event to all connected clients
  subscriber.onReadings((event: LiveReadingsEvent) => {
    const payload = JSON.stringify(event);
    for (const conn of connections.values()) {
      try {
        conn.send(payload);
      } catch {
        // Client already disconnected — cleanup happens in onClose
      }
    }
  });

  app.get(
    "/",
    upgradeWebSocket(() => {
      const id = nextId++;

      return {
        onOpen(_evt, ws) {
          connections.set(id, { send: (data) => ws.send(data) });
        },
        onClose() {
          connections.delete(id);
        },
        onMessage(evt) {
          // Clients can send a "ping" to check liveness; respond with "pong"
          if (evt.data === "ping") {
            connections.get(id)?.send("pong");
          }
        },
      };
    })
  );

  return app;
}

/** Expose active connection count for the /health endpoint */
export function wsConnectionCount(): number {
  return connections.size;
}
