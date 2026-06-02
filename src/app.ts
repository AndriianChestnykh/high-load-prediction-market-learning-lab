import express from "express";
import tradeRouter from "./routes/trade.js";
import marketsRouter from "./routes/markets.js";
import { register, metricsMiddleware } from "./metrics.js";

const app = express();

// Time every request (records HTTP RED metrics on response finish).
app.use(metricsMiddleware);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Prometheus scrape endpoint.
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use(tradeRouter);
app.use(marketsRouter);

export default app;
