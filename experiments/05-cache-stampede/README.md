# Experiment 05 — Cache Stampede (Thundering Herd)

## What you'll learn

Cache-aside pattern: read from cache → on miss, query DB → write to cache.
The **stampede** happens when many concurrent requests all miss the cache at the
same instant (e.g. after TTL expiry) and all hit the DB simultaneously.

## Strategies

| Strategy | How | Trade-off |
|---|---|---|
| **Naive** | First misser hits DB; all others also hit DB | Simple; stampede at TTL boundary |
| **Lock (SET NX)** | First misser acquires Redis lock; others wait | Prevents stampede; adds latency for waiters |
| **Probabilistic early recompute** | Randomly recompute before TTL expires | No locks needed; harder to reason about |
| **Stale-while-revalidate** | Serve stale, refresh async | Best UX; stale data window |

## Hypothesis

**Under 200 VUs with CACHE_TTL=2s, the naive strategy will show periodic latency
spikes every ~2s (when TTL expires) in `pg_stat_activity`. The lock strategy will
eliminate the spikes but add ~10ms to waiters. Visible clearly on Grafana.**

## Run

```bash
pnpm infra:up

# Naive — watch for spikes every CACHE_TTL seconds
CACHE_MODE=naive CACHE_TTL=2 pnpm exp 05
pnpm exp:load 05

# Lock-based — spikes should disappear
CACHE_MODE=lock CACHE_TTL=2 pnpm exp 05
pnpm exp:load 05
```

## What to observe

| Metric | Naive | Lock |
|---|---|---|
| `pg_stat_activity count` | Periodic spike every TTL | Steady 1 during refresh |
| p99 latency | Spikes at TTL boundary | Slight constant overhead |
| Cache hit rate (Redis hits/s via redis_exporter) | High between spikes | High throughout |

## TODO — flesh out

- [ ] Implement lock strategy in `app.js` (`getStatsLocked`)
- [ ] Implement probabilistic early recompute
- [ ] Add k6 load test (`loadtest.k6.js`) that fires a burst when TTL is about to expire
- [ ] Add `cache_hit_total` / `cache_miss_total` counters to prom-client
- [ ] Add a Grafana panel showing cache hit rate
