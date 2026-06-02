import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import pool from "../db/pool.js";
import {
  getMarketForUpdate,
  getUser,
  updateMarketOptimistic,
  debitUser,
  insertTrade,
  upsertPosition,
  insertOutboxEvents,
} from "../db/queries.js";
import { tradeCostMicroUnits, prices } from "../math/lmsr.js";
import type { Outcome } from "../types/index.js";
import {
  tradeVersionConflicts,
  tradeRetriesExhausted,
  tradeAttempts,
} from "../metrics.js";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exp = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * exp;
  return exp + jitter;
}

interface TradeBody {
  user_id: number;
  market_id: number;
  outcome: Outcome;
  shares: number;
}

const router: Router = createRouter();

router.post("/trade", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Partial<TradeBody>;
  const { user_id, market_id, outcome, shares } = body;

  if (
    typeof user_id !== "number" ||
    typeof market_id !== "number" ||
    (outcome !== "yes" && outcome !== "no") ||
    typeof shares !== "number" ||
    shares <= 0
  ) {
    res.status(400).json({
      error: "Invalid request body",
      received: { user_id, market_id, outcome, shares },
      required: { user_id: "number", market_id: "number", outcome: "'yes'|'no'", shares: "number > 0" },
    });
    return;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(backoffDelay(attempt - 1));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const market = await getMarketForUpdate(client, market_id);
      if (!market) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Market not found", market_id });
        return;
      }

      if (market.state !== "open") {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "Market is not open",
          market_id: market.id,
          question: market.question,
          state: market.state,
          winning_outcome: market.winning_outcome,
        });
        return;
      }

      const cost = tradeCostMicroUnits(
        market.q_yes,
        market.q_no,
        outcome,
        shares,
        market.b
      );

      const user = await getUser(client, user_id);
      if (!user) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "User not found", user_id });
        return;
      }

      if (user.balance < cost) {
        await client.query("ROLLBACK");
        res.status(402).json({
          error: "Insufficient balance",
          user_id,
          balance: user.balance.toString(),
          cost: cost.toString(),
          shortfall: (cost - user.balance).toString(),
        });
        return;
      }

      const qYesDelta = outcome === "yes" ? shares : 0;
      const qNoDelta = outcome === "no" ? shares : 0;

      const updated = await updateMarketOptimistic(
        client,
        market_id,
        qYesDelta,
        qNoDelta,
        market.version
      );

      if (!updated) {
        await client.query("ROLLBACK");
        tradeVersionConflicts.inc();
        lastError = new Error("Version conflict");
        continue;
      }

      await debitUser(client, user_id, cost);

      const tradeId = await insertTrade(
        client,
        user_id,
        market_id,
        outcome,
        shares,
        cost
      );

      await upsertPosition(client, user_id, market_id, outcome, shares);

      const newQYes = market.q_yes + qYesDelta;
      const newQNo = market.q_no + qNoDelta;
      const newVersion = market.version + 1;
      const p = prices(newQYes, newQNo, market.b);

      await insertOutboxEvents(
        client,
        {
          trade_id: tradeId,
          user_id,
          market_id,
          outcome,
          shares,
          cost: cost.toString(),
          created_at: new Date().toISOString(),
        },
        {
          market_id,
          p_yes: p.p_yes,
          p_no: p.p_no,
          q_yes: newQYes,
          q_no: newQNo,
          version: newVersion,
        }
      );

      await client.query("COMMIT");

      // attempt is 0-based; record the number of tries this trade needed.
      tradeAttempts.observe(attempt + 1);

      res.status(201).json({
        trade_id: tradeId,
        cost: cost.toString(),
        p_yes: p.p_yes,
        p_no: p.p_no,
      });
      return;
    } catch (err) {
      await client.query("ROLLBACK");
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      client.release();
    }
  }

  tradeRetriesExhausted.inc();
  console.error("Trade failed after max retries:", lastError);
  res.status(409).json({
    error: "Version conflict: trade failed after max retries",
    market_id,
    retries: MAX_RETRIES,
  });
});

export default router;
