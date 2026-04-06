import { sql } from "drizzle-orm";
import type { Db } from "@gridsense/db";

export interface HistoryPoint {
  bucket: Date;
  channelId: number;
  avgActPower: number;
  maxActPower: number;
  minActPower: number;
  avgVoltage: number;
  avgCurrent: number;
  avgPowerFactor: number;
  avgReactivePower: number;
}

export interface LatestReading {
  sampledAt: Date;
  channelId: number;
  voltage: number;
  current: number;
  actPower: number;
  aprtPower: number;
  powerFactor: number;
  frequency: number;
  reactivePower: number;
  totalActEnergy: number;
  totalActRetEnergy: number;
}

/**
 * Returns the most recent row for each channel.
 */
export async function getLatestReadings(db: Db): Promise<LatestReading[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (channel_id)
      sampled_at        AS "sampledAt",
      channel_id        AS "channelId",
      voltage,
      current,
      act_power         AS "actPower",
      aprt_power        AS "aprtPower",
      power_factor      AS "powerFactor",
      frequency,
      reactive_power    AS "reactivePower",
      total_act_energy  AS "totalActEnergy",
      total_act_ret_energy AS "totalActRetEnergy"
    FROM em_readings
    ORDER BY channel_id, sampled_at DESC
  `);

  return rows as unknown as LatestReading[];
}

export type Resolution = "5s" | "1m" | "5m" | "15m" | "1h";

const BUCKET_MAP: Record<Resolution, string> = {
  "5s":  "5 seconds",
  "1m":  "1 minute",
  "5m":  "5 minutes",
  "15m": "15 minutes",
  "1h":  "1 hour",
};

/**
 * Returns time-bucketed aggregates for the requested range.
 *
 * Resolution is auto-selected if not provided:
 *   range < 1h   → 5s (raw-equivalent)
 *   range < 6h   → 1m
 *   range < 48h  → 5m
 *   otherwise    → 1h
 */
export async function getHistory(
  db: Db,
  from: Date,
  to: Date,
  channelId: number | null,
  resolution?: Resolution
): Promise<HistoryPoint[]> {
  const rangeMs = to.getTime() - from.getTime();
  const bucket = resolution ?? inferResolution(rangeMs);
  const interval = BUCKET_MAP[bucket];

  const channelFilter = channelId !== null
    ? sql`AND channel_id = ${channelId}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      time_bucket(${interval}::interval, sampled_at) AS bucket,
      channel_id                AS "channelId",
      round(avg(act_power)::numeric, 2)      AS "avgActPower",
      round(max(act_power)::numeric, 2)      AS "maxActPower",
      round(min(act_power)::numeric, 2)      AS "minActPower",
      round(avg(voltage)::numeric, 2)        AS "avgVoltage",
      round(avg(current)::numeric, 4)        AS "avgCurrent",
      round(avg(power_factor)::numeric, 4)   AS "avgPowerFactor",
      round(avg(reactive_power)::numeric, 2) AS "avgReactivePower"
    FROM em_readings
    WHERE sampled_at BETWEEN ${from} AND ${to}
      ${channelFilter}
    GROUP BY bucket, channel_id
    ORDER BY bucket ASC, channel_id ASC
  `);

  return rows as unknown as HistoryPoint[];
}

function inferResolution(rangeMs: number): Resolution {
  const h = 3_600_000;
  if (rangeMs < h)       return "5s";
  if (rangeMs < 6 * h)   return "1m";
  if (rangeMs < 48 * h)  return "5m";
  return "1h";
}
