import 'dotenv/config';
import Fastify from 'fastify';
import { query, metricsPlugin, startMetricsServer, config } from '@hli/shared';

const app = Fastify({ logger: true });
app.register(metricsPlugin);

// ── Routes ────────────────────────────────────────────────────────────────

app.get('/healthz', async () => ({ ok: true }));

// Simulate a typical "fetch orders for a user" query
app.get('/orders/:userId', async (req, reply) => {
  const { userId } = req.params;
  const { rows } = await query(
    'SELECT id, amount, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
    [userId]
  );
  return rows;
});

// Simulate a heavier aggregation query
app.get('/stats', async () => {
  const { rows } = await query(`
    SELECT status, COUNT(*) AS count, AVG(amount)::NUMERIC(12,2) AS avg_amount
    FROM orders
    GROUP BY status
  `);
  return rows;
});

// Pool info for quick manual checks
app.get('/pool', async () => {
  const { poolStats } = await import('@hli/shared');
  return poolStats();
});

// ── Start ─────────────────────────────────────────────────────────────────

startMetricsServer();

app.listen({ port: config.app.port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});
