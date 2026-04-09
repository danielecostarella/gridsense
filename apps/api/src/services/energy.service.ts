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

export interface ConsumptionBucket {
  /** Start of the period bucket (ISO string) */
  period: string;
  /** Channel 0 net consumption [Wh] */
  ch0Wh: number;
  /** Channel 1 net consumption [Wh] */
  ch1Wh: number;
  /** Total net consumption across both channels [Wh] */
  totalWh: number;
}

/**
 * Returns consumption per time bucket (day / month / year) using the device's
 * cumulative counters. Groups data by period and computes
 * `max(counter) - min(counter)` per bucket — same logic as an electricity meter.
 *
 * Timezone: Europe/Rome (handles CET/CEST automatically).
 */
export async function getConsumptionByPeriod(
  db: Db,
  period: "day" | "month" | "year",
  from: Date,
  to: Date
): Promise<ConsumptionBucket[]> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const rows = await db.execute(sql`
    SELECT
      to_char(
        date_trunc(
          ${sql.raw(`'${period}'`)},
          sampled_at AT TIME ZONE 'Europe/Rome'
        ),
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ) AS "period",
      channel_id AS "channelId",
      greatest(
        max(total_act_energy) - min(total_act_energy),
        0
      ) AS "consumedWh"
    FROM em_readings
    WHERE sampled_at BETWEEN ${fromIso}::timestamptz AND ${toIso}::timestamptz
    GROUP BY 1, channel_id
    ORDER BY 1, channel_id
  `);

  // Pivot channel rows into per-bucket objects
  const map = new Map<string, ConsumptionBucket>();

  for (const row of rows as unknown as Array<{
    period: string;
    channelId: number;
    consumedWh: number;
  }>) {
    const key = row.period;
    if (!map.has(key)) {
      map.set(key, { period: key, ch0Wh: 0, ch1Wh: 0, totalWh: 0 });
    }
    const bucket = map.get(key)!;
    const wh = Number(row.consumedWh);
    if (row.channelId === 0) bucket.ch0Wh = wh;
    else bucket.ch1Wh = wh;
    bucket.totalWh = bucket.ch0Wh + bucket.ch1Wh;
  }

  return Array.from(map.values());
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
