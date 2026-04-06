-- Anomalies hypertable — stores detector events from the collector.
-- Applied automatically on container start via docker-entrypoint-initdb.d.

CREATE TABLE IF NOT EXISTS anomalies (
  detected_at   TIMESTAMPTZ     NOT NULL,
  channel_id    SMALLINT        NOT NULL,
  type          TEXT            NOT NULL,  -- spike | night_load | sustained_high
  act_power_w   REAL            NOT NULL,
  baseline_w    REAL            NOT NULL,
  deviation     REAL            NOT NULL,
  description   TEXT            NOT NULL
);

SELECT create_hypertable(
  'anomalies',
  by_range('detected_at', INTERVAL '30 days'),
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS anomalies_detected_at_idx
  ON anomalies (detected_at DESC, channel_id);
