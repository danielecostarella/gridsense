import { Hono } from "hono";
import type { Db } from "@gridsense/db";
import {
  getEnergyDelta,
  getEnergyToday,
  getPowerStats,
} from "../services/energy.service.js";

export function energyRouter(db: Db) {
  const app = new Hono();

  /**
   * GET /energy/delta
   *
   * Energy consumed/produced between two timestamps, using the device's
   * cumulative counter — same principle as an electricity meter reading.
   *
   * Query params:
   *   from  ISO 8601 (required)
   *   to    ISO 8601 (default: now)
   */
  app.get("/delta", async (c) => {
    const fromStr = c.req.query("from");
    if (!fromStr) {
      return c.json({ error: "Missing required param: from" }, 400);
    }

    const from = new Date(fromStr);
    const to = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return c.json({ error: "Invalid date format. Use ISO 8601." }, 400);
    }

    const deltas = await getEnergyDelta(db, from, to);

    // Aggregate across channels for a "whole-house" total
    const total = deltas.reduce(
      (acc, d) => ({
        consumedWh: acc.consumedWh + d.consumedWh,
        returnedWh: acc.returnedWh + d.returnedWh,
        netWh: acc.netWh + d.netWh,
      }),
      { consumedWh: 0, returnedWh: 0, netWh: 0 }
    );

    return c.json({
      data: { channels: deltas, total },
      meta: { from, to },
    });
  });

  /**
   * GET /energy/today
   *
   * Shorthand for /energy/delta?from=<today midnight UTC>.
   * Useful for dashboard "today's consumption" cards.
   */
  app.get("/today", async (c) => {
    const deltas = await getEnergyToday(db);

    const total = deltas.reduce(
      (acc, d) => ({
        consumedWh: acc.consumedWh + d.consumedWh,
        returnedWh: acc.returnedWh + d.returnedWh,
        netWh: acc.netWh + d.netWh,
      }),
      { consumedWh: 0, returnedWh: 0, netWh: 0 }
    );

    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    return c.json({
      data: { channels: deltas, total },
      meta: { from: todayMidnight, to: new Date() },
    });
  });

  /**
   * GET /energy/stats
   *
   * Min/max/avg power and electrical parameters for a time window.
   * Useful for demand analysis and load profiling.
   *
   * Query params:
   *   from  ISO 8601 (required)
   *   to    ISO 8601 (default: now)
   */
  app.get("/stats", async (c) => {
    const fromStr = c.req.query("from");
    if (!fromStr) {
      return c.json({ error: "Missing required param: from" }, 400);
    }

    const from = new Date(fromStr);
    const to = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();

    if (isNaN(from.getTime())) {
      return c.json({ error: "Invalid date format. Use ISO 8601." }, 400);
    }

    const stats = await getPowerStats(db, from, to);
    return c.json({ data: stats, meta: { from, to } });
  });

  return app;
}
