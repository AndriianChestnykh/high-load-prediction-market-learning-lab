import type { PoolClient } from "pg";
import type {
  Market,
  User,
  Outcome,
  TradeEvent,
  PriceChangeEvent,
} from "../types/index.js";

interface RawMarket {
  id: number;
  question: string;
  b: string;
  q_yes: string;
  q_no: string;
  version: number;
  state: string;
  winning_outcome: string | null;
}

interface RawUser {
  id: number;
  balance: string;
}

function parseMarket(row: RawMarket): Market {
  return {
    id: row.id,
    question: row.question,
    b: parseFloat(row.b),
    q_yes: parseFloat(row.q_yes),
    q_no: parseFloat(row.q_no),
    version: row.version,
    state: row.state as Market["state"],
    winning_outcome: row.winning_outcome as Market["winning_outcome"],
  };
}

function parseUser(row: RawUser): User {
  return {
    id: row.id,
    balance: BigInt(row.balance),
  };
}

export async function getMarketForUpdate(
  client: PoolClient,
  marketId: number
): Promise<Market | null> {
  const result = await client.query<RawMarket>(
    "SELECT id, question, b, q_yes, q_no, version, state, winning_outcome FROM markets WHERE id = $1",
    [marketId]
  );
  if (result.rows.length === 0) return null;
  return parseMarket(result.rows[0] as RawMarket);
}

export async function getUser(
  client: PoolClient,
  userId: number
): Promise<User | null> {
  const result = await client.query<RawUser>(
    "SELECT id, balance FROM users WHERE id = $1 FOR UPDATE",
    [userId]
  );
  if (result.rows.length === 0) return null;
  return parseUser(result.rows[0] as RawUser);
}

export async function updateMarketOptimistic(
  client: PoolClient,
  marketId: number,
  qYesDelta: number,
  qNoDelta: number,
  expectedVersion: number
): Promise<boolean> {
  const result = await client.query(
    `UPDATE markets
     SET q_yes = q_yes + $1,
         q_no  = q_no  + $2,
         version = version + 1
     WHERE id = $3 AND version = $4`,
    [qYesDelta, qNoDelta, marketId, expectedVersion]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function debitUser(
  client: PoolClient,
  userId: number,
  amount: bigint
): Promise<void> {
  const result = await client.query(
    "UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1",
    [amount.toString(), userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Insufficient balance at debit time");
  }
}

export async function insertTrade(
  client: PoolClient,
  userId: number,
  marketId: number,
  outcome: Outcome,
  shares: number,
  cost: bigint
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO trades (user_id, market_id, outcome, shares, cost)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, marketId, outcome, shares, cost.toString()]
  );
  return (result.rows[0] as { id: number }).id;
}

export async function upsertPosition(
  client: PoolClient,
  userId: number,
  marketId: number,
  outcome: Outcome,
  shares: number
): Promise<void> {
  await client.query(
    `INSERT INTO positions (user_id, market_id, outcome, shares)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, market_id, outcome)
     DO UPDATE SET shares = positions.shares + EXCLUDED.shares`,
    [userId, marketId, outcome, shares]
  );
}

export async function insertOutboxEvents(
  client: PoolClient,
  tradeEvent: TradeEvent,
  priceChangeEvent: PriceChangeEvent
): Promise<void> {
  await client.query(
    `INSERT INTO outbox (event_type, payload) VALUES
     ('trade', $1::jsonb),
     ('price_change', $2::jsonb)`,
    [JSON.stringify(tradeEvent), JSON.stringify(priceChangeEvent)]
  );
}

export async function getAllMarkets(
  client: PoolClient
): Promise<Market[]> {
  const result = await client.query<RawMarket>(
    "SELECT id, question, b, q_yes, q_no, version, state, winning_outcome FROM markets ORDER BY id"
  );
  return result.rows.map(parseMarket);
}

export async function getMarketById(
  client: PoolClient,
  marketId: number
): Promise<Market | null> {
  const result = await client.query<RawMarket>(
    "SELECT id, question, b, q_yes, q_no, version, state, winning_outcome FROM markets WHERE id = $1",
    [marketId]
  );
  if (result.rows.length === 0) return null;
  return parseMarket(result.rows[0] as RawMarket);
}
