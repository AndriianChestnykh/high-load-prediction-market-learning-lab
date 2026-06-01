import 'dotenv/config';
import cluster from 'node:cluster';
import os from 'node:os';
import Fastify from 'fastify';
import { query, metricsPlugin, startMetricsServer, config } from '@hli/shared';

// ── TODO: flesh out worker count experiments ──────────────────────────────
// Try: WORKERS=1 pnpm exp 03  vs  WORKERS=4  vs  WORKERS=8
// See README for the full hypothesis.

const WORKERS = parseInt(process.env.WORKERS) || os.availableParallelism();

if (cluster.isPrimary) {
  console.log(`[primary] pid=${process.pid} spawning ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker, code) => {
    console.warn(`[primary] worker ${worker.process.pid} exited (${code}) — restarting`);
    cluster.fork();
  });
} else {
  const app = Fastify({ logger: false });
  app.register(metricsPlugin);

  app.get('/healthz', async () => ({ ok: true, pid: process.pid, worker: cluster.worker.id }));

  // CPU-bound stub: simulate a compute-heavy request
  app.get('/cpu', async (req) => {
    const iterations = parseInt(req.query.n) || 1_000_000;
    let sum = 0;
    for (let i = 0; i < iterations; i++) sum += Math.sqrt(i);
    return { sum, pid: process.pid };
  });

  // I/O-bound: DB query (same as exp-01)
  app.get('/orders/:userId', async (req) => {
    const { rows } = await query(
      'SELECT id, amount, status FROM orders WHERE user_id = $1 LIMIT 20',
      [req.params.userId]
    );
    return rows;
  });

  startMetricsServer(config.app.metricsPort + (cluster.worker.id - 1));

  app.listen({ port: config.app.port, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`[worker ${cluster.worker.id}] pid=${process.pid} listening :${config.app.port}`);
  });
}
