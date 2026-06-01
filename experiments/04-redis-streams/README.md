# Experiment 04 — Redis Streams

## What you'll learn

Redis Streams (`XADD`/`XREAD`/`XREADGROUP`/`XACK`) provide durable, append-only
event logs with consumer groups — similar to Kafka but embedded in Redis. You'll
learn how producers and consumer groups interact, how backpressure works, and what
happens when consumers fall behind or crash.

## Key concepts

| Concept | Command | What it does |
|---|---|---|
| Append event | `XADD` | Write a message with auto-generated ID |
| Read (no group) | `XREAD` | Sequential read, cursor-based |
| Consumer group | `XGROUP CREATE` | Multiple consumers share a stream |
| Claim from group | `XREADGROUP ... >` | Claim next undelivered messages |
| Acknowledge | `XACK` | Mark message processed |
| Pending entries | `XPENDING` | Messages claimed but not ACKed (crash recovery) |
| Reclaim stale | `XCLAIM` | Steal stuck messages from a dead consumer |

## Hypothesis

**A single consumer group with 3 parallel consumers will process events at 3×
the rate of a single consumer, with no duplicate processing, as long as all
consumers ACK promptly. Stopping a consumer without ACKing creates pending entries
visible in `XPENDING`; restarting and reading `0` (not `>`) recovers them.**

## Run

```bash
pnpm infra:up

# Terminal 1 — start producer (50 events/s)
RATE_MS=20 node experiments/04-redis-streams/producer.js

# Terminal 2 — start consumer 1
GROUP=processors CONSUMER=w1 node experiments/04-redis-streams/consumer.js

# Terminal 3 — start consumer 2
GROUP=processors CONSUMER=w2 node experiments/04-redis-streams/consumer.js

# Terminal 4 — monitor the stream
docker exec -it hli-playground-redis-1 redis-cli XLEN orders:events
docker exec -it hli-playground-redis-1 redis-cli XPENDING orders:events processors - + 10
docker exec -it hli-playground-redis-1 redis-cli XINFO GROUPS orders:events

# Simulate crash: kill consumer 1 (Ctrl+C in Terminal 2), wait 30s, check XPENDING
```

## What to observe

| Scenario | `XPENDING` count | Consumer lag |
|---|---|---|
| All consumers running | 0 | Near-zero |
| 1 consumer killed | Growing (unACKed) | Other consumers lag |
| Restarted consumer reads `0` | Drains | Recovered |

## TODO — flesh out

- [ ] Add `XCLAIM` recovery loop in consumer when pending entries are stale
- [ ] Add `redis_stream_length` to Grafana dashboard (via redis_exporter `stream.length`)
- [ ] Benchmark: what's the max event/s Redis Streams can sustain locally?
- [ ] Compare `XADD` vs Pub/Sub (`PUBLISH`) for fan-out vs queue semantics
