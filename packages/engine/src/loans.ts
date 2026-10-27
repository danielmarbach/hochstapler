// "Protzmodus" (show-off mode): bank loans with a wealth-based interest rate (docs/DESIGN.md #93).
// Pure rules; game.ts wires them into the turn flow (actions, interest at the start of the own
// turn, bankruptcy) and helpers.ts subtracts the debt from the net worth.
//
// RULES
//   limit     every player may owe the bank at most LOAN_LIMIT_PERCENT of the starting cash,
//             borrowed and repaid in multiples of LOAN_STEP
//   rate      locked when the loan is taken, from the borrower's net worth relative to the
//             active players: poorest -> curve.poorest, average -> curve.average, richest ->
//             curve.richest, linear in between (whole percent per round)
//   tranches  every loan is a tranche with its own locked rate; tranches with the same rate merge;
//             repayment pays off the most expensive tranche first
//   interest  ceil(amount x rate / 100) per tranche, paid in cash at the start of each own turn
//             (a normal payment: short of cash = the usual debt phase, then bankruptcy)
import { makeMsg } from "./i18n/index.ts";
import type { EngineMsg } from "./i18n/index.ts";
import type { GameState, LoanTranche, PlayerState } from "./types.ts";

/** Maximum outstanding debt per player, in percent of the starting cash. */
export const LOAN_LIMIT_PERCENT = 50;
/** Loans are taken and repaid in multiples of this amount (all themes share the same amounts). */
export const LOAN_STEP = 100;

/** Interest per round in whole percent at the bottom, the middle and the top of the table. */
export interface LoanRateCurve {
  poorest: number;
  average: number;
  richest: number;
}

export const LOAN_RATE_CURVE: LoanRateCurve = { poorest: 4, average: 8, richest: 25 };

/** Lowest and highest rate the curve can produce. */
export const LOAN_RATE_MIN = LOAN_RATE_CURVE.poorest;
export const LOAN_RATE_MAX = LOAN_RATE_CURVE.richest;

/** Is the show-off mode on in this game? */
export function loansOn(state: Pick<GameState, "settings">): boolean {
  return state.settings.loans;
}

/** The most a player may owe at once (a multiple of LOAN_STEP, at least one step). */
export function loanLimit(state: Pick<GameState, "settings">): number {
  const raw = Math.floor((state.settings.startingCash * LOAN_LIMIT_PERCENT) / 100);
  return Math.max(LOAN_STEP, Math.floor(raw / LOAN_STEP) * LOAN_STEP);
}

export function tranchesOf(p: Pick<PlayerState, "loans">): LoanTranche[] {
  return p.loans ?? [];
}

/** Outstanding debt of a player. */
export function loanDebt(p: Pick<PlayerState, "loans">): number {
  return tranchesOf(p).reduce((sum, t) => sum + t.amount, 0);
}

/** How much more the player may borrow right now (ignoring the turn). */
export function loanRoom(
  state: Pick<GameState, "settings">,
  p: Pick<PlayerState, "loans">,
): number {
  return Math.max(0, loanLimit(state) - loanDebt(p));
}

/** Interest of one tranche per round (rounded up, so a loan is never free). */
export function trancheInterest(t: LoanTranche): number {
  return Math.ceil((t.amount * t.ratePct) / 100);
}

/** Interest due at the start of the player's next turn. */
export function interestDue(p: Pick<PlayerState, "loans">): number {
  return tranchesOf(p).reduce((sum, t) => sum + trancheInterest(t), 0);
}

/**
 * Rate for net worth `worth` in a table whose active players range from `min` to `max` with the
 * average `avg`: piecewise linear poorest -> average -> richest, rounded to whole percent and
 * clamped to the curve. A table where everybody is worth the same pays the average rate.
 */
export function rateForWorth(
  worth: number,
  min: number,
  avg: number,
  max: number,
  curve: LoanRateCurve = LOAN_RATE_CURVE,
): number {
  if (max <= min) {
    return curve.average;
  }
  let rate: number;
  if (worth <= avg) {
    rate =
      avg <= min
        ? curve.average
        : curve.poorest + ((curve.average - curve.poorest) * (worth - min)) / (avg - min);
  } else {
    rate =
      max <= avg
        ? curve.average
        : curve.average + ((curve.richest - curve.average) * (worth - avg)) / (max - avg);
  }
  return Math.min(curve.richest, Math.max(curve.poorest, Math.round(rate)));
}

/**
 * The rate the bank would lock for a new loan of `playerId` now. `worthOf` is the net worth
 * (helpers.ts `netWorth`; passed in to keep this module free of a helpers import cycle).
 */
export function loanRateFor(
  state: GameState,
  playerId: string,
  worthOf: (state: GameState, playerId: string) => number,
  curve: LoanRateCurve = LOAN_RATE_CURVE,
): number {
  const active = state.players.filter((p) => !p.bankrupt);
  const worths = active.map((p) => worthOf(state, p.id));
  if (worths.length === 0) {
    return curve.average;
  }
  const own = worthOf(state, playerId);
  const min = Math.min(...worths);
  const max = Math.max(...worths);
  const avg = worths.reduce((a, b) => a + b, 0) / worths.length;
  return rateForWorth(own, min, avg, max, curve);
}

/** May the player take or repay a loan in the current phase? (own turn, nothing pending) */
export function loanTurn(state: GameState, playerId: string): boolean {
  const ph = state.phase;
  const cur = state.players[state.current];
  return (
    state.status === "running" &&
    cur?.id === playerId &&
    (ph.type === "await-roll" || ph.type === "await-buy" || ph.type === "await-end-turn")
  );
}

/** Why `p` cannot borrow `amount` now, or null. */
export function takeLoanBlocker(
  state: GameState,
  p: PlayerState,
  amount: number,
): EngineMsg | null {
  if (!loansOn(state)) {
    return makeMsg("err.loanOff");
  }
  if (!loanTurn(state, p.id)) {
    return makeMsg("err.loanNotNow");
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount % LOAN_STEP !== 0) {
    return makeMsg("err.loanStep", { amount: LOAN_STEP });
  }
  const room = loanRoom(state, p);
  if (amount > room) {
    return makeMsg("err.loanLimit", { amount: room });
  }
  return null;
}

/** Why `p` cannot repay `amount` now, or null. */
export function repayLoanBlocker(
  state: GameState,
  p: PlayerState,
  amount: number,
): EngineMsg | null {
  const debt = loanDebt(p);
  if (debt === 0) {
    return makeMsg("err.loanNone");
  }
  if (!loanTurn(state, p.id)) {
    return makeMsg("err.loanNotNow");
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount % LOAN_STEP !== 0) {
    return makeMsg("err.loanStep", { amount: LOAN_STEP });
  }
  if (amount > debt) {
    return makeMsg("err.loanTooMuch", { amount: debt });
  }
  if (p.cash < amount) {
    return makeMsg("err.notEnoughCash");
  }
  return null;
}

/** Adds a tranche at `ratePct` (merged with an existing tranche of the same rate). */
export function addTranche(p: PlayerState, amount: number, ratePct: number): void {
  const loans = tranchesOf(p).map((t) => ({ ...t }));
  const same = loans.find((t) => t.ratePct === ratePct);
  if (same) {
    same.amount += amount;
  } else {
    loans.push({ amount, ratePct });
  }
  loans.sort((a, b) => b.ratePct - a.ratePct);
  p.loans = loans;
}

/** Pays `amount` off the most expensive tranches first; drops empty tranches. */
export function repayTranches(p: PlayerState, amount: number): void {
  let left = amount;
  const loans: LoanTranche[] = [];
  for (const t of [...tranchesOf(p)].sort((a, b) => b.ratePct - a.ratePct)) {
    const paid = Math.min(left, t.amount);
    left -= paid;
    if (t.amount - paid > 0) {
      loans.push({ amount: t.amount - paid, ratePct: t.ratePct });
    }
  }
  if (loans.length === 0) {
    delete p.loans;
  } else {
    p.loans = loans;
  }
}

/** Average rate over all tranches, weighted by amount (whole percent; 0 without debt). */
export function weightedRate(p: Pick<PlayerState, "loans">): number {
  const debt = loanDebt(p);
  if (debt === 0) {
    return 0;
  }
  const weighted = tranchesOf(p).reduce((sum, t) => sum + t.amount * t.ratePct, 0);
  return Math.round(weighted / debt);
}
