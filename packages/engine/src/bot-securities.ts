// Bot behaviour in the securities mode (docs/DESIGN.md #48): invest cautiously, diversify,
// take profits after the lock-up, and sell first when money is needed in debt.
import { netWorth } from "./helpers.ts";
import { hash01 } from "./rng.ts";
import {
  MAX_SHARES_PER_SECURITY,
  buyBlocker,
  changePercent,
  anticipatedYieldPermille,
  currentYieldPermille,
  holdingsOf,
  holdingsValue,
  planSale,
  priceOfSecurity,
  saleProceeds,
  securitiesOf,
} from "./securities.ts";
import type { BotLevel, GameAction, GameState, PlayerState } from "./types.ts";

/** Sell a lot once it is this much above its buy price (percent). */
const TAKE_PROFIT_PERCENT = 10;
/** A bot invests at most this share of its surplus cash with one purchase. */
const BUDGET_PERCENT_OF_SURPLUS = 25;
/** A bot keeps its holdings below this share of its net worth. */
const MAX_PORTFOLIO_PERCENT = 35;
/** Do not buy a security that fell by more than this in the last round (percent). */
const AVOID_FALLING_PERCENT = 10;

/**
 * Dividends in the valuation (docs/DESIGN.md #83), by difficulty: easy ignores them, normal prefers
 * the company with the best current yield when nothing else distinguishes the candidates, hard
 * additionally avoids companies that pay nothing and keeps a dividend payer for a few more rounds
 * of income before taking a profit.
 */
const DIVIDEND_AWARE: Record<BotLevel, boolean> = { easy: false, normal: true, hard: true };
/** A hard bot waits until the price gain exceeds the take-profit threshold plus this many rounds of yield. */
const HARD_HOLD_ROUNDS = 3;

/** A hard bot values a company by the yield it expects over this many rounds (dividends decay, #84). */
const HARD_YIELD_HORIZON = 10;

/** The yield a bot counts on: normal looks at the current one, hard anticipates the decay. */
function botYieldPermille(state: GameState, me: PlayerState, secId: string): number {
  return me.botLevel === "hard"
    ? anticipatedYieldPermille(state, secId, HARD_YIELD_HORIZON)
    : currentYieldPermille(state, secId);
}

/** Take-profit threshold of a lot in percent above its buy price. */
function takeProfitPercent(state: GameState, me: PlayerState, secId: string): number {
  if (me.botLevel !== "hard") {
    return TAKE_PROFIT_PERCENT;
  }
  return (
    TAKE_PROFIT_PERCENT +
    Math.floor((anticipatedYieldPermille(state, secId, HARD_HOLD_ROUNDS) * HARD_HOLD_ROUNDS) / 10)
  );
}

/** Debt: the sale that raises the most first (unlocked lots before discounted locked ones). */
export function debtSecuritiesAction(state: GameState, me: PlayerState): GameAction | null {
  const price = (secId: string): number => priceOfSecurity(state, secId);
  const options = holdingsOf(me)
    .map((h, lot) => {
      const plan = planSale(state, me, h.secId, lot, true);
      const emergency = plan.ok && (plan.lots[0]?.emergency ?? false);
      return { h, lot, emergency, proceeds: saleProceeds(price(h.secId), h.shares, emergency) };
    })
    .sort((a, b) => Number(a.emergency) - Number(b.emergency) || b.proceeds - a.proceeds);
  const first = options[0];
  return first ? { type: "sell-securities", secId: first.h.secId, lot: first.lot } : null;
}

/**
 * On the bot's own turn: take profits / free cash when it is short, else invest part of the
 * surplus above `reserve` (at most one purchase per round, diversified).
 */
export function turnSecuritiesAction(
  state: GameState,
  me: PlayerState,
  reserve: number,
  lowCash: number,
): GameAction | null {
  const market = state.market;
  if (!state.settings.securities || !market) {
    return null;
  }
  // 1. sell an unlocked lot with a profit, or the biggest one when cash is low
  const sellable = holdingsOf(me)
    .map((h, lot) => ({ h, lot, ok: planSale(state, me, h.secId, lot, false).ok }))
    .filter((x) => x.ok);
  const profit = sellable.find(
    ({ h }) =>
      priceOfSecurity(state, h.secId) * 100 >=
      h.buyPrice * (100 + takeProfitPercent(state, me, h.secId)),
  );
  if (profit) {
    return { type: "sell-securities", secId: profit.h.secId, lot: profit.lot };
  }
  if (me.cash < lowCash) {
    const biggest = [...sellable].sort(
      (a, b) =>
        priceOfSecurity(state, b.h.secId) * b.h.shares -
          priceOfSecurity(state, a.h.secId) * a.h.shares || a.lot - b.lot,
    )[0];
    if (biggest) {
      return { type: "sell-securities", secId: biggest.h.secId, lot: biggest.lot };
    }
  }
  // 2. invest: one purchase per round, only from the surplus, never beyond the portfolio cap
  if (holdingsOf(me).some((h) => h.boughtRound === state.round)) {
    return null;
  }
  const surplus = me.cash - reserve;
  const budget = Math.floor((surplus * BUDGET_PERCENT_OF_SURPLUS) / 100);
  if (budget < 1) {
    return null;
  }
  const worth = netWorth(state, me.id);
  if (holdingsValue(state, me.id) * 100 >= worth * MAX_PORTFOLIO_PERCENT) {
    return null;
  }
  const held = (secId: string): number =>
    holdingsOf(me)
      .filter((h) => h.secId === secId)
      .reduce((sum, h) => sum + h.shares * priceOfSecurity(state, h.secId), 0);
  const aware = DIVIDEND_AWARE[me.botLevel];
  const candidates = securitiesOf(state)
    .filter((c) => changePercent(market, c.id) > -AVOID_FALLING_PERCENT)
    .filter((c) => priceOfSecurity(state, c.id) <= budget)
    .map((c) => ({
      c,
      owned: held(c.id),
      yield: aware ? botYieldPermille(state, me, c.id) : 0,
      jitter: hash01(state.rng, state.version, me.id, c.id),
    }));
  const payers = candidates.filter((x) => x.yield > 0);
  const pool = me.botLevel === "hard" && payers.length > 0 ? payers : candidates;
  const choice = pool.sort(
    (a, b) => a.owned - b.owned || b.yield - a.yield || a.jitter - b.jitter,
  )[0];
  if (!choice) {
    return null;
  }
  const price = priceOfSecurity(state, choice.c.id);
  const shares = Math.min(MAX_SHARES_PER_SECURITY, Math.floor(budget / price));
  return buyBlocker(state, me, choice.c.id, shares) === null
    ? { type: "buy-securities", secId: choice.c.id, shares }
    : null;
}
