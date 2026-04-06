-- GridSense — initial schema
-- Requires TimescaleDB extension (bundled in the timescale/timescaledb Docker image).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- em_readings — core hypertable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS em_readings (
  sampled_at        TIMESTAMPTZ     NOT NULL,
  channel_id        SMALLINT        NOT NULL,
  voltage           REAL            NOT NULL,
  current           REAL            NOT NULL,
  act_power         REAL            NOT NULL,
  aprt_power        REAL            NOT NULL,
  power_factor      REAL            NOT NULL,
  frequency         REAL            NOT NULL,
  reactive_power    REAL            NOT NULL,
  total_act_energy  DOUBLE PRECISION NOT NULL,
  total_act_ret_energy DOUBLE PRECISION NOT NULL
);

-- Convert to a hypertable partitioned by time (7-day chunks at 5s resolution
-- equals ~120k rows/chunk/channel — well within TimescaleDB's sweet spot).
SELECT create_hypertable(
  'em_readings',
  by_range('sampled_at', INTERVAL '7 days'),
  if_not_exists => TRUE
);

-- Composite index covering the most common query pattern:
-- "give me channel X readings between time A and B"
CREATE INDEX IF NOT EXISTS em_readings_sampled_at_channel_idx
  ON em_readings (sampled_at DESC, channel_id);

-- ---------------------------------------------------------------------------
-- Continuous aggregate — 1-minute OHLC-style rollup
-- Materialises min/max/avg per channel per minute so dashboards can query
-- hours of history without scanning millions of raw rows.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS em_readings_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', sampled_at)  AS bucket,
  channel_id,
  avg(act_power)                        AS avg_act_power,
  max(act_power)                        AS max_act_power,
  min(act_power)                        AS min_act_power,
  avg(voltage)                          AS avg_voltage,
  avg(current)                          AS avg_current,
  avg(power_factor)                     AS avg_power_factor,
  avg(reactive_power)                   AS avg_reactive_power,
  -- Last energy counter value in the bucket (for delta calculations)
  last(total_act_energy, sampled_at)    AS total_act_energy,
  last(total_act_ret_energy, sampled_at) AS total_act_ret_energy
FROM em_readings
GROUP BY bucket, channel_id
WITH NO DATA;

-- Keep the continuous aggregate refresh policy in sync with ingestion rate.
-- Refreshes every 1 minute, covering the last 2 minutes to handle late data.
SELECT add_continuous_aggregate_policy(
  'em_readings_1m',
  start_offset => INTERVAL '2 minutes',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);

-- ---------------------------------------------------------------------------
-- Retention policy — keep raw data for 90 days, aggregates indefinitely.
-- Adjust to taste.
-- ---------------------------------------------------------------------------
SELECT add_retention_policy(
  'em_readings',
  drop_after => INTERVAL '90 days',
  if_not_exists => TRUE
);
