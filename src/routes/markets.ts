import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import pool from "../db/pool.js";
import { getAllMarkets, getMarketById } from "../db/queries.js";
import { prices } from "../math/lmsr.js";

const router: Router = createRouter();

router.get("/markets", async (_req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const markets = await getAllMarkets(client);
    const result = markets.map((m) => {
      const p = prices(m.q_yes, m.q_no, m.b);
      return { ...m, p_yes: p.p_yes, p_no: p.p_no };
    });
    res.json(result);
  } finally {
    client.release();
  }
});

router.get("/markets/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid market id" });
    return;
  }

  const client = await pool.connect();
  try {
    const market = await getMarketById(client, id);
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    const p = prices(market.q_yes, market.q_no, market.b);
    res.json({ ...market, p_yes: p.p_yes, p_no: p.p_no });
  } finally {
    client.release();
  }
});

export default router;
