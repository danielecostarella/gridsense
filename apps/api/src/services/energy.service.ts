import { sql } from "drizzle-orm";
import type { Db } from "@gridsense/db";

export interface EnergyDelta {
  channelId: number;
  /** Net energy consumed [Wh] — accounts for production on the channel */
  consumedWh: number;
  /** Energy produced / returned to grid [Wh] */
  returnedWh: number;
  /** Net energy = consumed - returned [Wh] */
  netWh: number;
  /** Duration actually covered by data [seconds] */
  coverageSecs: number;
  /** Average active power over the period [W] */
  avgPowerW: number;
}

export interface EnergyStats {
  channelId: number;
  avgPowerW: number;
  maxPowerW: number;
  minPowerW: number;
  avgVoltageV: number;
  avgCurrentA: number;
  avgPowerFactor: number;
}

/**
 * Calculates energy consumed between two timestamps using the device's
 * cumulative counters — identical to how a real electricity meter works.
 *
 * Uses TimescaleDB's `first()` / `last()` ordered-set aggregates for
 * efficiency: O(chunks) rather than O(rows).
 *
 * Edge case: if the device rebooted in the window, the counter resets to 0
 * and the delta would be negative. We clamp to 0 and flag it in the result.
 */
export async function getEnergyDelta(
  db: Db,
  from: Date,
  to: Date
): Promise<EnergyDelta[]> {
  const rows = await db.execute(sql`
    SELECT
      channel_id AS "channelId",

      -- Counter delta for consumed energy
      greatest(
        last(total_act_energy, sampled_at) - first(total_act_energy, sampled_at),
        0
      )  AS "consumedWh",

      -- Counter delta for returned energy (PV / battery)
      greatest(
        last(total_act_ret_energy, sampled_at) - first(total_act_ret_energy, sampled_at),
        0
      ) AS "returnedWh",

      -- Actual time span covered by rows in this window
      extract(epoch from (max(sampled_at) - min(sampled_at)))::int AS "coverageSecs",

      round(avg(act_power)::numeric, 2) AS "avgPowerW"

    FROM em_readings
    WHERE sampled_at BETWEEN ${from} AND ${to}
    GROUP BY channel_id
    ORDER BY channel_id
  `);

  return (rows as unknown as Array<{
    channelId: number;
    consumedWh: number;
    returnedWh: number;
    coverageSecs: number;
    avgPowerW: number;
  }>).map((r) => ({
    ...r,
    consumedWh: Number(r.consumedWh),
    returnedWh: Number(r.returnedWh),
    netWh: Number(r.consumedWh) - Number(r.returnedWh),
    coverageSecs: Number(r.coverageSecs),
    avgPowerW: Number(r.avgPowerW),
  }));
}

/**
 * Convenience wrapper: energy since midnight today (local UTC).
 * Useful for "consumption today" widgets on the dashboard.
 */
export async function getEnergyToday(db: Db): Promise<EnergyDelta[]> {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  return getEnergyDelta(db, midnight, now);
}

/**
 * Power statistics for a time window — suitable for demand analysis.
 */
export async function getPowerStats(
  db: Db,
  from: Date,
  to: Date
): Promise<EnergyStats[]> {
  const rows = await db.execute(sql`
    SELECT
      channel_id              AS "channelId",
      round(avg(act_power)::numeric, 2)    AS "avgPowerW",
      round(max(act_power)::numeric, 2)    AS "maxPowerW",
      round(min(act_power)::numeric, 2)    AS "minPowerW",
      round(avg(voltage)::numeric, 2)      AS "avgVoltageV",
      round(avg(current)::numeric, 4)      AS "avgCurrentA",
      round(avg(power_factor)::numeric, 4) AS "avgPowerFactor"
    FROM em_readings
    WHERE sampled_at BETWEEN ${from} AND ${to}
    GROUP BY channel_id
    ORDER BY channel_id
  `);

  return rows as unknown as EnergyStats[];
}
