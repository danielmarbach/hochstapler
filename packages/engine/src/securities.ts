// Securities mode "Wertpapiere" (docs/DESIGN.md #40, #48). Pure rules: price model, lock-up,
// emergency sale and portfolio helpers. game.ts wires them into the turn flow (round-end hook,
// actions, bankruptcy); helpers.ts adds the holdings to the net worth.
//
// PRICE MODEL (one update at every round end, deterministic from `state.rng`):
//   change = noise + mean reversion + coupling             (all in permille of the price)
//   noise     = volatility% * (0.6 * sector shock + 0.4 * company shock), shocks triangular in (-1, 1)
//   reversion = 5 % of the distance to the start price (keeps prices from running away)
//   coupling  = small, capped effects of what happened in the game since the last update
//               (see `couplingPermille`)
// With a probability of 5 % per round a headline hits one company's sector: the whole sector
// moves by +-15..35 % (boom/crash) instead of the random walk. Prices are integers >= 1.
import { defined } from "./guards.ts";
import { makeMsg } from "./i18n/index.ts";
import type { EngineMsg } from "./i18n/index.ts";
import { nextRandom, randInt } from "./rng.ts";
import { getTheme } from "./themes/index.ts";
import type { SecurityDef } from "./theme-types.ts";
import type {
  GameState,
  Holding,
  Market,
  MarketActivity,
  MarketHeadline,
  PlayerState,
  SecuritySector,
} from "./types.ts";

export const SECURITY_SECTORS = [
  "tourism",
  "food",
  "rail",
  "bank",
  "energy",
  "tech",
  "realestate",
] as const satisfies readonly SecuritySector[];

export const MIN_LOCK_ROUNDS = 1;
export const MAX_LOCK_ROUNDS = 10;
/** A locked lot sold in debt yields this much less than its market value. */
export const EMERGENCY_DISCOUNT_PERCENT = 20;
/** Prices kept per security (newest last). */
export const HISTORY_LENGTH = 20;
/** One player may hold at most this many shares of a single security. */
export const MAX_SHARES_PER_SECURITY = 100;
/** Open lots per player when buying (bankruptcy transfers may exceed it). */
export const MAX_LOTS = 40;
export const MAX_PRICE = 5000;

/** Probability of a headline per round, in permille. */
export const HEADLINE_CHANCE_PERMILLE = 50;
export const HEADLINE_MIN_PCT = 15;
export const HEADLINE_MAX_PCT = 35;
/** Share of the distance to the start price that is closed per round, in percent. */
const REVERSION_PERCENT = 5;
/** Weight of the sector-wide shock in the noise (the rest is company specific). */
const SECTOR_WEIGHT = 0.6;
const MAX_FALL_PERMILLE = -700;
const MAX_RISE_PERMILLE = 1000;
/** A move of at least this size changes even a tiny price by one point. */
const MIN_VISIBLE_MOVE_PERMILLE = 20;

// coupling to the game (permille per event, each effect capped by COUPLING_CAP_PERMILLE)
const COUPLING_CAP_PERMILLE = 60;
const BANKRUPTCY_CAP_PERMILLE = 200;
const TOURISM_PER_SCENIC_BUILD = 15;
const REALESTATE_PER_BUILD = 8;
/** every RENT_STEP of rent paid lifts real estate by REALESTATE_PER_RENT_STEP */
const RENT_STEP = 50;
const REALESTATE_PER_RENT_STEP = 5;
const RAIL_PER_STATION_RENT = 20;
const ENERGY_PER_UTILITY_RENT = 20;
const BANK_PER_BANKRUPTCY = -80;

export type HeadlineKind = MarketHeadline["kind"];
type HeadlineKey =
  | "log.headline.boom.tourism"
  | "log.headline.crash.tourism"
  | "log.headline.boom.food"
  | "log.headline.crash.food"
  | "log.headline.boom.rail"
  | "log.headline.crash.rail"
  | "log.headline.boom.bank"
  | "log.headline.crash.bank"
  | "log.headline.boom.energy"
  | "log.headline.crash.energy"
  | "log.headline.boom.tech"
  | "log.headline.crash.tech"
  | "log.headline.boom.realestate"
  | "log.headline.crash.realestate";

/** Message key of the headline text per sector and direction (params: security, pct). */
export const HEADLINE_KEYS: Record<SecuritySector, Record<HeadlineKind, HeadlineKey>> = {
  tourism: { boom: "log.headline.boom.tourism", crash: "log.headline.crash.tourism" },
  food: { boom: "log.headline.boom.food", crash: "log.headline.crash.food" },
  rail: { boom: "log.headline.boom.rail", crash: "log.headline.crash.rail" },
  bank: { boom: "log.headline.boom.bank", crash: "log.headline.crash.bank" },
  energy: { boom: "log.headline.boom.energy", crash: "log.headline.crash.energy" },
  tech: { boom: "log.headline.boom.tech", crash: "log.headline.crash.tech" },
  realestate: { boom: "log.headline.boom.realestate", crash: "log.headline.crash.realestate" },
};

/** The structured message of a headline (render with a `security` resolver). */
export function headlineMsg(h: MarketHeadline): EngineMsg {
  return makeMsg(HEADLINE_KEYS[h.sector][h.kind], { security: h.secId, pct: h.pct });
}

// ------------------------------------------------------------------ setup & queries

export function emptyActivity(): MarketActivity {
  return {
    builds: 0,
    scenicBuilds: 0,
    rentPaid: 0,
    stationRents: 0,
    utilityRents: 0,
    bankruptcies: 0,
  };
}

/** The market at game start: every security at its start price. */
export function initMarket(themeId: string): Market {
  const companies = getTheme(themeId).securities;
  return {
    prices: Object.fromEntries(companies.map((c) => [c.id, c.startPrice])),
    history: Object.fromEntries(companies.map((c) => [c.id, [c.startPrice]])),
    activity: emptyActivity(),
  };
}

export function securitiesOf(state: GameState): SecurityDef[] {
  return getTheme(state.settings.themeId).securities;
}

export function securityDef(state: GameState, secId: string): SecurityDef | undefined {
  return securitiesOf(state).find((c) => c.id === secId);
}

export function priceOfSecurity(state: GameState, secId: string): number {
  return state.market?.prices[secId] ?? 0;
}

export function holdingsOf(p: PlayerState): readonly Holding[] {
  return p.holdings ?? [];
}

/** Rounds until the lot may be sold normally; 0 = free. */
export function lockRoundsLeft(state: GameState, h: Holding): number {
  return Math.max(0, h.boughtRound + state.settings.securitiesLockRounds - state.round);
}

export function isLocked(state: GameState, h: Holding): boolean {
  return lockRoundsLeft(state, h) > 0;
}

/** Cash received for selling `shares` at `price`; a locked lot sold in an emergency loses the discount. */
export function saleProceeds(price: number, shares: number, emergency: boolean): number {
  const gross = price * shares;
  return emergency ? Math.floor((gross * (100 - EMERGENCY_DISCOUNT_PERCENT)) / 100) : gross;
}

/** Market value of everything the player holds (counts towards the net worth). */
export function holdingsValue(state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  return p
    ? holdingsOf(p).reduce((sum, h) => sum + priceOfSecurity(state, h.secId) * h.shares, 0)
    : 0;
}

/** What the holdings would raise in debt right now (locked lots with the discount). */
export function holdingsLiquidation(state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  return p
    ? holdingsOf(p).reduce(
        (sum, h) =>
          sum + saleProceeds(priceOfSecurity(state, h.secId), h.shares, isLocked(state, h)),
        0,
      )
    : 0;
}

/** Change of the price since the previous round in percent (0 without history). */
export function changePercent(market: Market, secId: string): number {
  const hist = market.history[secId] ?? [];
  const prev = hist.at(-2);
  const now = market.prices[secId];
  return prev === undefined || now === undefined ? 0 : ((now - prev) / prev) * 100;
}

// ------------------------------------------------------------------ rules

/** Why `p` cannot buy `shares` of `secId` now (apart from whose turn / phase), or null. */
export function buyBlocker(
  state: GameState,
  p: PlayerState,
  secId: string,
  shares: number,
): EngineMsg | null {
  if (!state.settings.securities || !state.market) {
    return makeMsg("err.secOff");
  }
  if (!securityDef(state, secId)) {
    return makeMsg("err.secUnknown");
  }
  if (!Number.isInteger(shares) || shares < 1) {
    return makeMsg("err.secShares");
  }
  const held = holdingsOf(p)
    .filter((h) => h.secId === secId)
    .reduce((sum, h) => sum + h.shares, 0);
  if (held + shares > MAX_SHARES_PER_SECURITY) {
    return makeMsg("err.secMaxShares", { max: MAX_SHARES_PER_SECURITY });
  }
  const price = priceOfSecurity(state, secId);
  if (!canMerge(state, p, secId, price) && holdingsOf(p).length >= MAX_LOTS) {
    return makeMsg("err.secTooManyLots");
  }
  if (p.cash < price * shares) {
    return makeMsg("err.notEnoughCash");
  }
  return null;
}

function canMerge(state: GameState, p: PlayerState, secId: string, price: number): boolean {
  return holdingsOf(p).some(
    (h) => h.secId === secId && h.buyPrice === price && h.boughtRound === state.round,
  );
}

/** Adds a bought lot; equal lots of the same round and price are merged. */
export function addLot(state: GameState, p: PlayerState, secId: string, shares: number): void {
  const price = priceOfSecurity(state, secId);
  const lots = (p.holdings ??= []);
  const same = lots.find(
    (h) => h.secId === secId && h.buyPrice === price && h.boughtRound === state.round,
  );
  if (same) {
    same.shares += shares;
  } else {
    lots.push({ secId, shares, buyPrice: price, boughtRound: state.round });
  }
}

export interface SaleLot {
  index: number;
  /** a locked lot sold in debt: discounted */
  emergency: boolean;
}

export type SalePlan = { ok: true; lots: SaleLot[] } | { ok: false; msg: EngineMsg };

/**
 * Which lots a sale of `lot` (a portfolio index, or "all" lots of `secId`) touches. Outside of debt
 * only lots whose lock-up is over qualify; in debt every lot does and locked ones are discounted.
 */
export function planSale(
  state: GameState,
  p: PlayerState,
  secId: string,
  lot: number | "all",
  inDebt: boolean,
): SalePlan {
  if (!state.settings.securities || !state.market) {
    return { ok: false, msg: makeMsg("err.secOff") };
  }
  const all = holdingsOf(p);
  const candidates: number[] =
    lot === "all"
      ? all.flatMap((h, i) => (h.secId === secId ? [i] : []))
      : all[lot]?.secId === secId
        ? [lot]
        : [];
  if (candidates.length === 0) {
    return { ok: false, msg: makeMsg("err.secNoLot") };
  }
  const lots: SaleLot[] = [];
  let soonest = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const h = defined(all[index], "Position");
    const left = lockRoundsLeft(state, h);
    if (left > 0 && !inDebt) {
      soonest = Math.min(soonest, left);
    } else {
      lots.push({ index, emergency: left > 0 });
    }
  }
  if (lots.length === 0) {
    return { ok: false, msg: makeMsg("err.secLocked", { rounds: soonest }) };
  }
  return { ok: true, lots };
}

/** Is any lot of the player sellable right now (the legal-actions test)? */
export function canSellAny(state: GameState, p: PlayerState, inDebt: boolean): boolean {
  return holdingsOf(p).some((h) => planSale(state, p, h.secId, "all", inDebt).ok);
}

/** Could the player buy at least one share of some security right now (ignoring turn/phase)? */
export function canBuyAny(state: GameState, p: PlayerState): boolean {
  return securitiesOf(state).some((c) => buyBlocker(state, p, c.id, 1) === null);
}

// ------------------------------------------------------------------ the price update

/** Coupling of a sector to the game since the last update, in permille (documented above). */
export function couplingPermille(sector: SecuritySector, a: MarketActivity): number {
  const cap = (v: number): number => Math.min(v, COUPLING_CAP_PERMILLE);
  switch (sector) {
    case "tourism":
      return cap(a.scenicBuilds * TOURISM_PER_SCENIC_BUILD);
    case "realestate":
      return cap(
        Math.floor(a.rentPaid / RENT_STEP) * REALESTATE_PER_RENT_STEP +
          a.builds * REALESTATE_PER_BUILD,
      );
    case "rail":
      return cap(a.stationRents * RAIL_PER_STATION_RENT);
    case "energy":
      return cap(a.utilityRents * ENERGY_PER_UTILITY_RENT);
    case "bank":
      return Math.max(a.bankruptcies * BANK_PER_BANKRUPTCY, -BANKRUPTCY_CAP_PERMILLE);
    case "food":
    case "tech":
      return 0;
  }
}

export interface MarketStep {
  /** the market for round `state.round + 1` */
  market: Market;
  /** the rng after the draws */
  rng: number;
}

/** Triangular shock in (-1, 1): the sum of two uniform draws. */
function shock(rng: number): { rng: number; value: number } {
  const a = nextRandom(rng);
  const b = nextRandom(a.rng);
  return { rng: b.rng, value: a.value + b.value - 1 };
}

function clampPrice(price: number): number {
  return Math.min(MAX_PRICE, Math.max(1, price));
}

function applyChange(price: number, permille: number): number {
  const total = Math.min(MAX_RISE_PERMILLE, Math.max(MAX_FALL_PERMILLE, permille));
  let delta = Math.round((price * total) / 1000);
  if (delta === 0 && Math.abs(total) >= MIN_VISIBLE_MOVE_PERMILLE) {
    delta = Math.sign(total);
  }
  return clampPrice(price + delta);
}

/**
 * The market of the next round. Pure: consumes `state.rng` (returned in `rng`), never mutates.
 * The same state always yields the same result; the number of draws does not depend on the activity,
 * so a game with and without activity differs only by the coupling.
 */
export function stepMarket(state: GameState): MarketStep {
  const old = defined(state.market, "Market");
  const companies = securitiesOf(state);
  let rng = state.rng;

  const sectorShock = new Map<SecuritySector, number>();
  for (const sector of SECURITY_SECTORS) {
    const s = shock(rng);
    rng = s.rng;
    sectorShock.set(sector, s.value);
  }
  const ownShock = new Map<string, number>();
  for (const c of companies) {
    const s = shock(rng);
    rng = s.rng;
    ownShock.set(c.id, s.value);
  }

  let headline: MarketHeadline | undefined;
  const roll = nextRandom(rng);
  rng = roll.rng;
  if (roll.value * 1000 < HEADLINE_CHANCE_PERMILLE && companies.length > 0) {
    const pick = randInt(rng, companies.length);
    const dir = nextRandom(pick.rng);
    const size = randInt(dir.rng, HEADLINE_MAX_PCT - HEADLINE_MIN_PCT + 1);
    rng = size.rng;
    const company = defined(companies[pick.value], "Company");
    headline = {
      secId: company.id,
      sector: company.sector,
      kind: dir.value < 0.5 ? "boom" : "crash",
      pct: HEADLINE_MIN_PCT + size.value,
      round: state.round + 1,
    };
  }

  const prices: Record<string, number> = {};
  const history: Record<string, number[]> = {};
  for (const c of companies) {
    const price = old.prices[c.id] ?? c.startPrice;
    let permille: number;
    if (headline && headline.sector === c.sector) {
      permille = (headline.kind === "boom" ? 1 : -1) * headline.pct * 10;
    } else {
      const mix =
        SECTOR_WEIGHT * (sectorShock.get(c.sector) ?? 0) +
        (1 - SECTOR_WEIGHT) * (ownShock.get(c.id) ?? 0);
      const noise = Math.round(c.volatility * 10 * mix);
      const reversion = Math.round(
        (((c.startPrice - price) / c.startPrice) * 1000 * REVERSION_PERCENT) / 100,
      );
      permille = noise + reversion + couplingPermille(c.sector, old.activity);
    }
    const next = applyChange(price, permille);
    prices[c.id] = next;
    history[c.id] = [...(old.history[c.id] ?? [price]), next].slice(-HISTORY_LENGTH);
  }
  const market: Market = { prices, history, activity: emptyActivity() };
  if (headline) {
    market.headline = headline;
  }
  return { market, rng };
}

// ------------------------------------------------------------------ dividends

// DIVIDENDS (docs/DESIGN.md #83): paid to every non-bankrupt holder when the round counter
// increments (round end, before the price update), locked lots included.
//   dividend of a lot = floor(price * shares * yield / 1000)
//   yield (permille of the price) = base yield of the sector * factor(price / issue price)
//   factor: below 70 % of the issue price 0; 70 %..100 % rising linearly from 0.5 to 1;
//           above 100 % +0.5 per +100 % (capped at 1.5, i.e. 150 % of the issue price)
// Occasionally (DIVIDEND_EVENT_CHANCE_PERMILLE per round) one company announces a special dividend
// (+SPECIAL_DIVIDEND_PERMILLE on top, whatever the price) or suspends its dividend this round.
export const DIVIDEND_BASE_PERMILLE: Record<SecuritySector, number> = {
  energy: 30,
  rail: 25,
  realestate: 25,
  bank: 20,
  food: 20,
  tourism: 10,
  tech: 0,
};
// DECAY (docs/DESIGN.md #85): up to round DIVIDEND_DECAY_START_ROUND the yields are paid in full;
// afterwards the base yield falls by DIVIDEND_DECAY_STEP_PERCENT of itself every
// DIVIDEND_DECAY_EVERY_ROUNDS rounds (stepwise, a pure function of the round), down to 0.
// So early investment pays off but a long game is not financed by the dividends forever.
export const DIVIDEND_DECAY_START_ROUND = 20;
export const DIVIDEND_DECAY_EVERY_ROUNDS = 10;
export const DIVIDEND_DECAY_STEP_PERCENT = 20;
export const DIVIDEND_MIN_RATIO_PERCENT = 70;
const DIVIDEND_MAX_BONUS_PERCENT = 50;
export const SPECIAL_DIVIDEND_PERMILLE = 30;
export const DIVIDEND_EVENT_CHANCE_PERMILLE = 60;

/** Share of the base yield still paid in the round that ends (percent, 100 up to the start round). */
export function dividendDecayPercent(round: number): number {
  if (round <= DIVIDEND_DECAY_START_ROUND) {
    return 100;
  }
  const steps = Math.ceil((round - DIVIDEND_DECAY_START_ROUND) / DIVIDEND_DECAY_EVERY_ROUNDS);
  return Math.max(0, 100 - steps * DIVIDEND_DECAY_STEP_PERCENT);
}

/** The first round that pays no dividend any more. */
export function dividendFloorRound(): number {
  return (
    DIVIDEND_DECAY_START_ROUND +
    Math.floor((100 - 1) / DIVIDEND_DECAY_STEP_PERCENT) * DIVIDEND_DECAY_EVERY_ROUNDS +
    1
  );
}

/**
 * Yield of one round in permille of the price (an integer >= 0, at most 45); `round` is the round
 * that ends (decay, default: before any decay).
 */
export function dividendYieldPermille(
  sector: SecuritySector,
  price: number,
  issuePrice: number,
  round = 1,
): number {
  const ratio = Math.floor((price * 100) / Math.max(1, issuePrice));
  if (ratio < DIVIDEND_MIN_RATIO_PERCENT) {
    return 0;
  }
  const factor =
    ratio < 100
      ? 50 +
        Math.floor((50 * (ratio - DIVIDEND_MIN_RATIO_PERCENT)) / (100 - DIVIDEND_MIN_RATIO_PERCENT))
      : 100 + Math.min(DIVIDEND_MAX_BONUS_PERCENT, Math.floor((ratio - 100) / 2));
  return Math.floor(
    (DIVIDEND_BASE_PERMILLE[sector] * factor * dividendDecayPercent(round)) / 10000,
  );
}

/** Is the player's dividend rule active in this game? */
export function dividendsOn(state: GameState): boolean {
  return state.settings.securities && state.settings.securitiesDividends && !!state.market;
}

/** Current regular yield of a company in permille of the price (0 while dividends are off). */
export function currentYieldPermille(state: GameState, secId: string): number {
  const def = securityDef(state, secId);
  return def && dividendsOn(state)
    ? dividendYieldPermille(def.sector, priceOfSecurity(state, secId), def.startPrice, state.round)
    : 0;
}

/**
 * The yield a holder can expect on average over the next `horizon` rounds (the current price
 * assumed): the current yield scaled by the average decay of those rounds. Hard bots use it.
 */
export function anticipatedYieldPermille(state: GameState, secId: string, horizon: number): number {
  const def = securityDef(state, secId);
  if (!def || !dividendsOn(state) || horizon < 1) {
    return 0;
  }
  const price = priceOfSecurity(state, secId);
  let sum = 0;
  for (let r = state.round; r < state.round + horizon; r++) {
    sum += dividendYieldPermille(def.sector, price, def.startPrice, r);
  }
  return Math.floor(sum / horizon);
}

export type DividendEventKind = "special" | "suspended";
export interface DividendEvent {
  secId: string;
  kind: DividendEventKind;
}

export interface DividendPart {
  secId: string;
  amount: number;
}

/** What the player's holdings pay this round (optionally with an event); only non-zero parts. */
export function dividendFor(
  state: GameState,
  p: PlayerState,
  event?: DividendEvent,
): { total: number; parts: DividendPart[] } {
  const perSec = new Map<string, number>();
  if (dividendsOn(state)) {
    for (const h of holdingsOf(p)) {
      const def = securityDef(state, h.secId);
      if (!def) {
        continue;
      }
      let y = currentYieldPermille(state, h.secId);
      if (event?.secId === h.secId) {
        y =
          event.kind === "suspended"
            ? 0
            : y + Math.floor((SPECIAL_DIVIDEND_PERMILLE * dividendDecayPercent(state.round)) / 100);
      }
      const amount = Math.floor((priceOfSecurity(state, h.secId) * h.shares * y) / 1000);
      if (amount > 0) {
        perSec.set(h.secId, (perSec.get(h.secId) ?? 0) + amount);
      }
    }
  }
  const parts = [...perSec].map(([secId, amount]) => ({ secId, amount }));
  return { total: parts.reduce((sum, x) => sum + x.amount, 0), parts };
}

/** The regular dividend (no event) the player would receive at the next round end. */
export function expectedDividend(state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  return p && !p.bankrupt ? dividendFor(state, p).total : 0;
}

/** Draws the event of this round end (consumes the rng only when dividends are on). */
export function drawDividendEvent(state: GameState): { rng: number; event?: DividendEvent } {
  const companies = securitiesOf(state);
  if (!dividendsOn(state) || companies.length === 0) {
    return { rng: state.rng };
  }
  const roll = nextRandom(state.rng);
  if (roll.value * 1000 >= DIVIDEND_EVENT_CHANCE_PERMILLE) {
    return { rng: roll.rng };
  }
  const pick = randInt(roll.rng, companies.length);
  const dir = nextRandom(pick.rng);
  return {
    rng: dir.rng,
    event: {
      secId: defined(companies[pick.value], "Company").id,
      kind: dir.value < 0.5 ? "special" : "suspended",
    },
  };
}

// ------------------------------------------------------------------ bankruptcy

/** Moves every lot of `from` to `to` (a creditor); lock-up and buy price stay. */
export function transferHoldings(from: PlayerState, to: PlayerState): void {
  const lots = holdingsOf(from);
  if (lots.length > 0) {
    to.holdings = [...holdingsOf(to), ...lots];
  }
  delete from.holdings;
}
