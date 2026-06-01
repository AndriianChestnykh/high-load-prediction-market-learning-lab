# Experiment 02 — PgBouncer Pooling Modes

## What you'll learn

PgBouncer sits between your app and Postgres and multiplexes many app connections
onto fewer real Postgres connections. The **pool_mode** setting controls *when* a
server connection is returned to the pool, with significant trade-offs.

## The three modes

| Mode | Connection released | Allows prepared stmts? | Overhead |
|---|---|---|---|
| `session` | When client disconnects | ✅ Yes | Minimal multiplexing — nearly same as direct |
| `transaction` | After each transaction (`COMMIT`/`ROLLBACK`) | ⚠️ No (per-session state lost) | Good balance — typical production default |
| `statement` | After each statement | ❌ No | Maximum multiplexing; breaks most ORMs |

## The key knobs (in `infra/pgbouncer/pgbouncer.ini`)

```ini
pool_mode        = transaction   ← change this
default_pool_size = 20           ← max real PG connections per db+user pair
max_client_conn  = 200           ← max app-side connections PgBouncer accepts
```

**After changing pgbouncer.ini, restart just PgBouncer:**
```bash
docker compose -f infra/docker-compose.yml restart pgbouncer
```

## Hypothesis

**In `transaction` mode with `default_pool_size=20`, PgBouncer will sustain 150 VUs
with latency close to direct Postgres at `PG_POOL_MAX=20`, while keeping only 20 real
connections open to Postgres instead of 150.**

## Run

```bash
# Baseline: direct Postgres
PG_PORT=5432 PG_POOL_MAX=20 pnpm exp 02
pnpm exp:load 02

# Via PgBouncer in transaction mode (pgbouncer.ini: pool_mode=transaction)
PG_PORT=6432 PG_POOL_MAX=100 pnpm exp 02
pnpm exp:load 02

# Switch to session mode (pgbouncer.ini: pool_mode=session)
# docker compose ... restart pgbouncer
PG_PORT=6432 PG_POOL_MAX=100 pnpm exp 02
pnpm exp:load 02

# Hit /prepared with pool_mode=statement to see it break
curl http://localhost:8080/prepared
```

## What to observe

| Metric | Direct | Transaction mode | Session mode |
|---|---|---|---|
| `pg_stat_activity count` | = PG_POOL_MAX | = default_pool_size (e.g. 20) | ≈ active clients |
| p99 latency | baseline | similar or better | similar to direct |
| PgBouncer queue depth (pgb_pools_sv_used) | n/a | visible in Grafana | visible |
| `/prepared` route | ✅ works | ❌ error (prepared stmt across tx) | ✅ works |

## Key files

- `app.js` — identical routes to exp-01 plus a `/prepared` route for mode demonstration
- `loadtest.k6.js` — same shape as exp-01
- `infra/pgbouncer/pgbouncer.ini` — the config you edit between runs
