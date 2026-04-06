# GridSense

**Self-hosted IoT energy intelligence platform** for the Shelly Pro EM-50 smart meter.

GridSense goes beyond device monitoring: it ingests raw electrical measurements at 5-second resolution, stores them in a time-series database, and delivers real-time insights through a modern dashboard — power flow animations, energy cost tracking, anomaly detection (roadmap), and a natural-language AI assistant (roadmap).

→ [Architecture & design decisions](docs/architecture.md)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| HTTP & WebSocket | [Hono](https://hono.dev) |
| Real-time bus | Redis 7 (pub/sub) |
| Database | [TimescaleDB](https://www.timescale.com) — PostgreSQL 16 + time-series engine |
| ORM / schema | [Drizzle ORM](https://orm.drizzle.team) |
| Frontend | [Next.js 15](https://nextjs.org) · React 19 · Tailwind CSS v4 |
| Animations | [Framer Motion](https://www.framer.com/motion/) |
| Charts | [Recharts](https://recharts.org) |
| E2E tests | [Playwright](https://playwright.dev) |
| Containerisation | Docker Compose |

---

## Architecture

```
Shelly Pro EM-50
      │ HTTP RPC (every 5s)
      ▼
  collector ──► TimescaleDB (em_readings hypertable)
      │
      └──► Redis pub/sub ──► api WebSocket ──► browser
                               │
                               └── REST API (history, energy delta, live)
```

Full diagram and design rationale: [docs/architecture.md](docs/architecture.md)

---

## Getting started

### Prerequisites
- Docker + Docker Compose
- Shelly Pro EM-50 reachable on the local network

### Run

```bash
cp .env.example .env
# Edit .env — set SHELLY_HOST to your device's IP (default: 192.168.1.6)

docker compose up --build
```

TimescaleDB initialises automatically on first start (hypertable, 1-minute continuous aggregate, 90-day retention policy).

### Endpoints

| URL | Description |
|-----|-------------|
| `http://localhost:3002` | Web dashboard |
| `http://localhost:3000/api/live` | Current reading direct from Shelly |
| `http://localhost:3000/api/energy/today` | Today's consumption |
| `http://localhost:3000/api/readings/history?from=…` | Historical time-series |
| `ws://localhost:3000/ws` | Real-time WebSocket stream |
| `http://localhost:3001/health` | Collector health |

---

## API reference

### `GET /api/readings/history`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | ISO 8601 | required | Start of window |
| `to` | ISO 8601 | now | End of window |
| `channel` | `0` \| `1` | both | Filter by channel |
| `resolution` | `5s` \| `1m` \| `5m` \| `15m` \| `1h` | auto | Time bucket size |

### `GET /api/energy/delta`

Returns energy consumed and returned (Wh) between two timestamps using the device's cumulative counter — identical semantics to an electricity meter reading.

### `WS /ws`

Pushes a `LiveReadingsEvent` JSON frame every ~5s (collector poll interval). Send `"ping"` to receive `"pong"` for keepalive checking.

---

## E2E tests

```bash
# Start the full stack
docker compose up -d

# Run Playwright tests (requires Node on host for the test runner)
cd apps/web
npx playwright install --with-deps chromium
npx playwright test
```

Reports are generated in `apps/web/playwright-report/`.

---

## Monorepo layout

```
gridsense/
├── apps/
│   ├── collector/          Poll loop — reads Shelly, writes DB + Redis
│   ├── api/                REST API + WebSocket (Hono)
│   └── web/                Next.js 15 dashboard + Playwright E2E
├── packages/
│   ├── shelly-client/      Typed HTTP client for Shelly Gen2 RPC API
│   ├── db/                 Drizzle schema + TimescaleDB migration
│   └── events/             Redis pub/sub types, publisher, subscriber
├── docs/
│   └── architecture.md     System design & decisions
└── docker-compose.yml
```

---

## Roadmap

- [x] Data acquisition — Shelly HTTP polling → TimescaleDB
- [x] REST API — historical queries, energy delta, live endpoint
- [x] Real-time — Redis pub/sub → WebSocket → dashboard
- [x] Web dashboard — power flow, live metrics, 1h chart
- [ ] Tariff engine — Italian F1/F2/F3 time-of-use cost calculation
- [ ] Anomaly detection — statistical spike detection, idle load alerts
- [ ] Demand forecasting — pattern-based next-hour prediction
- [ ] AI assistant — natural language queries on consumption data

## License

MIT
