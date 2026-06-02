import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../src/app.js";
import pool from "../src/db/pool.js";

let server: http.Server;
let base: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      base = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await pool.end();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string };
    assert.equal(body.status, "ok");
  });
});

describe("GET /markets", () => {
  it("returns a non-empty list of markets with prices", async () => {
    const res = await fetch(`${base}/markets`);
    assert.equal(res.status, 200);
    const body = await res.json() as unknown[];
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);

    const m = body[0] as Record<string, unknown>;
    assert.ok(typeof m["id"] === "number");
    assert.ok(typeof m["question"] === "string");
    assert.ok(typeof m["p_yes"] === "number");
    assert.ok(typeof m["p_no"] === "number");
    assert.ok(Math.abs((m["p_yes"] as number) + (m["p_no"] as number) - 1) < 1e-9);
  });
});

describe("GET /markets/:id", () => {
  it("returns a single market with prices", async () => {
    const res = await fetch(`${base}/markets/1`);
    assert.equal(res.status, 200);
    const m = await res.json() as Record<string, unknown>;
    assert.equal(m["id"], 1);
    assert.ok(typeof m["question"] === "string");
    assert.ok(typeof m["p_yes"] === "number");
    assert.ok(typeof m["p_no"] === "number");
    assert.ok(Math.abs((m["p_yes"] as number) + (m["p_no"] as number) - 1) < 1e-9);
  });
});

describe("POST /trade", () => {
  it("executes a trade and returns trade_id, cost, and new prices", async () => {
    const res = await fetch(`${base}/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: 1, market_id: 1, outcome: "yes", shares: 1 }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(typeof body["trade_id"] === "number");
    assert.ok(typeof body["cost"] === "string", "cost must be a string (bigint)");
    assert.ok(BigInt(body["cost"] as string) > 0n);
    assert.ok(typeof body["p_yes"] === "number");
    assert.ok(typeof body["p_no"] === "number");
    assert.ok(Math.abs((body["p_yes"] as number) + (body["p_no"] as number) - 1) < 1e-9);
  });
});
