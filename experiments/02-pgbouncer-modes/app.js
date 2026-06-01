import 'dotenv/config';
import Fastify from 'fastify';
import { query, metricsPlugin, startMetricsServer, config } from '@hli/shared';

// ── This app is intentionally identical to exp-01 in terms of routes.
// The difference is purely in the connection target:
//   PG_PORT=5432  → direct Postgres
//   PG_PORT=6432  → via PgBouncer  ← the point of this experiment
// Edit pgbouncer.ini pool_mode / default_pool_size to observe the effect.

const app = Fastify({ logger: true });
app.register(metricsPlugin);

app.get('/healthz', async () => ({
  ok: true,
  pgTarget: `${config.pg.host}:${config.pg.port}`,
}));

app.get('/orders/:userId', async (req) => {
  const { userId } = req.params;
  const { rows } = await query(
    'SELECT id, amount, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
    [userId]
  );
  return rows;
});

app.get('/stats', async () => {
  const { rows } = await query(`
    SELECT status, COUNT(*) AS count, AVG(amount)::NUMERIC(12,2) AS avg_amount
    FROM orders
    GROUP BY status
  `);
  return rows;
});

// ── Prepared-statement demo: works in session/transaction mode, breaks in statement mode
// Uncomment to test: SET pool_mode=statement in pgbouncer.ini, then hit this route
app.get('/prepared', async () => {
  const pool = (await import('@hli/shared')).getPool();
  const client = await pool.connect();
  try {
    await client.query('PREPARE order_count AS SELECT COUNT(*) FROM orders WHERE status=$1');
    const { rows } = await client.query("EXECUTE order_count('paid')");
    await client.query('DEALLOCATE order_count');
    return rows[0];
  } finally {
    client.release();
  }
});

startMetricsServer();

app.listen({ port: config.app.port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});
