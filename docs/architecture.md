# GridSense — Architecture

## Overview

GridSense is a self-hosted, event-driven energy intelligence platform built around the Shelly Pro EM-50 smart meter. The design prioritises low latency for real-time dashboards while maintaining a clean separation between ingestion, storage, query, and presentation layers.

---

## System diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAN (192.168.x.x)                                                   │
│                                                                      │
│   ┌─────────────────┐   MQTT (preferred) / HTTP RPC fallback        │
│   │  Shelly Pro     │◄──────────────────────────────────────────┐   │
│   │  EM-50          │                                            │   │
│   └─────────────────┘                                            │   │
│           │ 2 channels (em1:0, em1:1)                             │   │
└───────────┼───────────────────────────────────────────────────────┘   │
            │                                                            │
            ▼                                                            │
   ┌─────────────────────────────────────────────────────────────┐      │
   │                     Docker Compose                          │      │
   │                                                             │      │
   │  ┌─────────────┐  ┌──────────────────────────────────────┐ │      │
   │  │  Mosquitto  │  │  collector (Bun + Hono)              │ │      │
   │  │  MQTT 2     │──│                                      │ │      │
   │  └─────────────┘  │  • MQTT subscriber (primary)         │──┘     │
   │                   │  • HTTP polling fallback (5s)         │        │
   │                   │  • Normalises & derives reactive power│        │
   │                   │  • Runs AnomalyDetector per reading   │        │
   │                   │  • Writes em_readings (TimescaleDB)   │        │
   │                   │  • Writes anomalies (TimescaleDB)     │        │
   │                   │  • Publishes to Redis pub/sub         │        │
   │                   │  • Exposes /health and /latest        │        │
   │                   └──────────┬──────────────┬────────────┘        │
   │                              │              │                      │
   │                   ┌──────────▼──────┐  ┌───▼─────────┐           │
   │                   │  TimescaleDB    │  │   Redis 7    │           │
   │                   │  (PostgreSQL 16)│  │  pub/sub bus │           │
   │                   │                │  └──────┬───────┘           │
   │                   │  em_readings   │         │ subscribe          │
   │                   │  hypertable    │         ▼                    │
   │                   │                │  ┌──────────────────────┐   │
   │                   │  em_readings_1m│  │  api (Bun + Hono)    │   │
   │                   │  continuous agg│  │                      │   │
   │                   │                │  │  REST:               │   │
   │                   │  anomalies     │  │  /api/readings/*     │   │
   │                   │  hypertable    │  │  /api/energy/*       │   │
   │                   └────────┬───────┘  │  /api/cost/*         │   │
   │                            │          │  /api/anomalies/*    │   │
   │                            └─────────►│  /api/live           │───┘
   │                                       │                      │
   │                                       │  WebSocket:          │
   │                                       │  WS /ws (fan-out)    │
   │                                       └──────────┬───────────┘
   │                                                  │ WS push ~5s
   │  ┌───────────────────────────────────────────────▼───────────┐
   │  │  web (Next.js 15, React 19)                                │
   │  │                                                            │
   │  │  • PowerFlow — animated SVG energy diagram                 │
   │  │  • MetricCard — live values with motion transitions        │
   │  │  • PowerChart — Recharts 1-hour rolling area chart         │
   │  │  • ConsumptionChart — bar chart per day/month/year        │
   │  │  • TodayEnergy — daily Wh via REST                        │
   │  │  • CostCard — today's cost by tariff band                 │
   │  │  • TariffBand — live F1/F2/F3 indicator                   │
   │  │  • AnomalyAlert — alert banner when anomalies detected     │
   │  └────────────────────────────────────────────────────────────┘
   └─────────────────────────────────────────────────────────────────┘
```

---

## Data flow

### Ingestion path (write)

```
Shelly EM-50
  └─ MQTT topic {prefix}/status/em1:0 and em1:1  (real-time, ~1s)
  │    └─ ShellyMqttCollector buffers + merges channels
  │         └─ (same pipeline below)
  └─ HTTP GET /rpc/Shelly.GetStatus  (fallback, every 5s)
       └─ collector normalises response
            ├─ AnomalyDetector.process() — spike / night_load / sustained_high
            ├─ INSERT em_readings (TimescaleDB hypertable)
            ├─ INSERT anomalies  (when anomalies detected)
            └─ PUBLISH gridsense:readings:live (Redis)
```

### Query path (read — REST)

```
Browser
  └─ GET /api/readings/history?from=…&resolution=1m
       └─ api queries em_readings (raw) or em_readings_1m (aggregate)
            └─ TimescaleDB time_bucket() / first() / last()

  └─ GET /api/energy/consumption?period=month
       └─ api queries em_readings with date_trunc(AT TIME ZONE 'Europe/Rome')
            └─ max(total_act_energy) - min(total_act_energy) per bucket

  └─ GET /api/cost/today
       └─ api queries em_readings_1m with CASE WHEN for F1/F2/F3 bands
```

### Real-time path (WebSocket)

```
Redis gridsense:readings:live
  └─ api ReadingsSubscriber receives event
       └─ fan-out to all connected WebSocket clients (O(1) Redis cost)
            └─ browser useLiveData hook → React state update → re-render
```

### Anomaly detection path

```
collector (in-process, per reading)
  └─ AnomalyDetector.process(channelId, actPowerW, sampledAt)
       ├─ spike:          |z-score| > 3.5  (rolling window 60 readings)
       ├─ night_load:     F3 hours AND power > 150 W
       └─ sustained_high: power > 3000 W for > 12 consecutive readings (~1 min)
            └─ (debounced: same type not re-fired within 5 min)
                 └─ INSERT INTO anomalies  ──►  GET /api/anomalies
                                           ──►  AnomalyAlert widget (30s poll)
```

---

## Database schema

### `em_readings` — hypertable (7-day chunks)

| Column | Type | Notes |
|--------|------|-------|
| `sampled_at` | `timestamptz` | Collector wall-clock (partition key) |
| `channel_id` | `smallint` | 0 or 1 |
| `voltage` | `real` | RMS [V] |
| `current` | `real` | RMS [A] |
| `act_power` | `real` | Active [W] |
| `aprt_power` | `real` | Apparent [VA] |
| `power_factor` | `real` | [-1, 1] |
| `frequency` | `real` | [Hz] |
| `reactive_power` | `real` | Derived: √(S²-P²) [VAr] |
| `total_act_energy` | `double precision` | Cumulative [Wh] — monotonic |
| `total_act_ret_energy` | `double precision` | Cumulative returned [Wh] |

### `em_readings_1m` — continuous aggregate

Auto-materialised 1-minute OHLC rollup. Used for history queries on ranges > 1 hour and for tariff-band cost aggregation. Refreshed every minute with a 2-minute lookback.

### `anomalies` — hypertable (30-day chunks)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | Primary key |
| `detected_at` | `timestamptz` | Detection timestamp (partition key) |
| `channel_id` | `smallint` | 0 or 1 |
| `type` | `text` | `spike` / `night_load` / `sustained_high` |
| `act_power_w` | `real` | Power at detection time [W] |
| `baseline_w` | `real` | Rolling mean or configured threshold [W] |
| `deviation` | `real` | z-score (spike) or ratio (others) |
| `description` | `text` | Human-readable description |

### Retention

Raw data (`em_readings`): 90 days.  
Anomalies (`anomalies`): 30 days.  
Aggregates (`em_readings_1m`): indefinite.

---

## Tariff engine

Italian time-of-use tariff bands classified in `Europe/Rome` timezone:

| Band | Hours | Days |
|------|-------|------|
| F1 | 08:00–19:00 | Mon–Fri (excl. holidays) |
| F2 | 07:00–08:00, 19:00–23:00 | Mon–Fri; 07:00–23:00 Sat |
| F3 | 23:00–07:00 | All days; full day Sun & public holidays |

Public holidays use the Meeus/Jones/Butcher algorithm for Easter and a fixed list of Italian national holidays. Classification is done per-reading in the collector (for anomaly detection) and per-query in the API (for cost endpoints using `AT TIME ZONE 'Europe/Rome'` SQL).

---

## Anomaly detection

Three statistical detectors run in-process in the collector after each reading, with no DB reads required for real-time detection:

| Detector | Trigger | Use case |
|----------|---------|----------|
| `spike` | \|z-score\| > 3.5 vs 60-reading rolling window | Sudden faults, unexpected appliances, meter errors |
| `night_load` | Power > 150 W during F3 hours | Devices left on accidentally overnight |
| `sustained_high` | Power > 3000 W for > 12 consecutive readings | Heating/cooling runaway, long-running loads |

All detectors are debounced per channel (same type not re-fired within 5 min) to prevent alert floods. Detected anomalies are persisted to the `anomalies` hypertable and surfaced in the dashboard via the `AnomalyAlert` component (30-second polling).

---

## Key design decisions

### Why MQTT over HTTP polling?
MQTT push achieves ~1s latency vs 5s polling, reduces network load on the Shelly device, and decouples the collector from the device's HTTP request handler. HTTP polling is kept as a fallback when `SHELLY_MQTT_PREFIX` is not configured.

### Why TimescaleDB?
Standard PostgreSQL with time-series extensions. Using a relational DB avoids a second query language (InfluxQL/Flux) while providing hypertables, continuous aggregates, and `first()`/`last()` ordered-set aggregates that map directly to energy meter semantics.

### Why Redis pub/sub instead of polling the DB from the API?
- **Decoupling**: collector and API are independent processes. Adding API replicas doesn't increase DB polling load.
- **Latency**: Redis delivers the event in ~1ms after publish; DB polling would add up to `poll_interval` latency.
- **One subscription, N clients**: the API subscribes once; all WebSocket clients receive the same fan-out for free.

### Energy delta calculation
Rather than summing per-interval power (`∑P·Δt`), GridSense uses the device's own cumulative energy counter: `Δ = last(total_act_energy) − first(total_act_energy)`. This matches how electricity meters work and is immune to missed poll intervals.

### Consumption per period
`GET /api/energy/consumption` uses `date_trunc('day'|'month'|'year', sampled_at AT TIME ZONE 'Europe/Rome')` to group readings into local-time buckets. The `max − min` counter diff per bucket avoids double-counting and handles DST transitions correctly.

### Reactive power
Not directly measured by the EM-50. Derived as `|Q| = √(S²−P²)`. Sign information is lost — leading/capacitive loads cannot be distinguished from lagging/inductive. Stored at write time to avoid recomputing across aggregations.

---

## Monorepo

```
gridsense/
├── packages/
│   ├── shelly-client/   typed HTTP + MQTT client for Shelly Gen2 RPC API
│   ├── db/              Drizzle schema + TimescaleDB migrations
│   ├── events/          Redis pub/sub types, publisher, subscriber
│   ├── tariff/          Italian F1/F2/F3 tariff-band classifier
│   └── anomaly/         Statistical anomaly detector
├── apps/
│   ├── collector/       MQTT/HTTP ingestion + anomaly detection + internal health API
│   ├── api/             REST + WebSocket API
│   └── web/             Next.js 15 dashboard + Playwright E2E tests
├── infra/
│   └── mosquitto/       Mosquitto MQTT broker config
└── docker-compose.yml   single-command deployment (6 services)
```

---

## Ports

| Service | Port | Purpose |
|---------|------|---------|
| TimescaleDB | 5432 | PostgreSQL wire protocol |
| Redis | 6379 | Pub/sub bus |
| Mosquitto | 1883 | MQTT broker |
| collector | 3001 | Internal health/latest (not exposed publicly) |
| api | 3000 | REST + WebSocket |
| web | 3002 | Next.js dashboard |
