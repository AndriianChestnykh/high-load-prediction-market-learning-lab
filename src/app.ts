import express from "express";
import tradeRouter from "./routes/trade.js";
import marketsRouter from "./routes/markets.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(tradeRouter);
app.use(marketsRouter);

export default app;
