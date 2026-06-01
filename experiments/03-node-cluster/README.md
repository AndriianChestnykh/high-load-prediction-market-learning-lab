# Experiment 03 — Node.js Cluster

## What you'll learn

Node.js is single-threaded per process. `cluster` spawns N worker processes that all
listen on the same port (using SO_REUSEPORT / the primary's accept loop). This lets
you use multiple CPU cores.

## Background

- **CPU-bound work:** one process maxes out one core → throughput plateaus. Workers
  distribute load across cores.
- **I/O-bound work:** a single Node.js event loop handles thousands of concurrent
  awaits efficiently. Adding workers doesn't help much here and multiplies pool usage.
- **`worker_threads`** (not cluster) share memory via SharedArrayBuffer — useful for
  heavy computation you want to keep in-process. Not covered here but similar setup.

## The knobs

```bash
WORKERS=1   pnpm exp 03   # baseline: single process
WORKERS=2   pnpm exp 03
WORKERS=4   pnpm exp 03   # likely sweet spot for CPU-bound work
WORKERS=8   pnpm exp 03   # may show diminishing returns (memory, pool exhaustion)
```

## Hypothesis

**For the `/cpu` route (CPU-bound), throughput scales linearly with workers up to
the number of physical cores. For the `/orders` route (I/O-bound), adding workers
beyond 2 shows diminishing returns and increases pg_pool total connections
by N × PG_POOL_MAX.**

## Run

```bash
# I/O-bound comparison
WORKERS=1  PG_POOL_MAX=10 pnpm exp 03
EXP_SCRIPT=03-node-cluster/loadtest-io.k6.js pnpm exp:load 03

WORKERS=4  PG_POOL_MAX=10 pnpm exp 03
# rerun load test — watch RPS vs p99

# CPU-bound comparison
WORKERS=1  pnpm exp 03
# hit: curl 'http://localhost:8080/cpu?n=5000000' — time it
WORKERS=4  pnpm exp 03
# same curl — compare wall time
```

## What to observe

| Metric | 1 worker | 4 workers |
|---|---|---|
| `/cpu` RPS | ~baseline | ~4× baseline |
| `/orders` RPS | solid | marginal gain |
| `pg_pool_total_connections` | PG_POOL_MAX | 4 × PG_POOL_MAX |
| CPU% per core | 1 core maxed | 4 cores moderate |

## TODO — flesh out

- [ ] Add `loadtest-cpu.k6.js` scenario targeting `/cpu`
- [ ] Add `loadtest-io.k6.js` scenario targeting `/orders`
- [ ] Add `worker_threads` variant for CPU work (compare to cluster)
