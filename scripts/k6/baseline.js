/**
 * k6 baseline load test — Phase 0
 *
 * Scenario: constant-arrival-rate, 300 RPS, 60 seconds.
 * Open model: arrivals are fixed regardless of response time, so queueing
 * and backpressure are revealed rather than hidden.
 *
 * Run:
 *   k6 run scripts/k6/baseline.js
 *
 * With Prometheus remote-write (Phase 2+):
 *   K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
 *   k6 run --out=experimental-prometheus-rw scripts/k6/baseline.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics (supplement the built-in http_req_* metrics)
const tradeDuration = new Trend('trade_duration', true); // true = display in ms
const tradeErrors   = new Rate('trade_errors');

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: 300,           // 300 iterations per second
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    // p(99) of all HTTP request durations < 200ms
    http_req_duration: ['p(99)<200'],
    // Less than 0.5% of requests should fail
    http_req_failed: ['rate<0.005'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const user_id   = Math.floor(Math.random() * 10_000) + 1;   // 1–10000
  const market_id = Math.floor(Math.random() * 100) + 1;       // 1–100
  const outcome   = Math.random() < 0.5 ? 'yes' : 'no';
  const shares    = Math.floor(Math.random() * 10) + 1;         // 1–10

  const payload = JSON.stringify({ user_id, market_id, outcome, shares });
  const params  = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(`${BASE_URL}/trade`, payload, params);

  // Record custom metrics
  tradeDuration.add(res.timings.duration);
  tradeErrors.add(res.status >= 500);

  // Soft checks (failures are reported but don't abort the test)
  check(res, {
    'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'has trade_id or error': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.trade_id !== undefined || body.error !== undefined;
      } catch {
        return false;
      }
    },
  });
}
