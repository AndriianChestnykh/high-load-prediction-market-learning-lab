# Prediction Market — High-Load Infra Lab

Binary prediction market (LMSR pricing) built as a learning lab for high-load backend infrastructure.

**Stack:** Node.js + TypeScript + Postgres + Redis + PgBouncer (Phase 1+) + Prometheus/Grafana (Phase 2+)

**Build phases:** Phase 0 → **Phase 1 PgBouncer (current)** → Phase 2 Observability → Phase 3 Redis async → Phase 4 Stress experiments

---

## Prerequisites

| Tool | Version |
|------|---------|
| Docker + Docker Compose | any recent |
| Node.js | 20+ |
| k6 | any recent (`brew install k6`) |

---

## First-time setup

### 1. Start infrastructure

```bash
docker compose up -d
```

Postgres on `:5432`, Redis on `:6379`, **PgBouncer on `:6432`** (transaction mode, waits for Postgres to be healthy first). Compose waits for all three to be healthy before returning.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Default values work with docker compose out of the box:

```
DATABASE_URL=postgres://lab:lab@localhost:6432/predmarket
DIRECT_DATABASE_URL=postgres://lab:lab@localhost:5432/predmarket
REDIS_URL=redis://localhost:6379
PORT=3000
```

`DATABASE_URL` is used by the app at runtime and points at **PgBouncer (`:6432`)** from Phase 1 onward. `DIRECT_DATABASE_URL` points straight to Postgres (`:5432`) and is used by migrations, the seed/truncate scripts, and any admin task that must bypass the pooler.

### 4. Run migrations

```bash
npm run migrate
```

Creates tables: `users`, `markets`, `trades`, `positions`, `outbox`.

### 5. Seed data

```bash
npm run seed
```

Inserts 10 000 users (1 000 000 000 micro-units balance each) and 100 open markets. Safe to re-run — skips if data already exists.

### 6. Start the app

```bash
npm run dev
```

App listens on `http://localhost:3000`. Uses `tsx` to run TypeScript directly with no build step.

---

## Day-to-day commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start the HTTP app |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Seed users + markets |
| `npm run typecheck` | `tsc --noEmit` (no emit, just type errors) |
| `docker compose up -d` | Start Postgres + Redis + PgBouncer |
| `docker compose down` | Stop containers, keep data |
| `docker compose down -v` | Stop containers + **wipe all data** (Postgres volume deleted) |

**Full reset** (wipe everything and start fresh):

```bash
docker compose down -v && docker compose up -d && npm run migrate && npm run seed
```

---

## API

### `GET /health`

```
200 OK
{"status":"ok"}
```

### `GET /markets`

Returns all markets with current LMSR prices.

```json
[
  {
    "id": 1,
    "question": "Will X happen?",
    "b": 100,
    "q_yes": 0,
    "q_no": 0,
    "version": 0,
    "state": "open",
    "p_yes": 0.5,
    "p_no": 0.5
  }
]
```

### `GET /markets/:id`

Same shape as above, single market.

### `POST /trade`

**Request:**
```json
{
  "user_id": 42,
  "market_id": 7,
  "outcome": "yes",
  "shares": 1.5
}
```

**Response `201`:**
```json
{
  "trade_id": 123,
  "cost": "1500000",
  "p_yes": 0.512,
  "p_no": 0.488
}
```

`cost` is a string (bigint micro-units). 1 micro-unit = 0.000001 "dollar".

**Error responses:**

| Status | Meaning |
|--------|---------|
| `400` | Invalid request body |
| `402` | Insufficient balance |
| `404` | User or market not found |
| `409` | Market closed, or version conflict after max retries |

The trade endpoint uses **optimistic concurrency**: the market row has a `version` column. On a concurrent update collision, the handler retries with exponential backoff + jitter (max 5 attempts).

---

## Load test (k6)

The baseline scenario runs 300 RPS for 2 minutes using a constant-arrival-rate (open) model — response time does not affect throughput, so queueing pressure is visible.

```bash
k6 run --compatibility-mode=extended k6/baseline.ts
```

Override the target URL:

```bash
BASE_URL=http://localhost:3000 k6 run --compatibility-mode=extended k6/baseline.ts
```

**Thresholds:**
- `p99 < 200ms`
- `error rate < 0.5%`

Expected non-error statuses: `201` (trade executed), `402` (user out of funds), `409` (market version conflict exhausted retries).

---

## Project layout

```
src/
  math/lmsr.ts        LMSR cost + price functions
  db/
    pool.ts           pg.Pool from DATABASE_URL
    queries.ts        all DB operations (bigint <-> string boundary handled here)
  routes/
    trade.ts          POST /trade — optimistic concurrency, atomic transaction
    markets.ts        GET /markets, GET /markets/:id
  types/index.ts      domain types (Outcome, Market, TradeEvent, PriceChangeEvent, …)
  app.ts              Express app + /health
  server.ts           HTTP server + graceful SIGTERM shutdown

migrations/
  001_initial_schema.ts   node-pg-migrate migration

scripts/
  seed.ts             seed 10k users + 100 markets

k6/
  baseline.ts         300 RPS constant-arrival-rate scenario

docker-compose.yml    Postgres 16 + Redis 7 + PgBouncer (edoburu, transaction mode)
```

---

## PgBouncer (Phase 1)

A transaction-mode connection pooler sits between the app and Postgres. The app
connects only to PgBouncer (`:6432`); PgBouncer multiplexes a small pool of real
Postgres connections (`DEFAULT_POOL_SIZE=20`) across up to `MAX_CLIENT_CONN=200`
clients. This is the single place where the real Postgres connection count is
controlled and tuned for high load.

| Path | Connects to | Used by |
|------|-------------|---------|
| `DATABASE_URL` → `:6432` | PgBouncer | app runtime traffic |
| `DIRECT_DATABASE_URL` → `:5432` | Postgres directly | migrations, seed, truncate, admin |

**Transaction mode** returns each server connection to the pool after every
transaction. It breaks *server-side (named) prepared statements*, but
`node-postgres` uses unnamed prepared statements by default, so the app is
compatible as-is. Watch for this footgun if a named-statement library is added.

Inspect the pooler live via its admin console:

```bash
docker compose exec postgres \
  psql "postgres://lab:lab@pgbouncer:6432/pgbouncer" -c "SHOW POOLS;"
```

Key columns: `cl_waiting` (clients queued for a server connection — should stay
0 under the baseline) and `pool_mode` (should read `transaction` for the
`predmarket` pool).

**Tuning knobs** (`docker-compose.yml` → `pgbouncer.environment`):
`DEFAULT_POOL_SIZE`, `MAX_CLIENT_CONN`, `POOL_MODE`. Change one, re-run the
baseline load test, and compare p99 / error rate against the Phase 0 numbers.

---

## Money representation

All balances and trade costs are `bigint` micro-units throughout the codebase.

- 1 micro-unit = $0.000001
- Starting user balance: 1 000 000 000 micro-units = **$1 000**
- LMSR math (ln/exp) is computed in `float`, then rounded to the nearest integer micro-unit at the money boundary
- `node-postgres` returns `BIGINT` columns as strings — the `string → bigint` conversion happens exclusively in `src/db/queries.ts`
