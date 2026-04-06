import { Hono } from "hono";
import { sql, desc } from "drizzle-orm";
import type { Db } from "@gridsense/db";
import { anomaliesTable } from "@gridsense/db";

export function anomaliesRouter(db: Db) {
  const app = new Hono();

  /**
   * GET /anomalies
   *
   * Returns recent anomaly events.
   *
   * Query params:
   *   limit   max rows (default 50, max 500)
   *   from    ISO 8601 (default: last 24h)
   *   channel 0 | 1 (default: both)
   *   type    spike | night_load | sustained_high (default: all)
   */
  app.get("/", async (c) => {
    const limit   = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 500);
    const from    = c.req.query("from")
      ? new Date(c.req.query("from")!)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const channel = c.req.query("channel");
    const type    = c.req.query("type");

    const rows = await db
      .select()
      .from(anomaliesTable)
      .where(
        sql`detected_at >= ${from}
          ${channel !== undefined ? sql`AND channel_id = ${parseInt(channel, 10)}` : sql``}
          ${type     !== undefined ? sql`AND type = ${type}` : sql``}`
      )
      .orderBy(desc(anomaliesTable.detectedAt))
      .limit(limit);

    return c.json({ data: rows, meta: { from, count: rows.length } });
  });

  /**
   * GET /anomalies/summary
   *
   * Aggregated count per type for the last 24h.
   * Useful for dashboard badges.
   */
  app.get("/summary", async (c) => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db.execute(sql`
      SELECT
        type,
        count(*)::int AS count,
        max(detected_at) AS last_seen
      FROM anomalies
      WHERE detected_at >= ${from}
      GROUP BY type
      ORDER BY count DESC
    `);

    const total = (rows as Array<{ count: number }>)
      .reduce((s, r) => s + Number(r.count), 0);

    return c.json({ data: rows, meta: { from, total } });
  });

  return app;
}
