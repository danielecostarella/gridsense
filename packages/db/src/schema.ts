import {
  pgTable,
  smallint,
  real,
  doublePrecision,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";

/**
 * Core time-series table for energy meter readings.
 *
 * Converted to a TimescaleDB hypertable (partitioned by `sampled_at`) via the
 * migration in ../migrations/0000_init.sql. Drizzle sees it as a regular
 * pg table — TimescaleDB's transparent partitioning is invisible at the ORM
 * layer, which is exactly the point.
 *
 * Column design notes:
 * - `real` (4-byte float) is sufficient for instantaneous measurements; the
 *   precision loss is sub-milliwatt, well within the meter's ±1% accuracy.
 * - `double precision` is used for cumulative energy counters because values
 *   like 1,605,032.38 Wh would lose decimal digits in a 32-bit float.
 * - `sampled_at` uses the collector's wall clock, not the device's unixtime,
 *   to avoid drift from the Shelly's NTP sync gaps.
 */
export const emReadings = pgTable(
  "em_readings",
  {
    sampledAt: timestamp("sampled_at", { withTimezone: true, mode: "date" })
      .notNull(),

    /** 0 = channel A, 1 = channel B */
    channelId: smallint("channel_id").notNull(),

    /** RMS voltage [V] */
    voltage: real("voltage").notNull(),

    /** RMS current [A] */
    current: real("current").notNull(),

    /** Active (real) power [W] */
    actPower: real("act_power").notNull(),

    /** Apparent power [VA] */
    aprtPower: real("aprt_power").notNull(),

    /** Power factor [-1, 1] */
    powerFactor: real("power_factor").notNull(),

    /** Line frequency [Hz] */
    frequency: real("frequency").notNull(),

    /**
     * Reactive power magnitude [VAr] — derived: sqrt(S²-P²).
     * Stored to avoid recomputing across large aggregations.
     */
    reactivePower: real("reactive_power").notNull(),

    /** Cumulative active energy consumed [Wh] — monotonically increasing */
    totalActEnergy: doublePrecision("total_act_energy").notNull(),

    /**
     * Cumulative active energy returned to the grid [Wh].
     * Non-zero when a generation source (PV, battery) is on this channel.
     */
    totalActRetEnergy: doublePrecision("total_act_ret_energy").notNull(),
  },
  (t) => [
    index("em_readings_sampled_at_channel_idx").on(t.sampledAt, t.channelId),
  ]
);

export type EmReading = typeof emReadings.$inferSelect;
export type NewEmReading = typeof emReadings.$inferInsert;

// ---------------------------------------------------------------------------
// anomalies — detector events (hypertable via 0001_anomalies.sql)
// ---------------------------------------------------------------------------
export const anomaliesTable = pgTable(
  "anomalies",
  {
    detectedAt:  timestamp("detected_at", { withTimezone: true, mode: "date" }).notNull(),
    channelId:   smallint("channel_id").notNull(),
    type:        text("type").notNull(),
    actPowerW:   real("act_power_w").notNull(),
    baselineW:   real("baseline_w").notNull(),
    deviation:   real("deviation").notNull(),
    description: text("description").notNull(),
  },
  (t) => [
    index("anomalies_detected_at_idx").on(t.detectedAt, t.channelId),
  ]
);

export type AnomalyRow = typeof anomaliesTable.$inferSelect;
export type NewAnomalyRow = typeof anomaliesTable.$inferInsert;
