import http from 'node:http';
import { Registry, collectDefaultMetrics, Histogram, Gauge } from 'prom-client';
import { config } from './config.js';
import { poolStats } from './db.js';

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'node_' });

// ── HTTP request latency ─────────────────────────────────────────────────
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ── PG pool gauges ───────────────────────────────────────────────────────
const pgPoolTotal = new Gauge({
  name: 'pg_pool_total_connections',
  help: 'Total connections in the pg pool',
  registers: [registry],
});
const pgPoolIdle = new Gauge({
  name: 'pg_pool_idle_connections',
  help: 'Idle connections in the pg pool',
  registers: [registry],
});
const pgPoolWaiting = new Gauge({
  name: 'pg_pool_waiting_clients',
  help: 'Clients waiting for a pg connection',
  registers: [registry],
});

// Refresh pool gauges before every scrape
registry.registerCollector({
  collect() {
    const s = poolStats();
    pgPoolTotal.set(s.total);
    pgPoolIdle.set(s.idle);
    pgPoolWaiting.set(s.waiting);
  },
});

// ── Fastify plugin that records request duration ─────────────────────────
export function metricsPlugin(fastify, _opts, done) {
  fastify.addHook('onResponse', (req, reply, next) => {
    httpRequestDuration
      .labels(req.method, req.routeOptions?.url ?? req.url, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000);
    next();
  });
  done();
}

// ── Standalone HTTP server for /metrics (separate port) ─────────────────
export function startMetricsServer(port = config.app.metricsPort) {
  const server = http.createServer(async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });
  server.listen(port, () => {
    console.log(`[metrics] listening on :${port}/metrics`);
  });
  return server;
}
