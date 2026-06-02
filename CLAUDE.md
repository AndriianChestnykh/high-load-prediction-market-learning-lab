# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Infrastructure (run first)
docker compose up -d          # start Postgres (:5432) + Redis (:6379) + PgBouncer (:6432)
docker compose down -v        # wipe all data (Postgres volume)

# App
npm run dev                   # start HTTP server (tsx, no build step)
npm run migrate               # run pending node-pg-migrate migrations
npm run seed                  # seed 10k users + 100 markets (idempotent)
npm run reset                 # truncate + re-seed
npm run typecheck             # tsc --noEmit

# Testing
npm test                      # run e2e tests (tests/e2e.test.ts)
npm run load-test             # k6 baseline: 300 RPS, 2 min
BASE_URL=http://localhost:3000 k6 run --compatibility-mode=extended k6/baseline.ts

# Full reset
docker compose down -v && docker compose up -d && npm run migrate && npm run seed
```

Migrations, seed, and truncate use `DIRECT_DATABASE_URL` (direct Postgres :5432, bypassing the pooler); the app uses `DATABASE_URL` (PgBouncer :6432 from Phase 1 onward).

## Architecture

**Phase 1 (current):** Node.js/TypeScript HTTP app → PgBouncer (transaction mode, :6432) → Postgres. No Redis relay, no metrics yet. The outbox table is written but nothing drains it.

**Connection topology:** the app connects only to PgBouncer (`DATABASE_URL` → :6432); PgBouncer multiplexes `DEFAULT_POOL_SIZE=20` real Postgres connections across `MAX_CLIENT_CONN=200` clients. Migrations/seed/truncate connect directly to Postgres (`DIRECT_DATABASE_URL` → :5432). Transaction mode breaks server-side *named* prepared statements; node-postgres uses unnamed ones by default, so the app is compatible. Image: `edoburu/pgbouncer`. Inspect pools via `psql .../pgbouncer -c "SHOW POOLS;"` (watch `cl_waiting`).

**Phased build plan:**
- Phase 1 (done) — PgBouncer (transaction mode) inserted between app and Postgres
- Phase 2 — Prometheus/Grafana observability
- Phase 3 — Redis Streams async path (outbox relay + trade-notifications consumer)
- Phase 4 — stress/breakpoint experiments

### Request path: POST /trade

The trade handler in `src/routes/trade.ts` runs an atomic Postgres transaction that:
1. `SELECT` market (with version)
2. Compute LMSR cost (`src/math/lmsr.ts`)
3. `SELECT … FOR UPDATE` user row
4. `UPDATE markets … WHERE version = $expected` (optimistic concurrency — if 0 rows affected, rollback and retry up to 5×)
5. Debit user balance
6. `INSERT` trade record
7. `UPSERT` position
8. `INSERT` two outbox events (trade + price_change)
9. COMMIT

On version conflict, handler sleeps with exponential backoff+jitter and retries (max `MAX_RETRIES = 5`). After exhausting retries → 409.

### Money representation

All balances and trade costs are `bigint` micro-units (1 micro-unit = $0.000001). The `string → bigint` conversion happens **exclusively** in `src/db/queries.ts` (`parseUser`). LMSR math uses `float`, then rounds to integer micro-units at the boundary. Never store or pass money as `float`.

### Outbox pattern

Trade and price-change events are inserted into the `outbox` table inside the trade transaction (atomic, no dual-write). In Phase 3, a separate relay process polls `outbox` and XADDs to Redis Streams. The HTTP app never connects to Redis.

### Key files

| File | Role |
|---|---|
| `src/routes/trade.ts` | POST /trade — optimistic concurrency loop |
| `src/db/queries.ts` | All SQL; bigint↔string boundary lives here |
| `src/math/lmsr.ts` | LMSR cost + price functions |
| `src/types/index.ts` | Domain types: `Outcome`, `Market`, `TradeEvent`, `PriceChangeEvent` |
| `migrations/001_initial_schema.ts` | Tables: users, markets, trades, positions, outbox |
| `k6/baseline.ts` | 300 RPS constant-arrival-rate load test |

---

# Project Rules

## Error responses must include debugging context

Every error response must include the fields that a developer would need to diagnose the problem without having to re-run the request or inspect the database manually.

Rules:
- "Not found" errors must include the ID that was looked up.
- "Invalid input" errors must include both what was received and what was expected.
- "Business rule violation" errors (insufficient balance, wrong state, etc.) must include the relevant values — e.g. current balance, required cost, shortfall; current state, expected state.
- "Retry exhausted" errors must include which resource was contended and how many attempts were made.

All error values that are `bigint` in the domain must be serialized as strings (same rule as success responses).
