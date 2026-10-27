// Show-off mode (Protzmodus, docs/DESIGN.md #93): what the loan dialog and the player card show.
// Pure helpers; every number and rule comes from the engine (loans.ts), so the dialog can never
// disagree with what the server accepts.
import {
  LOAN_RATE_CURVE,
  LOAN_STEP,
  getTheme,
  interestDue,
  loanDebt,
  loanLimit,
  loanRateFor,
  loanRoom,
  loanTurn,
  netWorth,
  themeText,
  tranchesOf,
  weightedRate,
} from "@poly/engine";
import type { GameState, Lang, LoanTranche, PlayerState } from "@poly/engine";
import { formatMoney } from "../i18n/format.ts";
import { translate } from "../i18n/index.ts";

export interface LoanView {
  /** open debt and its tranches (most expensive first) */
  debt: number;
  tranches: LoanTranche[];
  /** interest due at the start of the player's next turn */
  due: number;
  limit: number;
  /** what may still be borrowed */
  room: number;
  /** the rate the bank would lock for a new loan now (whole percent per round) */
  ratePct: number;
  /** average rate of the open tranches (0 without debt) */
  averagePct: number;
  /** own turn and nothing pending: taking and repaying are allowed */
  turnOk: boolean;
  /** most the player can repay right now (multiple of the step, bounded by cash and debt) */
  maxRepay: number;
  step: number;
}

export function loanView(state: GameState, me: PlayerState): LoanView {
  const debt = loanDebt(me);
  return {
    debt,
    tranches: tranchesOf(me),
    due: interestDue(me),
    limit: loanLimit(state),
    room: loanRoom(state, me),
    ratePct: loanRateFor(state, me.id, netWorth),
    averagePct: weightedRate(me),
    turnOk: loanTurn(state, me.id),
    maxRepay: Math.min(debt, Math.floor(Math.max(0, me.cash) / LOAN_STEP) * LOAN_STEP),
    step: LOAN_STEP,
  };
}

/** Keeps a stepper value on the step grid within [step, max] (max < step: nothing possible -> 0). */
export function clampAmount(value: number, max: number, step: number = LOAN_STEP): number {
  if (max < step) {
    return 0;
  }
  const onGrid = Math.round(value / step) * step;
  return Math.min(Math.floor(max / step) * step, Math.max(step, onGrid));
}

/** "Der Privatbankier am Paradeplatz leiht dir bis zu CHF 1'000. Hauptsache, du siehst reich aus." */
export function lenderText(state: GameState, room: number, lang: Lang): string {
  const theme = getTheme(state.settings.themeId);
  return translate(lang, "loan.lender", {
    lender: themeText(theme, lang).lender,
    room: formatMoney(theme, room, lang),
  });
}

/** "Die Bank verlangt von dir 8 % pro Runde." */
export function rateText(ratePct: number, lang: Lang): string {
  return translate(lang, "loan.rate", { pct: ratePct });
}

/** "Der Satz hängt von deinem Vermögen ab: 4 % für die Ärmsten, 25 % für die Reichsten ..." */
export function rateNote(lang: Lang): string {
  return translate(lang, "loan.rateNote", {
    min: LOAN_RATE_CURVE.poorest,
    max: LOAN_RATE_CURVE.richest,
  });
}

/** Player card line "Kredit CHF 300 · 8 %", or null without debt. */
export function loanBadge(state: GameState, p: PlayerState, lang: Lang): string | null {
  const debt = loanDebt(p);
  if (debt === 0) {
    return null;
  }
  return translate(lang, "player.loan", {
    amount: formatMoney(getTheme(state.settings.themeId), debt, lang),
    pct: weightedRate(p),
  });
}
