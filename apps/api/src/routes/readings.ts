import { Hono } from "hono";
import type { Db } from "@gridsense/db";
import {
  getLatestReadings,
  getHistory,
  type Resolution,
} from "../services/readings.service.js";

const VALID_RESOLUTIONS = new Set<Resolution>(["5s", "1m", "5m", "15m", "1h"]);

export function readingsRouter(db: Db) {
  const app = new Hono();

  /**
   * GET /readings/latest
   * Most recent measurement for each channel.
   */
  app.get("/latest", async (c) => {
    const rows = await getLatestReadings(db);
    return c.json({ data: rows });
  });

  /**
   * GET /readings/history
   *
   * Query params:
   *   from        ISO 8601 datetime (required)
   *   to          ISO 8601 datetime (default: now)
   *   channel     0 | 1 (default: both)
   *   resolution  5s | 1m | 5m | 15m | 1h (default: auto)
   */
  app.get("/history", async (c) => {
    const fromStr = c.req.query("from");
    if (!fromStr) {
      return c.json({ error: "Missing required param: from" }, 400);
    }

    const from = new Date(fromStr);
    const to = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return c.json({ error: "Invalid date format. Use ISO 8601." }, 400);
    }
    if (from >= to) {
      return c.json({ error: "'from' must be earlier than 'to'" }, 400);
    }

    const channelParam = c.req.query("channel");
    const channelId =
      channelParam !== undefined ? parseInt(channelParam, 10) : null;

    if (channelId !== null && channelId !== 0 && channelId !== 1) {
      return c.json({ error: "channel must be 0 or 1" }, 400);
    }

    const resParam = c.req.query("resolution") as Resolution | undefined;
    if (resParam && !VALID_RESOLUTIONS.has(resParam)) {
      return c.json(
        { error: `resolution must be one of: ${[...VALID_RESOLUTIONS].join(", ")}` },
        400
      );
    }

    const data = await getHistory(db, from, to, channelId, resParam);
    return c.json({ data, meta: { from, to, channelId, count: data.length } });
  });

  return app;
}
