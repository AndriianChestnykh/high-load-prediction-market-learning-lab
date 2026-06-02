import type { Outcome, MarketPrices } from "../types/index.js";

export function cost(qYes: number, qNo: number, b: number): number {
  return b * Math.log(Math.exp(qYes / b) + Math.exp(qNo / b));
}

export function tradeCostMicroUnits(
  qYesBefore: number,
  qNoBefore: number,
  outcome: Outcome,
  shares: number,
  b: number
): bigint {
  const qYesAfter = outcome === "yes" ? qYesBefore + shares : qYesBefore;
  const qNoAfter = outcome === "no" ? qNoBefore + shares : qNoBefore;
  const delta = cost(qYesAfter, qNoAfter, b) - cost(qYesBefore, qNoBefore, b);
  return BigInt(Math.round(delta * 1_000_000));
}

export function prices(qYes: number, qNo: number, b: number): MarketPrices {
  const expYes = Math.exp(qYes / b);
  const expNo = Math.exp(qNo / b);
  const total = expYes + expNo;
  return {
    p_yes: expYes / total,
    p_no: expNo / total,
  };
}
