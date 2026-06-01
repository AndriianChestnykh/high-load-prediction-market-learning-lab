# Experiment 01 — Connection Pool Tuning

## What you'll learn

How the Node.js `pg` connection pool size (`PG_POOL_MAX`) interacts with Postgres's own
`max_connections`. Too few pooled connections → queuing in the app. Too many → Postgres
rejects connections or starts thrashing. The Grafana dashboard lets you see both.

## Background

`node-postgres` (the `pg` package) maintains a pool of TCP connections to Postgres.
Each `query()` call borrows one. If all pool slots are busy the call waits.

Key env var: `PG_POOL_MAX` (default: 10).

## Hypothesis

**Increasing `PG_POOL_MAX` from 5 → 10 → 20 → 40 will decrease p99 latency and
increase throughput — up to the point where Postgres's own connection overhead
becomes the bottleneck (around max_connections = 100 in this setup).**

## Run

```bash
# Terminal 1 — start infra (once)
pnpm infra:up

# Terminal 2 — start the app with a given pool size
PG_POOL_MAX=5 pnpm exp 01

# Terminal 3 — run k6 load test (fires a Docker container)
pnpm exp:load 01

# Repeat with different pool sizes
PG_POOL_MAX=10 pnpm exp 01   # restart Terminal 2, rerun Terminal 3
PG_POOL_MAX=20 pnpm exp 01
PG_POOL_MAX=40 pnpm exp 01
```

## What to observe in Grafana (http://localhost:3001)

| Panel | What to watch |
|---|---|
| `http_request_duration_seconds p(99)` | Should drop as pool grows, then plateau |
| `pg_pool_waiting_clients` | Should drop toward 0 as pool grows |
| `pg_pool_total_connections` | Tracks your `PG_POOL_MAX` |
| `pg_stat_activity count` | Postgres-side: rises with pool size |
| k6 VUs + RPS (from Prometheus remote-write) | Overall throughput |

## Expected result

| PG_POOL_MAX | Expected behaviour |
|---|---|
| 5 | High `waiting_clients`, high p99 (queuing inside the app pool) |
| 10 | Moderate improvement |
| 20 | Near-optimal for 200 VUs hitting simple queries |
| 40 | Marginal further gain; watch pg_stat_activity rise |
| 100+ | Likely worse — Postgres context-switching overhead |

## Key files

- `app.js` — Fastify app; routes hit `SELECT` on orders
- `loadtest.k6.js` — ramp VU scenario (30s warm → 200 VUs → hold → ramp down)
- `.env` at repo root — set `PG_POOL_MAX` here or inline as shown above
