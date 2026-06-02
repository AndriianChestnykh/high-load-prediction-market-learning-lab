import { open } from "k6/execution";
import http from "k6/http";
import { check } from "k6";
import { Options } from "k6/options";

export const options: Options = {
  scenarios: {
    constant_arrival_rate: {
      executor: "constant-arrival-rate",
      rate: 300,
      timeUnit: "1s",
      duration: "5s",
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<200"],
    http_req_failed: ["rate<0.005"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(95)", "p(99)"],
};

const BASE_URL = __ENV["BASE_URL"] || "http://localhost:3000";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export default function (): void {
  const userId = randomInt(1, 10000);
  const marketId = randomInt(1, 100);
  const outcome = Math.random() < 0.5 ? "yes" : "no";
  const shares = parseFloat(randomFloat(0.1, 10).toFixed(4));

  const payload = JSON.stringify({ user_id: userId, market_id: marketId, outcome, shares });

  const res = http.post(`${BASE_URL}/trade`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(res, {
    "status is 201 or 402 or 409": (r) =>
      r.status === 201 || r.status === 402 || r.status === 409,
  });
}
