import client from "prom-client";
import type { Request, Response, NextFunction } from "express";

// Single registry for the HTTP app. Phase 3's relay and consumer get their own.
export const register = new client.Registry();
register.setDefaultLabels({ app: "predmarket-http" });

// Node runtime / event-loop ceiling metrics (nodejs_eventloop_lag_seconds,
// process_cpu_*, process_resident_memory_bytes, nodejs_gc_*, …).
client.collectDefaultMetrics({ register });

// ---------------------------------------------------------------------------
// HTTP RED (rate / errors / duration)
// ---------------------------------------------------------------------------
export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  // Tuned around the 200ms p99 budget so the histogram has resolution there.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests by method, route, and status code",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Optimistic concurrency (custom — exporters can't see these)
// ---------------------------------------------------------------------------
export const tradeVersionConflicts = new client.Counter({
  name: "trade_version_conflicts_total",
  help: "Optimistic-concurrency version conflicts on market row updates",
  registers: [register],
});

export const tradeRetriesExhausted = new client.Counter({
  name: "trade_retries_exhausted_total",
  help: "Trades that returned 409 after exhausting MAX_RETRIES",
  registers: [register],
});

export const tradeAttempts = new client.Histogram({
  name: "trade_attempts_per_request",
  help: "Attempts (including retries) per successful trade request",
  buckets: [1, 2, 3, 4, 5],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Middleware: time every request and record RED metrics on response finish.
// ---------------------------------------------------------------------------
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    // Use the matched route template (e.g. "/markets/:id") to keep label
    // cardinality bounded; fall back to "unmatched" for 404s with no route.
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path as string}`
      : "unmatched";
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}
