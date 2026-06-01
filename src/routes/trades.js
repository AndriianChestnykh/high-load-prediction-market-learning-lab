'use strict';

const { Router } = require('express');
const { pool } = require('../db');
const { tradeCost, toMicroUnits, prices } = require('../lmsr');

const router = Router();

const MAX_RETRIES = 5;

/**
 * POST /trade
 * Body: { user_id, market_id, outcome, shares }
 *
 * Executes an LMSR trade with optimistic concurrency control on the market row.
 * Retries up to MAX_RETRIES times on version conflict before giving up.
 */
router.post('/trade', async (req, res) => {
  const { user_id, market_id, outcome, shares } = req.body;

  // --- Input validation ---
  if (!user_id || !market_id) {
    return res.status(400).json({ error: 'user_id and market_id are required' });
  }
  if (outcome !== 'yes' && outcome !== 'no') {
    return res.status(400).json({ error: "outcome must be 'yes' or 'no'" });
  }
  const sharesNum = Number(shares);
  if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
    return res.status(400).json({ error: 'shares must be a positive number' });
  }

  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Read market (plain read inside txn — we'll do the version check on UPDATE)
      const marketRes = await client.query(
        'SELECT id, q_yes, q_no, b, version, state FROM markets WHERE id = $1',
        [market_id]
      );
      if (marketRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Market not found' });
      }
      const market = marketRes.rows[0];

      // 2. Check market is open
      if (market.state !== 'open') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Market is not open' });
      }

      // pg returns DOUBLE PRECISION as JS number, BIGINT as string
      const q_yes    = Number(market.q_yes);
      const q_no     = Number(market.q_no);
      const b        = Number(market.b);
      const version  = BigInt(market.version);

      // 3. Compute trade cost in micro-units
      const floatCost = tradeCost(q_yes, q_no, b, outcome, sharesNum);
      const costMicro = toMicroUnits(floatCost); // BigInt

      // 4. Lock user row and read balance
      const userRes = await client.query(
        'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
        [user_id]
      );
      if (userRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'User not found' });
      }
      const balance = BigInt(userRes.rows[0].balance);

      // 5. Check affordability
      if (balance < costMicro) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Insufficient balance',
          balance: balance.toString(),
          cost: costMicro.toString(),
        });
      }

      // 6. Optimistic update on market — version must still match
      const new_q_yes = outcome === 'yes' ? q_yes + sharesNum : q_yes;
      const new_q_no  = outcome === 'no'  ? q_no  + sharesNum : q_no;

      const updateMarket = await client.query(
        `UPDATE markets
            SET q_yes = $1, q_no = $2, version = version + 1
          WHERE id = $3 AND version = $4`,
        [new_q_yes, new_q_no, market_id, version.toString()]
      );

      if (updateMarket.rowCount === 0) {
        // Version conflict — another trade updated the market between our read and write
        await client.query('ROLLBACK');
        // Retry the whole transaction
        continue;
      }

      // 7. Debit user balance
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [costMicro.toString(), user_id]
      );

      // 8. Append to trades log
      const tradeInsert = await client.query(
        `INSERT INTO trades (user_id, market_id, outcome, shares, cost)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [user_id, market_id, outcome, sharesNum, costMicro.toString()]
      );
      const trade_id = tradeInsert.rows[0].id;

      // 9. Upsert position
      await client.query(
        `INSERT INTO positions (user_id, market_id, outcome, shares)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, market_id, outcome)
         DO UPDATE SET shares = positions.shares + EXCLUDED.shares`,
        [user_id, market_id, outcome, sharesNum]
      );

      // 10. Insert outbox events (atomic with the trade)
      const newPrices = prices(new_q_yes, new_q_no, b);
      const tradePayload = {
        trade_id: trade_id.toString(),
        user_id: user_id.toString(),
        market_id: market_id.toString(),
        outcome,
        shares: sharesNum,
        cost: costMicro.toString(),
      };
      const pricePayload = {
        market_id: market_id.toString(),
        price_yes: newPrices.yes,
        price_no: newPrices.no,
        q_yes: new_q_yes,
        q_no: new_q_no,
      };

      await client.query(
        `INSERT INTO outbox (event_type, payload) VALUES
         ($1, $2),
         ($3, $4)`,
        ['trade', JSON.stringify(tradePayload), 'price_change', JSON.stringify(pricePayload)]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        trade_id: trade_id.toString(),
        cost: costMicro.toString(),
        new_prices: newPrices,
      });

    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Trade attempt ${attempt} error:`, err.message);
      if (attempt >= MAX_RETRIES) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      // Unexpected error — don't retry, surface immediately
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }

  // Exhausted all retries due to version conflicts
  return res.status(409).json({ error: 'Trade failed due to concurrent updates, please retry' });
});

module.exports = router;
