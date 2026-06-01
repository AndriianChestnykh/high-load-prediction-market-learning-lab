# High-Load Infra Playground

A local experiment lab for learning production-grade backend infrastructure:
**Node.js + Postgres + PgBouncer + Redis + Prometheus + Grafana**.

Each experiment changes **one variable** and provides a written hypothesis, a
k6 load script, and a Grafana dashboard to measure the outcome.

## Architecture

```
Your host machine
├── Node.js app (Fastify)   ← fast restarts, real debugger
│   ├── :8080  (HTTP)
│   └── :9100  (/metrics → Prometheus)
│
Docker (infra)
├── Postgres         :5432
├── PgBouncer        :6432   ← proxy in front of Postgres
├── Redis            :6379
├── Prometheus       :9090
├── Grafana          :3001   ← dashboards
├── postgres_exporter:9187
└── redis_exporter   :9121
```

## Quick start

```bash
# 1. Copy env and install
cp .env.example .env
pnpm install

# 2. Start infra
pnpm infra:up

# 3. Verify (wait ~10s for Postgres to seed)
psql postgresql://app:app@localhost:5432/playground -c '\dt'
psql postgresql://app:app@localhost:6432/playground -c 'select 1'

# 4. Open Grafana
open http://localhost:3001   # admin / admin → "High-Load Playground" dashboard

# 5. Run experiment 01
pnpm exp 01                  # starts Fastify on :8080
curl localhost:8080/healthz

# 6. Run load test
pnpm exp:load 01             # fires k6 in Docker, streams to Prometheus
```

## Experiments

| # | Topic | Status | Key knob |
|---|---|---|---|
| [01](experiments/01-connection-pool-tuning/) | Connection pool tuning | ✅ Full | `PG_POOL_MAX` |
| [02](experiments/02-pgbouncer-modes/) | PgBouncer pool modes | ✅ Full | `pool_mode` in pgbouncer.ini |
| [03](experiments/03-node-cluster/) | Node.js Cluster | 🚧 Scaffold | `WORKERS` |
| [04](experiments/04-redis-streams/) | Redis Streams | 🚧 Scaffold | `RATE_MS`, `BATCH` |
| [05](experiments/05-cache-stampede/) | Cache stampede | 🚧 Scaffold | `CACHE_MODE`, `CACHE_TTL` |

## The experiment loop

Each experiment folder has a `README.md` structured as:

1. **Hypothesis** — what you expect to happen and why
2. **Run** — exact commands with different knob values
3. **What to observe** — which Grafana panels to watch
4. **Expected result** — a table of expected outcomes per knob value

Change the knob → restart the app → rerun k6 → compare Grafana panels.

## Useful commands

```bash
pnpm infra:up         # start all infra
pnpm infra:down       # stop (keep volumes)
pnpm infra:reset      # stop AND delete all data volumes
pnpm infra:logs       # tail all container logs
pnpm infra:ps         # status

pnpm exp 01           # start experiment 01 app (Ctrl+C to stop)
pnpm exp:load 01      # run k6 load test for experiment 01

# Change a PgBouncer knob mid-experiment
docker compose -f infra/docker-compose.yml restart pgbouncer

# Redis CLI
docker exec -it hli-playground-redis-1 redis-cli

# psql (direct)
psql postgresql://app:app@localhost:5432/playground

# psql via PgBouncer
psql postgresql://app:app@localhost:6432/playground
```

## Environment variables

See [.env.example](.env.example) for all knobs. The critical ones:

| Variable | Default | Effect |
|---|---|---|
| `PG_PORT` | 5432 | `5432` = direct Postgres, `6432` = via PgBouncer |
| `PG_POOL_MAX` | 10 | App-side connection pool size |
| `APP_PORT` | 8080 | Fastify listen port |
| `METRICS_PORT` | 9100 | `/metrics` endpoint port |
