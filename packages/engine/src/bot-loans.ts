// Bot behaviour in the show-off mode (docs/DESIGN.md #93). Deterministic, no RNG.
//
//   easy    never borrows.
//   normal  borrows to buy the tile that completes a colour group, or to raise a full colour set by one
//           building level; repays at the start of its turn once the cash comfortably allows.
//   hard    borrows for the completing tile too, but builds on credit only when the expected
//           extra rent per round beats the interest at its own (locked) rate; repays greedily,
//           the more so the higher the rate.
//
// No loops: a bot only borrows after rolling (await-buy / await-end-turn) and only repays before
// rolling (await-roll), so within one phase the debt moves in one direction and is bounded by the
// limit. A loan is only taken when the purchase or building it pays for happens right after.
import { at } from "./guards.ts";
import {
  buildBlockerMsg,
  buildCostFor,
  groupTiles,
  netWorth,
  ownsGroup,
  playerProperties,
  priceOf,
  propState,
  rentTableOf,
  tileDef,
} from "./helpers.ts";
import {
  LOAN_STEP,
  loanDebt,
  loanRateFor,
  loanRoom,
  loanTurn,
  loansOn,
  weightedRate,
} from "./loans.ts";
import { SKYSCRAPER_LEVEL } from "./types.ts";
import type { BotLevel, GameAction, GameState, PlayerState } from "./types.ts";

/** What a bot keeps in cash when it repays, on top of its purchase reserve. */
const REPAY_CUSHION = 100;
/** Hard bots repay down to the bare purchase reserve when their average rate is at least this. */
const HIGH_RATE = 12;
/** Chance per opponent turn to land on one particular tile (52 tiles, jail and cards ignored). */
const LANDING_CHANCE = 1 / 45;
/** Hard bots borrow to build only when the extra rent per round is this many times the interest. */
const HARD_RETURN_FACTOR = 1.25;
/** Normal bots build on credit only up to this level (three houses). */
const NORMAL_MIN_LEVEL = 2;
const NORMAL_MAX_LEVEL = 5;

export interface LoanProfile {
  /** cash that must remain after buying (the bot's purchase reserve) */
  reserve: number;
  /** cash that must remain after building (the bot's build reserve) */
  buildReserve: number;
}

const BORROWS: Record<BotLevel, boolean> = { easy: false, normal: true, hard: true };

const roundUpToStep = (n: number): number => Math.ceil(n / LOAN_STEP) * LOAN_STEP;

/** Does acquiring `tile` give `pid` the full colour group? */
function completesGroup(s: GameState, pid: string, tile: number): boolean {
  const g = tileDef(tile).group;
  if (g === undefined) {
    return false;
  }
  return groupTiles(g).every((i) => i === tile || propState(s, i).owner === pid);
}

/** Tiles of a group the player could build on right now if only the cash were there. */
function buildableTiles(s: GameState, pid: string, group: number): number[] {
  return groupTiles(group).filter((t) => {
    const why = buildBlockerMsg(s, pid, t);
    return why === null || why.key === "err.notEnoughCash";
  });
}

/** Extra rent per round when every tile in `tiles` goes up by one building level. */
function rentGainPerRound(s: GameState, me: PlayerState, tiles: number[]): number {
  const opponents = s.players.filter((p) => !p.bankrupt && p.id !== me.id).length;
  let gain = 0;
  for (const t of tiles) {
    const def = tileDef(t);
    const rent = rentTableOf(def);
    const level = propState(s, t).level;
    const now = level === 0 ? at(rent, 0) * 2 : at(rent, level);
    gain += at(rent, level + 1) - now;
  }
  return gain * opponents * LANDING_CHANCE;
}

interface BuildPlan {
  /** loan to take (multiple of LOAN_STEP, within the room) */
  amount: number;
  /** cost of raising the planned tiles by one level */
  cost: number;
  gain: number;
}

/** The best full colour set to raise by one level on credit, or null. */
function buildPlan(
  s: GameState,
  me: PlayerState,
  prof: LoanProfile,
  minLevel: number,
  maxLevel: number,
): BuildPlan | null {
  const room = loanRoom(s, me);
  if (room < LOAN_STEP) {
    return null;
  }
  // mortgages first: a bot with mortgaged land would spend the loan on lifting them
  if (playerProperties(s, me.id).some((t) => propState(s, t).mortgaged)) {
    return null;
  }
  let best: BuildPlan | null = null;
  for (let g = 0; g < 10; g++) {
    if (!ownsGroup(s, me.id, g)) {
      continue;
    }
    const tiles = buildableTiles(s, me.id, g).filter((t) => {
      const level = propState(s, t).level;
      return level >= minLevel && level < maxLevel;
    });
    if (tiles.length === 0) {
      continue;
    }
    const cost = tiles.reduce(
      (sum, t) => sum + buildCostFor(tileDef(t), propState(s, t).level + 1),
      0,
    );
    const first = Math.min(
      ...tiles.map((t) => buildCostFor(tileDef(t), propState(s, t).level + 1)),
    );
    const need = cost + prof.buildReserve - me.cash;
    const needFirst = first + prof.buildReserve - me.cash;
    if (needFirst <= 0) {
      // the bot can build without a loan
      return null;
    }
    const amount = Math.min(roundUpToStep(need), Math.floor(room / LOAN_STEP) * LOAN_STEP);
    if (amount < needFirst) {
      continue;
    }
    const gain = rentGainPerRound(s, me, tiles);
    if (!best || gain / cost > best.gain / best.cost) {
      best = { amount, cost, gain };
    }
  }
  return best;
}

/** After rolling: a loan that pays for the completing tile or for building, or null. */
export function borrowAction(s: GameState, me: PlayerState, prof: LoanProfile): GameAction | null {
  if (!loansOn(s) || !BORROWS[me.botLevel] || !loanTurn(s, me.id)) {
    return null;
  }
  const ph = s.phase;
  const room = loanRoom(s, me);
  if (ph.type === "await-buy") {
    const price = priceOf(tileDef(ph.tile));
    if (me.cash >= price || !completesGroup(s, me.id, ph.tile)) {
      return null;
    }
    const amount = roundUpToStep(price - me.cash);
    return amount <= room ? { type: "take-loan", amount } : null;
  }
  if (ph.type !== "await-end-turn") {
    return null;
  }
  // normal bots: one loan at a time, and only up to the third house (where the rent jumps most)
  if (me.botLevel === "normal" && loanDebt(me) > 0) {
    return null;
  }
  const plan = buildPlan(
    s,
    me,
    prof,
    me.botLevel === "normal" ? NORMAL_MIN_LEVEL : 0,
    me.botLevel === "normal" ? NORMAL_MAX_LEVEL : SKYSCRAPER_LEVEL,
  );
  if (!plan) {
    return null;
  }
  if (me.botLevel === "hard") {
    const rate = loanRateFor(s, me.id, netWorth);
    const interest = Math.ceil((plan.amount * rate) / 100);
    if (plan.gain < interest * HARD_RETURN_FACTOR) {
      return null;
    }
  }
  return { type: "take-loan", amount: plan.amount };
}

/** Before rolling: pay back what the cash comfortably allows, or null. */
export function repayAction(s: GameState, me: PlayerState, prof: LoanProfile): GameAction | null {
  const debt = loanDebt(me);
  if (debt === 0 || !loanTurn(s, me.id) || s.phase.type !== "await-roll") {
    return null;
  }
  const cushion =
    me.botLevel === "hard" && weightedRate(me) >= HIGH_RATE
      ? prof.reserve
      : prof.reserve + REPAY_CUSHION;
  const spare = Math.floor((me.cash - cushion) / LOAN_STEP) * LOAN_STEP;
  const amount = Math.min(debt, spare);
  return amount >= LOAN_STEP ? { type: "repay-loan", amount } : null;
}
