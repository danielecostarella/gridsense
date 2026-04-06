import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Db } from "@gridsense/db";
import { loadRatesFromEnv, BAND_META, classifyBand } from "@gridsense/tariff";
import type { TariffBand } from "@gridsense/tariff";

const rates = loadRatesFromEnv();

interface BandRow {
  band: TariffBand;
  channelId: number;
  energyKwh: number;
}

/**
 * Computes cost per tariff band using the 1-minute continuous aggregate.
 *
 * Each 1-minute bucket contributes: energy_kwh = avg_act_power × (1/60) / 1000
 * then multiplied by the rate for the band active at that bucket's timestamp.
 *
 * Timestamps are classified in Europe/Rome time via AT TIME ZONE in PostgreSQL.
 * Public holidays are not handled at the SQL layer — the F2/F3 distinction at
 * the boundary is within ±1 hour of accuracy for billing estimates.
 */
async function queryCostByBand(db: Db, from: Date, to: Date): Promise<BandRow[]> {
  const rows = await db.execute(sql`
    WITH rome AS (
      SELECT
        bucket,
        channel_id,
        avg_act_power,
        (bucket AT TIME ZONE 'Europe/Rome') AS lt
      FROM em_readings_1m
      WHERE bucket BETWEEN ${from} AND ${to}
        AND avg_act_power > 0
    )
    SELECT
      CASE
        WHEN EXTRACT(isodow FROM lt) = 7 THEN 'F3'
        WHEN EXTRACT(isodow FROM lt) = 6
          AND EXTRACT(hour FROM lt) >= 7
          AND EXTRACT(hour FROM lt) < 23 THEN 'F2'
        WHEN EXTRACT(isodow FROM lt) IN (1,2,3,4,5)
          AND EXTRACT(hour FROM lt) >= 8
          AND EXTRACT(hour FROM lt) < 19 THEN 'F1'
        WHEN EXTRACT(isodow FROM lt) IN (1,2,3,4,5)
          AND (
            (EXTRACT(hour FROM lt) >= 7 AND EXTRACT(hour FROM lt) < 8) OR
            (EXTRACT(hour FROM lt) >= 19 AND EXTRACT(hour FROM lt) < 23)
          ) THEN 'F2'
        ELSE 'F3'
      END AS band,
      channel_id AS "channelId",
      -- kWh = W × (1 min / 60 min/h) / 1000 W/kW
      round(SUM(avg_act_power * (1.0 / 60.0) / 1000.0)::numeric, 4) AS "energyKwh"
    FROM rome
    GROUP BY band, channel_id
    ORDER BY channel_id, band
  `);

  return rows as unknown as BandRow[];
}

export function costRouter(db: Db) {
  const app = new Hono();

  /**
   * GET /cost/breakdown
   *
   * Energy and estimated cost per tariff band for the requested window.
   *
   * Query params:
   *   from  ISO 8601 (required)
   *   to    ISO 8601 (default: now)
   */
  app.get("/breakdown", async (c) => {
    const fromStr = c.req.query("from");
    if (!fromStr) return c.json({ error: "Missing required param: from" }, 400);

    const from = new Date(fromStr);
    const to   = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();

    if (isNaN(from.getTime())) return c.json({ error: "Invalid date format" }, 400);

    const rows = await queryCostByBand(db, from, to);

    // Build per-channel + total summary
    const summary: Record<string, {
      band: TariffBand;
      energyKwh: number;
      costEur: number;
      rateEur: number;
      label: string;
      color: string;
    }[]> = {};

    let totalEnergyKwh = 0;
    let totalCostEur   = 0;

    for (const row of rows) {
      const key  = String(row.channelId);
      const rate = rates[row.band];
      const kwh  = Number(row.energyKwh);
      const cost = parseFloat((kwh * rate).toFixed(4));

      summary[key] ??= [];
      summary[key]!.push({
        band: row.band,
        energyKwh: kwh,
        costEur: cost,
        rateEur: rate,
        ...BAND_META[row.band],
      });

      totalEnergyKwh += kwh;
      totalCostEur   += cost;
    }

    return c.json({
      data: {
        channels: summary,
        total: {
          energyKwh: parseFloat(totalEnergyKwh.toFixed(4)),
          costEur:   parseFloat(totalCostEur.toFixed(4)),
        },
        rates,
      },
      meta: { from, to },
    });
  });

  /**
   * GET /cost/today — shorthand for breakdown since midnight (Rome time).
   */
  app.get("/today", async (c) => {
    // Midnight in Rome local time
    const romeNow     = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
    const romeMidnight = new Date(romeNow);
    romeMidnight.setHours(0, 0, 0, 0);
    // Convert back to UTC for the DB query
    const utcOffset   = new Date().getTime() - romeNow.getTime();
    const from        = new Date(romeMidnight.getTime() + utcOffset);

    const rows        = await queryCostByBand(db, from, new Date());

    let totalEnergyKwh = 0;
    let totalCostEur   = 0;
    const bands: Record<TariffBand, { energyKwh: number; costEur: number }> = {
      F1: { energyKwh: 0, costEur: 0 },
      F2: { energyKwh: 0, costEur: 0 },
      F3: { energyKwh: 0, costEur: 0 },
    };

    for (const row of rows) {
      const kwh  = Number(row.energyKwh);
      const cost = kwh * rates[row.band];
      bands[row.band].energyKwh += kwh;
      bands[row.band].costEur   += cost;
      totalEnergyKwh += kwh;
      totalCostEur   += cost;
    }

    return c.json({
      data: {
        bands: Object.entries(bands).map(([band, v]) => ({
          band,
          energyKwh: parseFloat(v.energyKwh.toFixed(4)),
          costEur:   parseFloat(v.costEur.toFixed(4)),
          rateEur:   rates[band as TariffBand],
          ...BAND_META[band as TariffBand],
        })),
        total: {
          energyKwh: parseFloat(totalEnergyKwh.toFixed(4)),
          costEur:   parseFloat(totalCostEur.toFixed(4)),
        },
        rates,
      },
      meta: { from, to: new Date() },
    });
  });

  /**
   * GET /cost/current-band — current active tariff band.
   */
  app.get("/current-band", (c) => {
    const band = classifyBand(new Date());
    return c.json({ band, ...BAND_META[band], rate: rates[band] });
  });

  return app;
}
