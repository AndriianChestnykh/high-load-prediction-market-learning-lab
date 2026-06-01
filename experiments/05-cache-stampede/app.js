import 'dotenv/config';
import Fastify from 'fastify';
import { query, getRedis, metricsPlugin, startMetricsServer, config } from '@hli/shared';

// ── TODO: flesh out cache-aside, thundering herd, and lock-based prevention
// See README for the full hypothesis.

const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 5; // seconds
const MODE      = process.env.CACHE_MODE || 'naive';    // naive | lock | probabilistic

const app = Fastify({ logger: true });
app.register(metricsPlugin);

app.get('/healthz', async () => ({ ok: true, mode: MODE }));

// ── Naive cache-aside (thundering herd possible) ──────────────────────────
async function getStatsNaive() {
  const redis = getRedis();
  const cached = await redis.get('stats:orders');
  if (cached) return { source: 'cache', data: JSON.parse(cached) };

  // Simulate slow DB query
  const { rows } = await query(`
    SELECT status, COUNT(*) AS count, AVG(amount)::NUMERIC(12,2) AS avg_amount
    FROM orders GROUP BY status
  `);
  await redis.set('stats:orders', JSON.stringify(rows), 'EX', CACHE_TTL);
  return { source: 'db', data: rows };
}

// ── TODO: implement lock-based prevention (SET NX) ────────────────────────
async function getStatsLocked() {
  // TODO: use redis SET ... NX EX to acquire a short lock,
  // other requests wait/retry while the lock holder populates the cache.
  return getStatsNaive(); // placeholder
}

app.get('/stats', async () => {
  if (MODE === 'lock') return getStatsLocked();
  return getStatsNaive();
});

startMetricsServer();

app.listen({ port: config.app.port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});
