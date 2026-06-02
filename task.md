# High-Load Infra Learning Lab

I am going to join a team which works on a high-load backend infrastructure of a prediction market.
So the goal is to create a playground for my experiments and learning.
This should be a local experiment lab for learning production-grade backend infrastructure: Node.js + Postgres + PgBouncer + Redis + Prometheus + Grafana.
The system should be a prediction market with Logarithmic Market Scoring Rules math.

## Goals
- Learn how to build a production-grade high-load backend infrastructure
- Learn how to use Prometheus and Grafana to monitor and visualize the infrastructure
- Learn how to tune PgBouncer to improve performance
- Learn how to use Redis as a queue for event-driven architecture, where consumers can be slower than producers (backpressure, consumer lag, redelivery, idempotency)

## Load & Performance Targets

Two operating modes for experiments:

1. Baseline (steady-state) mode — the default for measuring the effect of a change:
   - Target throughput: ~300 RPS
   - Latency budget: p99 < 200ms (p50 should be well below this)
   - Error budget: < 0.5%
   - Purpose: a stable, repeatable load so I can change one thing (e.g. PgBouncer
     pool mode) and clearly attribute any improvement or regression.

2. Stress / breakpoint mode — deliberately push components past their limits:
   - Ramp RPS up until something breaks, then identify WHICH part broke first and why.
   - Targets to saturate individually and observe failure signatures:
     - Node.js event loop: event-loop lag, blocked CPU (LMSR math is a good CPU sink),
       saturated single process before adding more instances.
     - Postgres / PgBouncer: connection pool exhaustion, cl_waiting climbing, query
       queueing, lock contention on hot market rows.
     - Redis queue: stream length / queue depth growth and consumer lag when producers
       outrun consumers; backpressure behaviour and message loss vs. retention.
   - Purpose: learn the failure modes, the early-warning metrics, and where the real
     ceiling is — not just the happy path.

Load generation:
   - Tool: k6 (scriptable in JS, native Prometheus output so load and infra metrics
     align on the same Grafana timeline).
   - Model: open model (fixed arrival rate independent of response time) so queueing
     and backpressure are revealed rather than hidden — essential for the slow-consumer
     and breakpoint experiments.
   - Every experiment should be runnable as: define hypothesis -> run load -> observe
     in Grafana -> record result.

## Domain Model (Prediction Market, LMSR)

### Mechanic
- Binary markets only for now: two outcomes, YES / NO.
- Each market holds a share-quantity vector q = [q_yes, q_no].
- Cost function: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b)), where b is the liquidity parameter.
- Buying Δ shares of an outcome costs C(q_after) - C(q_before).
- Instantaneous price (reads as probability): p_i = e^(q_i/b) / Σ e^(q_j/b); prices sum to 1.
- On resolution (conceptually): winning shares pay out 1 unit each, losing shares pay 0.
  NOTE: actual payout crediting is OUT OF SCOPE for now (see Non-Goals). Resolution, if
  modelled at all, only records state + winning_outcome; it does not credit balances yet.
- Consequence: every trade reads and writes the market's q vector -> the market row is a
  hot, contended resource under load. This is the core concurrency lesson.

### Decisions
- Outcomes: binary only (YES/NO) to start; generalize to N outcomes later.
- Money: represented as BigInt integer micro-units (no floats for money).
  - LMSR math (ln/exp) is computed in floating point, then rounded deterministically to
    integer micro-units at the money boundary. Never store money as float.
  - Note: node-postgres returns BIGINT as string by default to avoid precision loss;
    handle the BigInt <-> string boundary explicitly.
- Concurrency: OPTIMISTIC concurrency control.
  - Market row carries a version column; a trade reads q + version, computes cost, then
    updates with a version check (UPDATE ... WHERE version = $expected). On mismatch, retry.
  - Goal: deliberately provoke retry-storms under contention and then tame them while
    keeping/raising throughput. Patterns to play with:
    - exponential backoff + jitter (direct fix for retry-storms on a hot row)
    - retry budget / cap (bound the storm)
    - circuit-breaker (stop cascading overload when retries themselves become the load)
  - Later experiment: compare against pessimistic (SELECT ... FOR UPDATE) and serializable
    isolation for throughput vs. contention behaviour.

### Entities
- users (id, balance as BigInt micro-units) — authoritative, updated synchronously.
- markets (id, question, b, q_yes, q_no, version, state: open/resolved, winning_outcome)
- trades (append-only log: id, user_id, market_id, outcome, shares, cost, created_at)
  -> append-only audit log of what happened.
- positions: MAINTAINED table (user_id, market_id, outcome, shares), updated
  synchronously inside the same trade transaction as balance and the market q vector.
  Strongly consistent; cheap to query directly.
- outbox (id, event_type, payload, created_at, published_at): events inserted inside the
  trade transaction; drained to Redis by the relay (see Redis Queue Design).

### Consistency model
- A single trade transaction atomically: validates affordability against balance,
  updates market q (with optimistic version check), debits/credits balance, upserts the
  user's position row, appends to the trades log, and inserts any resulting event(s) into
  the outbox. All strongly consistent and committed together.

### Event-driven workload for the queue (goal: consumers slower than producers)
- The ONLY async workload in scope is trade notifications. There is exactly one consumer:
  the trade-notifications consumer (a separate Node.js process).
- Events emitted (every trade emits both):
  - trade events    — one per trade that happens
  - price-change events — the new market price after the trade
- Every consumer subscribes to BOTH event types (trade events AND price-change events).
  We do NOT filter out a user's own trades for now (simplicity) — a consumer sees every
  trade and every price change.
- The consumer's processing rate is CONFIGURABLE (e.g. an artificial per-message delay)
  so we can deliberately make the consumer slower than the producers. That is the whole
  point: emulate consumer-lags-producer and study backpressure / queue growth / redelivery.
- Payouts and analytics are explicitly OUT OF SCOPE (see Non-Goals) — not built anywhere
  in the system for now; may be added later.

## Redis Queue Design

### Mechanism: Redis Streams (not Pub/Sub, not Lists)
- Pub/Sub is fire-and-forget (messages lost if no live subscriber) — rejected.
- Lists (LPUSH/BRPOP) have no acks/redelivery — a crash mid-processing loses the message.
- Streams give per-group at-least-once delivery, acks, redelivery, and consumer groups —
  the only option that matches "consumers slower than producers without losing work".

### Library
- Raw ioredis + Streams commands (implement consumer groups, acks, recovery ourselves to
  learn the mechanism). Optionally compare against BullMQ later.

### Publishing: transactional outbox (avoid the dual-write problem)
- Problem: committing a trade to Postgres and then XADD-ing to Redis are two writes to two
  systems with no shared transaction. A crash in between loses the event (e.g. a trade /
  price-change notification that never fires).
- Pattern:
  - Inside the same Postgres trade transaction, insert the event into an `outbox` table.
    Event creation is now atomic with the trade.
  - A separate relay/publisher polls the outbox and XADDs to the Redis stream, then marks
    the row published (or deletes it). At-least-once to Redis, which idempotent consumers
    already tolerate.
- Bonus: relay lag (unpublished outbox rows / oldest unpublished age) is another Prometheus
  metric.

### Core pattern
- Producers: outbox rows -> relay -> XADD to the event streams (trade events and
  price-change events).
- Consumers: XREADGROUP within a named consumer group. The single trade-notifications
  consumer subscribes to BOTH streams. Each consumer type gets its own consumer group, so
  adding more consumer types later gives independent fan-out (every group sees every event).
  Scaling note: adding more instances WITHIN a group splits messages across instances and
  drains the backlog faster — but that is horizontal scaling (a later experiment). In the
  current single-consumer setup, consumer-group lag can only be reduced by processing faster
  (lower artificial delay or more concurrent message handlers), not by adding group members.
- Configurable consumer rate: an artificial per-message processing delay (and concurrency)
  so the consumer can be made slower than the producers on demand — the core slow-consumer
  experiment.
- At-least-once: each message is XACK'd only after successful processing.
- Idempotency: redeliveries WILL happen (at-least-once + XAUTOCLAIM). Consumers should be
  safe to process the same event twice. For notifications the duplicate cost is low, but
  we still XACK correctly and handle redelivery so the pattern is learned.

### Recovery of stuck messages
- A consumer that grabs a message then crashes leaves it in the Pending Entries List (PEL).
- Periodic XAUTOCLAIM sweep reclaims entries idle longer than a timeout and redelivers them.

### Dead-letter handling
- Track delivery count via XPENDING; after N failed deliveries, move the poison message to
  a separate DLQ stream for inspection instead of redelivering forever.

### Backpressure / retention experiment
- Start unbounded (nothing lost while learning).
- Then introduce capped streams (MAXLEN / MINID) as a deliberate backpressure experiment:
  observe drop-oldest vs. block-producer behaviour when the buffer fills (stress mode).

### Observability (feeds Prometheus/Grafana)
- Consumer lag and PEL size via XINFO GROUPS / XPENDING -> "consumer falling behind" metric.
- Stream length (XLEN) -> queue depth growth when producers outrun consumers.
- DLQ stream length -> poison/failure rate.

## Infra Scaffolding

### Layout
- Infra in docker-compose: Postgres, PgBouncer, Redis. (Prometheus/Grafana + exporters
  added later under observability.) Phase note: PgBouncer is defined in compose from the
  start but is inactive until Phase 1 — Phase 0 compose only needs Postgres + Redis.
- Node app runs on the HOST (not in compose) so it's easy to attach a profiler / --inspect
  and observe event-loop behaviour for stress-mode experiments.
- Single Node process for the HTTP app first (to find the event-loop ceiling before
  scaling out).
- Separate host processes for the outbox relay and the single trade-notifications consumer.
  Keeps the HTTP app's event loop clean so its ceiling is measured in isolation, and mirrors
  a realistic deployment. The app process only serves HTTP + writes trades/outbox rows.

### Connection topology
- k6 -> HTTP -> Node app
- Node app -> PgBouncer (:6432) for all normal app traffic. From Phase 1 onward the app
  never connects to Postgres directly — PgBouncer is the single place we control the real
  connection count. (Exception: the Phase 0 baseline runs before PgBouncer exists, so the
  app connects straight to Postgres :5432 to establish a "before" number.)
- Outbox relay -> Redis (:6379) via ioredis: reads unpublished outbox rows from Postgres, XADDs to streams.
- Trade-notifications consumer -> Redis (:6379) via ioredis: XREADGROUP, XACK, XAUTOCLAIM.
- The HTTP app does NOT connect to Redis directly; it writes outbox rows inside the trade transaction and leaves Redis interaction entirely to the relay and consumer processes.
- PgBouncer -> Postgres (:5432).
- The outbox relay is ordinary transactional SELECT/UPDATE traffic -> goes through
  PgBouncer like the rest of the app.
- Once PgBouncer is in place (Phase 1+), all app runtime traffic goes through PgBouncer.
  Migrations, admin tasks, and exporters (e.g. postgres_exporter) may connect directly
  to Postgres (:5432) where appropriate.

### PgBouncer
- Pool mode: transaction (server conn returned to pool after each transaction — the mode
  worth tuning for high load).
- Caveat: transaction mode breaks named/server-side prepared statements. node-postgres
  uses unnamed prepared statements by default (OK), but this is a known footgun — record it
  and watch for it when tuning.
- Tuning knobs to experiment with: pool_size, max_client_conn, default_pool_size,
  reserve_pool. Observe cl_waiting under load.

### Migrations
- Tool: node-pg-migrate (plain SQL-ish JS migrations, no ORM baggage).
- Connects via DIRECT_DATABASE_URL (straight to Postgres :5432), not through PgBouncer.

### Environment / config
- DATABASE_URL        -> PgBouncer (:6432)   — app runtime traffic
- DIRECT_DATABASE_URL -> Postgres  (:5432)   — migrations / admin
- REDIS_URL           -> Redis     (:6379)
- Phase note: DATABASE_URL only points at PgBouncer from Phase 1 onward. In the Phase 0
  baseline (no PgBouncer yet) it points straight to Postgres (:5432).

### Seed data
- ~10k users with starting balances + ~100 open markets. Tune later so load tests are
  meaningful (non-empty tables, realistic contention on hot markets).

### Service readiness
- compose healthchecks + depends_on (condition: service_healthy) so Postgres/Redis are
  ready before PgBouncer / app start.

### Graceful shutdown (matters for queue correctness)
- On SIGTERM: stop accepting new HTTP, drain in-flight requests, stop the XREADGROUP loop
  after finishing/acking in-flight messages, then close the pg pool and redis connections.
- Prevents half-processed messages and lost acks during deploys/restarts.

## Observability (Prometheus + Grafana)

### Principle
- RED (rate/errors/duration) for request-serving, USE (utilisation/saturation/errors) for
  resources, plus queue-lag metrics for the async path.

### Scrape targets
- Node HTTP app  -> /metrics via prom-client
- Relay process  -> its own /metrics
- Consumer procs -> their own /metrics
- Postgres       -> postgres_exporter
- PgBouncer      -> postgres_exporter pointed at the pgbouncer admin DB (cl_waiting, pools)
- Redis          -> redis_exporter

### Metrics mapped to goals
- Event-loop ceiling: nodejs_eventloop_lag_seconds, CPU, RSS, GC.
- HTTP health (RED): request rate, error rate, latency histogram (p50/p99).
- PgBouncer tuning: cl_waiting, active/idle server conns, pool saturation.
- Postgres: active connections, slow queries, lock waits, txn rate.
- Optimistic concurrency (CUSTOM app metrics): trade retry count, version-conflict rate.
- Redis queue (CUSTOM): stream length (XLEN), consumer-group lag, PEL size, DLQ length.
- Outbox/relay (CUSTOM): unpublished outbox rows, oldest-unpublished age (relay lag).
- Note: the last three groups are custom prom-client counters/gauges we emit ourselves;
  exporters won't know about retries, stream-lag semantics, or the outbox.

### Dashboards (small, focused set)
- (a) HTTP / RED overview
- (b) Postgres + PgBouncer
- (c) Redis queues + consumers
- (d) Node runtime / event loop

### Alerts (Prometheus alert rules — learn alerting, not just graphs)
- Consumer-group lag > threshold (sustained)
- PgBouncer cl_waiting > 0 sustained
- HTTP p99 latency breach (> 200ms vs. baseline budget)
- Relay lag: oldest unpublished outbox row too old
- (DLQ length > 0 optional)

### Load-test correlation (the core feedback loop)
- k6 pushes its own metrics to Prometheus (k6 Prometheus remote-write output) so load and
  infra metrics share one Grafana timeline.
- Every experiment reads as: k6 load line + infra response on the same dashboard.

## Non-Goals (deliberate exclusions)

Stated explicitly so they are conscious choices, not blind spots:
- AuthN / AuthZ — trades are unauthenticated in the lab (a user_id is passed in).
- Real payments / custody / withdrawals — balances are play-money BigInt micro-units.
- Security hardening (TLS, secrets management, input fuzzing) — out of scope.
- HA / failover / replication — single Postgres, single Redis, no clustering.
- Horizontal scaling of the HTTP app + load balancer — single process first (see below).
- Frontend / UI — HTTP API + k6 + Grafana only.
- N-outcome markets — binary only for now.
- Payouts — out of scope entirely, in ALL parts of the system (no payout events, no payout
  consumer, resolution does not credit balances). May be added later.
- Analytics / aggregation — out of scope entirely (this lab is about high-load infra, not
  analytics). No analytics events or consumer. May be added later.

The ONLY async consumer in scope is the trade-notifications consumer (subscribes to trade
and price-change events, with a configurable rate to emulate a slow consumer).

Flagged as LATER experiments (not now, but natural next steps):
- Multiple Node app instances behind a load balancer (shifts the bottleneck from the event
  loop to PgBouncer/Postgres — a rich follow-on lesson).
- Pessimistic / serializable concurrency comparison vs. the optimistic baseline.
- BullMQ comparison vs. raw ioredis Streams.

## Phased Build Plan

Build in measurable increments. Stand up only enough to run the next experiment.

- Phase 0 — Foundation:
  - docker-compose: Postgres + Redis. node-pg-migrate schema (users, markets, trades,
    positions, outbox). Seed ~10k users + ~100 markets.
  - HTTP app (single process, on host): LMSR math, trade endpoint with optimistic
    concurrency (version check + retry), atomic trade transaction. The transaction
    already inserts trade + price-change events into the outbox (the outbox is written
    from Phase 0; only the relay/consumer that drain it are deferred to Phase 3).
  - k6 baseline scenario hitting the app. App talks DIRECTLY to Postgres (no PgBouncer yet)
    to establish a "before" number.

- Phase 1 — PgBouncer:
  - Insert PgBouncer (transaction mode) between app and Postgres; point DATABASE_URL at it.
  - Migrations stay on DIRECT_DATABASE_URL.
  - Tune pool_size / default_pool_size / max_client_conn; measure vs. Phase 0 baseline.

- Phase 2 — Observability:
  - prom-client /metrics on app; postgres_exporter, pgbouncer (via postgres_exporter),
    redis_exporter; Prometheus + Grafana.
  - Build dashboards (a) HTTP / RED, (b) Postgres + PgBouncer, and (d) Node runtime /
    event loop — dashboard (c) Redis queues + consumers waits for the Phase 3 async path.
  - Add the alert rules whose metrics exist now: PgBouncer cl_waiting and HTTP p99 latency
    breach. (Consumer-group lag, relay lag, and DLQ alerts come in Phase 3.)
  - Wire k6 -> Prometheus remote-write.

- Phase 3 — Redis async path:
  - (Trade already emits trade + price-change events into the outbox within the trade
    transaction — that was wired up in Phase 0.)
  - Outbox relay (separate process) drains outbox -> XADD to the event streams.
  - Single trade-notifications consumer (separate process) subscribes to both streams,
    with a CONFIGURABLE processing rate to emulate a slow consumer.
  - XACK, XAUTOCLAIM recovery, DLQ stream.
  - Custom metrics: stream length, consumer lag, PEL, DLQ, relay lag.
  - Now build dashboard (c) Redis queues + consumers, and add the alerts that depend on
    these custom metrics: consumer-group lag, relay lag (oldest unpublished outbox row),
    and DLQ length.

- Phase 4 — Stress / breakpoint experiments:
  - Push each component to its limit (event loop, PgBouncer pool, Redis consumer lag).
  - Provoke optimistic-concurrency retry-storms, then tame: backoff+jitter, retry budget,
    circuit-breaker. Measure throughput gains.
  - Capped-stream (MAXLEN) backpressure experiment: drop-oldest vs. block-producer.

## Experiment Method

Every experiment follows the same loop (recorded in a notes log / README):
1. Hypothesis — what change, what effect is expected, on which metric.
2. Change ONE variable.
3. Run load — baseline scenario (attribute a change) or stress scenario (find a ceiling).
4. Observe — k6 + infra metrics on the same Grafana timeline.
5. Record — before/after numbers + what was learned. Revert or keep.