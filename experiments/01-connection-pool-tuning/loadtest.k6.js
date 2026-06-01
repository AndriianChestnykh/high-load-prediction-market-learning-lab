import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

// ── Scenario: ramp up to 200 VUs, hold, ramp down ─────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 50  },   // warm up
    { duration: '60s', target: 200 },   // ramp to stress level
    { duration: '60s', target: 200 },   // hold
    { duration: '30s', target: 0   },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile under 500ms
    errors:            ['rate<0.01'],   // error rate under 1%
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  // Mix of light and heavy queries
  const userId = Math.floor(Math.random() * 1000) + 1;

  const res = Math.random() < 0.8
    ? http.get(`${BASE}/orders/${userId}`)
    : http.get(`${BASE}/stats`);

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'latency < 1s': (r) => r.timings.duration < 1000,
  });
  errorRate.add(!ok);

  sleep(0.1);
}
