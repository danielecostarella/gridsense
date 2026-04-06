# GridSense

**Self-hosted IoT energy intelligence platform** for the Shelly Pro EM-50 smart meter.

GridSense goes beyond device monitoring: it ingests raw electrical measurements at 5-second resolution, stores them in a time-series database optimised for energy data, and (roadmap) provides real-time insights, automated decision loops, and an extensible architecture for smart meters and edge devices.

---

## Architecture

```
Shelly Pro EM-50  ──HTTP polling──▶  collector  ──▶  TimescaleDB
                                         │
                                         └──▶  REST API  ◀──  (future) web dashboard
```

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| HTTP framework | [Hono](https://hono.dev) |
| Database | [TimescaleDB](https://www.timescale.com) (PostgreSQL + time-series engine) |
| ORM / schema | [Drizzle ORM](https://orm.drizzle.team) |
| Containerisation | Docker Compose |

## Monorepo structure

```
gridsense/
├── apps/
│   └── collector/          # Polling service — reads Shelly, writes to DB
├── packages/
│   ├── shelly-client/      # Typed HTTP client for the Shelly Pro EM-50 RPC API
│   └── db/                 # Drizzle schema, TimescaleDB migrations, DB client
└── docker-compose.yml
```

## Getting started

### Prerequisites
- Docker + Docker Compose
- Shelly Pro EM-50 reachable on the local network

### Run

```bash
cp .env.example .env
# Edit .env — set SHELLY_HOST to your device's IP

docker compose up --build
```

TimescaleDB is initialised automatically on first start (hypertable, continuous aggregates, 90-day retention policy).

### Verify

```bash
# Live reading from the meter
curl http://localhost:3001/latest | jq

# Collector health
curl http://localhost:3001/health | jq
```

## Data model

The core table `em_readings` is a [TimescaleDB hypertable](https://docs.timescale.com/use-timescale/latest/hypertables/) partitioned in 7-day chunks. Each row represents one channel snapshot:

| Column | Type | Description |
|--------|------|-------------|
| `sampled_at` | `timestamptz` | Wall-clock timestamp of the poll |
| `channel_id` | `smallint` | 0 = channel A, 1 = channel B |
| `voltage` | `real` | RMS voltage [V] |
| `current` | `real` | RMS current [A] |
| `act_power` | `real` | Active power [W] |
| `aprt_power` | `real` | Apparent power [VA] |
| `power_factor` | `real` | Power factor [-1, 1] |
| `frequency` | `real` | Line frequency [Hz] |
| `reactive_power` | `real` | Reactive power magnitude [VAr] |
| `total_act_energy` | `double precision` | Cumulative consumed energy [Wh] |
| `total_act_ret_energy` | `double precision` | Cumulative returned energy [Wh] — non-zero with PV/battery |

A 1-minute continuous aggregate (`em_readings_1m`) materialises min/max/avg rollups automatically.

## Roadmap

- [ ] REST API with historical queries and energy delta calculations
- [ ] Real-time WebSocket push to frontend
- [ ] Web dashboard — power flow visualisation, cost tracking, anomaly detection
- [ ] Tariff engine (Italian F1/F2/F3 time-of-use bands)
- [ ] AI assistant for natural language queries on consumption data

## License

MIT
