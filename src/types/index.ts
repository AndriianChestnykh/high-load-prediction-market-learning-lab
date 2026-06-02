export type Outcome = "yes" | "no";

export type MarketState = "open" | "resolved";

export interface Market {
  id: number;
  question: string;
  b: number;
  q_yes: number;
  q_no: number;
  version: number;
  state: MarketState;
  winning_outcome: Outcome | null;
}

export interface User {
  id: number;
  balance: bigint;
}

export interface Trade {
  id: number;
  user_id: number;
  market_id: number;
  outcome: Outcome;
  shares: number;
  cost: bigint;
  created_at: Date;
}

export interface Position {
  user_id: number;
  market_id: number;
  outcome: Outcome;
  shares: number;
}

export interface OutboxRow {
  id: number;
  event_type: string;
  payload: TradeEvent | PriceChangeEvent;
  created_at: Date;
  published_at: Date | null;
}

export interface TradeEvent {
  trade_id: number;
  user_id: number;
  market_id: number;
  outcome: Outcome;
  shares: number;
  cost: string;
  created_at: string;
}

export interface PriceChangeEvent {
  market_id: number;
  p_yes: number;
  p_no: number;
  q_yes: number;
  q_no: number;
  version: number;
}

export interface MarketPrices {
  p_yes: number;
  p_no: number;
}
