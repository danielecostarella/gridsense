# GridSense — Architecture

## Overview

GridSense is a self-hosted, event-driven energy intelligence platform built around the Shelly Pro EM-50 smart meter. The design prioritises low latency for real-time dashboards while maintaining a clean separation between ingestion, storage, query, and presentation layers.

---

## System diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAN (192.168.x.x)                                                   │
│                                                                      │
│   ┌─────────────────┐   HTTP/RPC GET /rpc/Shelly.GetStatus          │
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
   │  ┌──────────────────────────────────────────────────────┐  │      │
   │  │  collector (Bun + Hono)                               │  │      │
   │  │                                                       │  │      │
   │  │  • Polls Shelly every 5s (configurable)               │──┘      │
   │  │  • Normalises & derives reactive power                │         │
   │  │  • Writes to TimescaleDB (em_readings hypertable)     │         │
   │  │  • Publishes to Redis pub/sub (gridsense:readings:live)│        │
   │  │  • Exposes /health and /latest (internal)             │         │
   │  └──────────────┬──────────────────┬────────────────────┘         │
   │                 │                  │                               │
   │        ┌────────▼────────┐  ┌──────▼──────┐                      │
   │        │  TimescaleDB    │  │    Redis 7   │                      │
   │        │  (PostgreSQL 16)│  │  pub/sub bus │                      │
   │        │                 │  └──────┬───────┘                      │
   │        │  em_readings    │         │ subscribe                    │
   │        │  hypertable     │         ▼                              │
   │        │                 │  ┌──────────────────────────────────┐  │
   │        │  em_readings_1m │  │  api (Bun + Hono)                │  │
   │        │  continuous agg │  │                                  │  │
   │        └────────┬────────┘  │  REST:                           │  │
   │                 │           │  GET /api/readings/latest         │  │
   │                 └──────────►│  GET /api/readings/history        │  │
   │                             │  GET /api/energy/delta            │  │
   │                             │  GET /api/energy/today            │  │
   │                             │  GET /api/energy/stats            │  │
   │                             │  GET /api/live  (→ Shelly direct) │──┘
   │                             │                                  │
   │                             │  WebSocket:                      │
   │                             │  WS /ws  (fan-out from Redis)    │
   │                             └─────────────┬────────────────────┘
   │                                           │ WS push ~5s
   │  ┌────────────────────────────────────────▼───────────────────┐
   │  │  web (Next.js 15, React 19)                                 │
   │  │                                                             │
   │  │  • PowerFlow — animated SVG energy diagram                  │
   │  │  • MetricCard — live values with motion transitions         │
   │  │  • PowerChart — Recharts 1-hour rolling area chart          │
   │  │  • TodayEnergy — daily Wh via REST                         │
   │  │  • ConnectionBadge — WS liveness indicator                  │
   │  └────────────────────────────────────────────────────────────┘
   └─────────────────────────────────────────────────────────────────┘
```

---

## Data flow

### Ingestion path (write)

```
Shelly EM-50
  └─ HTTP GET /rpc/Shelly.GetStatus  (every 5s)
       └─ collector normalises response
            ├─ INSERT em_readings (TimescaleDB hypertable)
            └─ PUBLISH gridsense:readings:live (Redis)
```

### Query path (read — REST)

```
Browser
  └─ GET /api/readings/history?from=…&resolution=1m
       └─ api queries em_readings (raw) or em_readings_1m (aggregate)
            └─ TimescaleDB time_bucket() / first() / last()
```

### Real-time path (WebSocket)

```
Redis gridsense:readings:live
  └─ api ReadingsSubscriber receives event
       └─ fan-out to all connected WebSocket clients (O(1) Redis cost)
            └─ browser useLiveData hook → React state update → re-render
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

Auto-materialised 1-minute OHLC rollup. Used for history queries on ranges > 1 hour. Refreshed every minute with a 2-minute lookback.

### Retention

Raw data: 90 days (configurable via TimescaleDB retention policy).  
Aggregates: indefinite.

---

## Key design decisions

### Why TimescaleDB?
Standard PostgreSQL with time-series extensions. Using a relational DB avoids a second query language (InfluxQL/Flux) while providing hypertables, continuous aggregates, and `first()`/`last()` ordered-set aggregates that map directly to energy meter semantics (e.g. "what was the counter value at the start and end of this period?").

### Why Redis pub/sub instead of polling the DB from the API?
- **Decoupling**: the collector and API are independent processes. Adding more API replicas doesn't increase DB polling load.
- **Latency**: Redis delivers the event in ~1ms after the collector publishes; DB polling would add up to `poll_interval` latency.
- **One subscription, N clients**: the API subscribes once; all WebSocket clients receive the same fan-out for free.

### Energy delta calculation
Rather than summing per-interval power (`∑P·Δt`), GridSense uses the device's own cumulative energy counter: `Δ = last(total_act_energy) − first(total_act_energy)`. This matches how electricity meters work and is immune to missed poll intervals.

### Reactive power
Not directly measured by the EM-50 (it reports active and apparent only). Derived as `|Q| = √(S²−P²)`. Sign information is lost — negative PF loads (leading/capacitive) cannot be distinguished from positive (lagging/inductive). Stored at write time to avoid recomputing across aggregations.

---

## Monorepo

```
gridsense/
├── packages/
│   ├── shelly-client/   typed HTTP client for Shelly Gen2 RPC API
│   ├── db/              Drizzle schema + TimescaleDB migration
│   └── events/          Redis pub/sub types, publisher, subscriber
├── apps/
│   ├── collector/       poll loop + internal health API
│   ├── api/             REST + WebSocket API
│   └── web/             Next.js 15 dashboard + Playwright E2E tests
└── docker-compose.yml   single-command deployment
```

---

## Ports

| Service | Port | Purpose |
|---------|------|---------|
| TimescaleDB | 5432 | PostgreSQL wire protocol |
| Redis | 6379 | Pub/sub bus |
| collector | 3001 | Internal health/latest (not exposed publicly) |
| api | 3000 | REST + WebSocket |
| web | 3002 | Next.js dashboard |
