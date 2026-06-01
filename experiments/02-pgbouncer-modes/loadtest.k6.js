import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '20s', target: 50  },
    { duration: '60s', target: 150 },
    { duration: '60s', target: 150 },
    { duration: '20s', target: 0   },
  ],
  thresholds: {
    http_req_duration: ['p(95)<600'],
    errors:            ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  const userId = Math.floor(Math.random() * 1000) + 1;
  const res = Math.random() < 0.8
    ? http.get(`${BASE}/orders/${userId}`)
    : http.get(`${BASE}/stats`);

  const ok = check(res, { 'status 200': (r) => r.status === 200 });
  errorRate.add(!ok);
  sleep(0.1);
}
