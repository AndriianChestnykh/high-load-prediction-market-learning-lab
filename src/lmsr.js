'use strict';

/**
 * LMSR (Logarithmic Market Scoring Rule) math — pure functions, no side effects.
 *
 * Cost function: C(q) = b * ln(exp(q_yes/b) + exp(q_no/b))
 * Uses log-sum-exp trick for numerical stability:
 *   let a = max(q_yes/b, q_no/b)
 *   C(q) = b * (a + ln(exp(q_yes/b - a) + exp(q_no/b - a)))
 */

/**
 * @param {number} q_yes
 * @param {number} q_no
 * @param {number} b  liquidity parameter
 * @returns {number} market cost in floating-point (not micro-units)
 */
function cost(q_yes, q_no, b) {
  const a = Math.max(q_yes / b, q_no / b); // log-sum-exp shift
  return b * (a + Math.log(Math.exp(q_yes / b - a) + Math.exp(q_no / b - a)));
}

/**
 * Cost of buying `shares` of `outcome`.
 * Returns a floating-point value; caller must convert to micro-unit BigInt.
 *
 * @param {number} q_yes  current quantity for YES
 * @param {number} q_no   current quantity for NO
 * @param {number} b      liquidity parameter
 * @param {'yes'|'no'} outcome
 * @param {number} shares positive number of shares to buy
 * @returns {number} cost in floating-point (not micro-units)
 */
function tradeCost(q_yes, q_no, b, outcome, shares) {
  const after_yes = outcome === 'yes' ? q_yes + shares : q_yes;
  const after_no  = outcome === 'no'  ? q_no  + shares : q_no;
  return cost(after_yes, after_no, b) - cost(q_yes, q_no, b);
}

/**
 * Convert a floating-point cost to integer micro-units (BigInt).
 * Uses Math.ceil to round UP — buyer always pays at least the true cost,
 * protecting the market from rounding-down attacks.
 *
 * @param {number} floatCost
 * @returns {bigint}
 */
function toMicroUnits(floatCost) {
  // For positive (buy) cost: ceil. For negative (sell) cost: ceil still rounds
  // toward zero for the seller, which is fine (seller receives slightly less).
  return BigInt(Math.ceil(floatCost * 1_000_000));
}

/**
 * Instantaneous prices (reads as probabilities).
 * p_yes = exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))
 * Uses log-sum-exp trick for stability.
 *
 * @param {number} q_yes
 * @param {number} q_no
 * @param {number} b
 * @returns {{ yes: number, no: number }}
 */
function prices(q_yes, q_no, b) {
  const a = Math.max(q_yes / b, q_no / b);
  const exp_yes = Math.exp(q_yes / b - a);
  const exp_no  = Math.exp(q_no  / b - a);
  const denom   = exp_yes + exp_no;
  return {
    yes: exp_yes / denom,
    no:  exp_no  / denom,
  };
}

module.exports = { cost, tradeCost, toMicroUnits, prices };
