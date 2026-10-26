// Dividend display of the securities panel (docs/DESIGN.md #83). Pure helpers: the rules and the
// numbers come from the engine, so the panel can never disagree with what the server pays.
import {
  DIVIDEND_DECAY_START_ROUND,
  dividendDecayPercent,
  dividendFloorRound,
  dividendsOn,
  expectedDividend,
} from "@poly/engine";
import type { GameState, Lang, PlayerState } from "@poly/engine";
import { formatPercent } from "../i18n/format.ts";
import { translate } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";

/** "Dividende 2,2 % pro Runde" for a yield in permille of the price, or "keine Dividende". */
export function yieldPermilleText(permille: number, lang: Lang = getLang()): string {
  return permille > 0
    ? translate(lang, "sec.yield", { pct: formatPercent(permille / 10, lang) })
    : translate(lang, "sec.yield.none");
}

export interface DividendSummary {
  /** dividends are paid in this game */
  on: boolean;
  /** what the player's holdings pay at the next round end (regular dividend, no special event) */
  next: number;
  /** received so far */
  total: number;
}

export function dividendSummary(state: GameState, me: PlayerState): DividendSummary {
  if (!dividendsOn(state)) {
    return { on: false, next: 0, total: 0 };
  }
  return { on: true, next: expectedDividend(state, me.id), total: me.dividends ?? 0 };
}

/**
 * The decay note of the dividends (docs/DESIGN.md #85), round-aware: announced before the decay
 * ("sinkt ab Runde 20"), the remaining share while it falls, "ausgelaufen" at the end; "" when off.
 */
export function decayHint(state: GameState, lang: Lang = getLang()): string {
  if (!dividendsOn(state)) {
    return "";
  }
  const last = dividendFloorRound() - 1;
  if (state.round >= dividendFloorRound()) {
    return translate(lang, "sec.div.ended");
  }
  return state.round <= DIVIDEND_DECAY_START_ROUND
    ? translate(lang, "sec.div.decay", { round: DIVIDEND_DECAY_START_ROUND, last })
    : translate(lang, "sec.div.decaying", { pct: dividendDecayPercent(state.round), last });
}
