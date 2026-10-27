// Deterministic bots. No Math.random: variation comes from hashing state values.
import { at } from "./guards.ts";
import {
  JAIL_FINE,
  groupIndexOf,
  mortgageOf,
  priceOf,
  propState,
  tileDef,
  UNMORTGAGE_INTEREST,
  buildBlocker,
  buildCostFor,
  getPlayer,
  groupTiles,
  liquidationValue,
  mortgageBlocker,
  ownsGroup,
  playerProperties,
  sellBlocker,
  unmortgageBlocker,
  unmortgageCost,
} from "./helpers.ts";
import { borrowAction, repayAction } from "./bot-loans.ts";
import { debtSecuritiesAction, turnSecuritiesAction } from "./bot-securities.ts";
import { hash01 } from "./rng.ts";
import { tradeProblem } from "./trade-rules.ts";
import { MAX_COUNTERS } from "./types.ts";
import type {
  BotLevel,
  GameAction,
  GameState,
  PlayerId,
  PlayerState,
  Trade,
  TradeOffer,
} from "./types.ts";

interface Profile {
  /** cash that must remain after buying */
  reserve: number;
  /** cash that must remain after building */
  buildReserve: number;
  /** auction: fraction of price the bot is willing to pay */
  bidFactor: number;
  /** auction: factor if the tile completes / blocks a group */
  monoBidFactor: number;
  /** probability (hash based) to skip a non-essential purchase */
  skipBuy: number;
  trades: boolean;
  /** multiple of price offered for the missing colour-set tile */
  tradeOffer: number;
  /** minimal relative gain needed to accept a trade */
  acceptGain: number;
  /**
   * counteroffers: an offer short of the acceptance threshold by at most this share of what the bot
   * gives up is answered with a counteroffer instead of a refusal (0 = never counters)
   */
  counterWindow: number;
  /** probability (deterministic, derived from the game RNG) to counter a close offer */
  counterChance: number;
  payJailEarly: boolean;
  /** extra value (x price) when handing a rival the last tile of a group */
  blockPenalty: number;
  /** price demanded (x price of the whole colour group) for handing a rival a complete group; 0 = does not look */
  denial: number;
}

const PROFILES: Readonly<Record<BotLevel, Readonly<Profile>>> = {
  easy: {
    reserve: 250,
    buildReserve: 450,
    bidFactor: 0.8,
    monoBidFactor: 1.2,
    skipBuy: 0.25,
    trades: false,
    tradeOffer: 0,
    acceptGain: 0,
    counterWindow: 0,
    counterChance: 0,
    payJailEarly: false,
    blockPenalty: 0.2,
    denial: 0,
  },
  normal: {
    reserve: 150,
    buildReserve: 250,
    bidFactor: 1.0,
    monoBidFactor: 1.5,
    skipBuy: 0,
    trades: true,
    tradeOffer: 1.6,
    acceptGain: 0.05,
    counterWindow: 0.1,
    counterChance: 0.4,
    payJailEarly: false,
    blockPenalty: 0.3,
    denial: 0,
  },
  hard: {
    reserve: 100,
    buildReserve: 150,
    bidFactor: 1.15,
    monoBidFactor: 1.8,
    skipBuy: 0,
    trades: true,
    tradeOffer: 2.0,
    acceptGain: 0.1,
    counterWindow: 0.25,
    counterChance: 0.8,
    payJailEarly: true,
    blockPenalty: 0.6,
    denial: 0.3,
  },
};

const TRADE_COOLDOWN_VERSIONS = 80;
/** securities: cash a bot keeps on top of its build reserve before it invests */
const SECURITIES_EXTRA_RESERVE = 400;

function ownedOthersInGroup(s: GameState, pid: PlayerId, tile: number): number {
  const g = tileDef(tile).group;
  if (g === undefined) {
    return 0;
  }
  return groupTiles(g).filter((i) => i !== tile && propState(s, i).owner === pid).length;
}

/** Does acquiring `tile` give `pid` the full colour group? */
function completesGroup(s: GameState, pid: PlayerId, tile: number): boolean {
  const g = tileDef(tile).group;
  if (g === undefined) {
    return false;
  }
  return groupTiles(g).every((i) => i === tile || propState(s, i).owner === pid);
}

/** Would some other single player complete the group with this tile? */
function blocksOpponent(s: GameState, pid: PlayerId, tile: number): boolean {
  const g = tileDef(tile).group;
  if (g === undefined) {
    return false;
  }
  const others = groupTiles(g).filter((i) => i !== tile);
  const owner = propState(s, at(others, 0)).owner;
  return !!owner && owner !== pid && others.every((i) => propState(s, i).owner === owner);
}

function wantValue(s: GameState, pid: PlayerId, tile: number): number {
  const def = tileDef(tile);
  let v = priceOf(def);
  if (def.kind === "street") {
    if (completesGroup(s, pid, tile)) {
      v += priceOf(def) * 1.5;
    } else {
      v += priceOf(def) * 0.2 * ownedOthersInGroup(s, pid, tile);
    }
  } else {
    const kind = def.kind;
    const mine = playerProperties(s, pid).filter((i) => tileDef(i).kind === kind).length;
    v += priceOf(def) * 0.25 * mine;
  }
  if (propState(s, tile).mortgaged) {
    v -= (def.mortgage ?? 0) * UNMORTGAGE_INTEREST;
  }
  return v;
}

function giveValue(s: GameState, pid: PlayerId, to: PlayerId, tile: number, prof: Profile): number {
  const def = tileDef(tile);
  let v = priceOf(def);
  if (def.kind === "street") {
    const mine = ownedOthersInGroup(s, pid, tile);
    v += priceOf(def) * 0.4 * mine;
    if (ownsGroup(s, pid, groupIndexOf(def))) {
      v += priceOf(def) * 3;
    }
    if (completesGroup(s, to, tile)) {
      v += priceOf(def) * prof.blockPenalty;
    }
  }
  if (propState(s, tile).mortgaged) {
    v -= (def.mortgage ?? 0) * UNMORTGAGE_INTEREST;
  }
  return v;
}

interface TradeWorth {
  /** what the bot gets, in its own valuation */
  received: number;
  /** what the bot gives up, in its own valuation */
  given: number;
  /** extra price demanded for handing a rival a complete colour group (hard bots) */
  denial: number;
}

/** Price of the full colour set a trade would hand `to`: share of the whole group's price. */
function denialValue(s: GameState, to: PlayerId, tiles: number[], prof: Profile): number {
  if (prof.denial <= 0) {
    return 0;
  }
  let v = 0;
  for (const tile of tiles) {
    const g = tileDef(tile).group;
    if (g !== undefined && completesGroup(s, to, tile)) {
      v += groupTiles(g).reduce((a, i) => a + priceOf(tileDef(i)), 0) * prof.denial;
    }
  }
  return v;
}

function tradeWorth(s: GameState, me: PlayerState, t: Trade, prof: Profile): TradeWorth {
  const jail = 40;
  let received = t.giveCash + t.giveJailCards * jail;
  for (const i of t.giveTiles) {
    received += wantValue(s, me.id, i);
  }
  let given = t.wantCash + t.wantJailCards * jail;
  for (const i of t.wantTiles) {
    given += giveValue(s, me.id, t.from, i, prof);
  }
  return { received, given, denial: denialValue(s, t.from, t.wantTiles, prof) };
}

function evaluateTrade(s: GameState, me: PlayerState, t: Trade, prof: Profile): boolean {
  if (me.cash - t.wantCash + t.giveCash < 0) {
    return false;
  }
  const from = getPlayer(s, t.from);
  if (!from || from.bankrupt || from.cash + t.wantCash - t.giveCash < 0) {
    return false;
  }
  const w = tradeWorth(s, me, t, prof);
  const received = w.received;
  const given = w.given + w.denial;
  const gain = received - given;
  if (gain < 0) {
    return false;
  }
  if (gain === 0 && given === 0) {
    return false;
  }
  return gain >= prof.acceptGain * Math.max(given, 1);
}

/**
 * A counteroffer for an offer that is close to, but below, what the bot would accept: the same
 * items back to the proposer, with the cash raised just enough to reach the acceptance threshold.
 * Null when the offer is not close, the chain is exhausted, the dice (game RNG) say no, or the
 * counter would not be valid.
 */
function counterFor(s: GameState, me: PlayerState, t: Trade, prof: Profile): TradeOffer | null {
  if (prof.counterWindow <= 0 || (t.counterDepth ?? 0) >= MAX_COUNTERS) {
    return null;
  }
  const { received, given, denial } = tradeWorth(s, me, t, prof);
  if (given <= 0) {
    return null;
  }
  const base = given * (1 + prof.acceptGain) - received;
  if (base <= 0 && denial <= 0) {
    return null;
  }
  if (base > prof.counterWindow * given) {
    return null;
  }
  const shortfall = base + denial * (1 + prof.acceptGain);
  if (shortfall <= 0) {
    return null;
  }
  if (hash01(s.rng, s.version, me.id, t.id) >= prof.counterChance) {
    return null;
  }
  const ask = Math.ceil(shortfall / 10) * 10;
  const net = t.giveCash - t.wantCash + ask; // cash towards the bot
  const offer: TradeOffer = {
    to: t.from,
    giveCash: Math.max(0, -net),
    giveTiles: [...t.wantTiles],
    giveJailCards: t.wantJailCards,
    wantCash: Math.max(0, net),
    wantTiles: [...t.giveTiles],
    wantJailCards: t.giveJailCards,
  };
  if (tradeProblem(s, { ...offer, from: me.id }, true)) {
    return null;
  }
  return offer;
}

export interface BotTradeOptions {
  /** false = bots only accept or refuse (the behaviour before counteroffers); for balance tests */
  counters?: boolean;
}

/** respond-trade / counter-trade actions for all pending trades addressed to the bot. */
export function chooseBotTradeResponses(
  state: GameState,
  playerId: PlayerId,
  options: BotTradeOptions = {},
): GameAction[] {
  const me = getPlayer(state, playerId);
  if (!me || me.bankrupt || state.status === "finished") {
    return [];
  }
  const prof = PROFILES[me.botLevel];
  const out: GameAction[] = [];
  for (const t of state.trades) {
    if (t.status !== "pending" || t.to !== playerId) {
      continue;
    }
    if (evaluateTrade(state, me, t, prof)) {
      out.push({ type: "respond-trade", tradeId: t.id, accept: true });
      continue;
    }
    const counter = options.counters === false ? null : counterFor(state, me, t, prof);
    out.push(
      counter
        ? { type: "counter-trade", tradeId: t.id, offer: counter }
        : { type: "respond-trade", tradeId: t.id, accept: false },
    );
  }
  return out;
}

function proposeTradeFor(s: GameState, me: PlayerState, prof: Profile): TradeOffer | null {
  if (!prof.trades) {
    return null;
  }
  const myTrades = s.trades.filter((t) => t.from === me.id);
  if (myTrades.some((t) => t.status === "pending")) {
    return null;
  }
  const lastVersion = myTrades.reduce((m, t) => Math.max(m, Number(t.id.slice(1)) || 0), 0);
  if (lastVersion > 0 && s.version - lastVersion < TRADE_COOLDOWN_VERSIONS) {
    return null;
  }
  let best: { tile: number; owner: PlayerId; price: number } | null = null;
  for (let g = 0; g < 10; g++) {
    const tiles = groupTiles(g);
    const mine = tiles.filter((i) => propState(s, i).owner === me.id);
    if (mine.length !== tiles.length - 1) {
      continue;
    }
    const missing = tiles.find((i) => propState(s, i).owner !== me.id);
    if (missing === undefined) {
      continue;
    }
    const owner = propState(s, missing).owner;
    if (!owner) {
      continue;
    }
    const op = getPlayer(s, owner);
    if (!op || op.bankrupt) {
      continue;
    }
    const price = priceOf(tileDef(missing));
    if (!best || price > best.price) {
      best = { tile: missing, owner, price };
    }
  }
  if (!best) {
    return null;
  }
  const offer = Math.round((best.price * prof.tradeOffer) / 10) * 10;
  if (me.cash - offer < prof.reserve) {
    return null;
  }
  return {
    to: best.owner,
    giveCash: offer,
    giveTiles: [],
    giveJailCards: 0,
    wantCash: 0,
    wantTiles: [best.tile],
    wantJailCards: 0,
  };
}

function step(price: number): number {
  return Math.max(10, Math.round(price / 100) * 10);
}

function auctionAction(s: GameState, me: PlayerState, prof: Profile): GameAction {
  const ph = s.phase;
  if (ph.type !== "auction") {
    return { type: "pass-auction" };
  }
  const a = ph.auction;
  const def = tileDef(a.tile);
  const price = priceOf(def);
  const special = completesGroup(s, me.id, a.tile) || blocksOpponent(s, me.id, a.tile);
  const value = Math.floor(price * (special ? prof.monoBidFactor : prof.bidFactor));
  const cap = Math.min(value, me.cash - (special ? 0 : Math.floor(prof.reserve / 2)));
  const st = step(price);
  const next =
    a.highestBid === 0 ? Math.max(st, Math.floor((price * 0.3) / 10) * 10) : a.highestBid + st;
  if (next <= cap && next <= me.cash) {
    return { type: "bid", amount: next };
  }
  return { type: "pass-auction" };
}

function debtAction(s: GameState, me: PlayerState): GameAction {
  const ph = s.phase;
  if (ph.type !== "debt") {
    return { type: "declare-bankruptcy" };
  }
  if (liquidationValue(s, me.id) < ph.amount) {
    return { type: "declare-bankruptcy" };
  }
  // securities first: liquid and no lasting damage (locked lots only lose the emergency discount)
  const sale = debtSecuritiesAction(s, me);
  if (sale) {
    return sale;
  }
  const props = playerProperties(s, me.id);
  const mortgageable = props
    .filter((t) => mortgageBlocker(s, me.id, t) === null)
    .sort((a, b) => {
      const ga = tileDef(a).group;
      const gb = tileDef(b).group;
      const ma = ga !== undefined && ownsGroup(s, me.id, ga) ? 1 : 0;
      const mb = gb !== undefined && ownsGroup(s, me.id, gb) ? 1 : 0;
      return ma - mb || mortgageOf(tileDef(b)) - mortgageOf(tileDef(a)) || a - b;
    });
  // mortgage unimproved property first, then dismantle buildings
  if (mortgageable.length > 0) {
    return { type: "mortgage", tile: at(mortgageable, 0) };
  }
  const sellable = props
    .filter((t) => sellBlocker(s, me.id, t) === null)
    .sort((a, b) => propState(s, b).level - propState(s, a).level || a - b);
  if (sellable.length > 0) {
    return { type: "sell-building", tile: at(sellable, 0) };
  }
  return { type: "declare-bankruptcy" };
}

/** A legal action for `playerId`, or null if the player does not have to act. */
export function chooseBotAction(state: GameState, playerId: PlayerId): GameAction | null {
  if (state.status === "finished") {
    return null;
  }
  const me = getPlayer(state, playerId);
  if (!me || me.bankrupt) {
    return null;
  }
  const prof = PROFILES[me.botLevel];
  const ph = state.phase;
  const isCur = at(state.players, state.current).id === playerId;

  switch (ph.type) {
    case "auction":
      return ph.auction.turn === playerId ? auctionAction(state, me, prof) : null;
    case "debt":
      return ph.debtor === playerId ? debtAction(state, me) : null;
    case "await-roll": {
      if (!isCur) {
        return null;
      }
      // show-off mode: pay loans back before rolling when the cash allows
      const repay = repayAction(state, me, prof);
      if (repay) {
        return repay;
      }
      if (me.inJail) {
        if (me.jailCards.length > 0) {
          return { type: "use-jail-card" };
        }
        const spare = me.cash - JAIL_FINE;
        if (
          spare >= (prof.payJailEarly ? prof.reserve : prof.reserve * 3) &&
          (prof.payJailEarly || state.round <= 25)
        ) {
          return { type: "pay-jail-fine" };
        }
      }
      return { type: "roll" };
    }
    case "await-buy": {
      if (!isCur) {
        return null;
      }
      const price = priceOf(tileDef(ph.tile));
      if (me.cash < price) {
        // show-off mode: borrow for the tile that completes a colour group
        return borrowAction(state, me, prof) ?? { type: "decline-buy" };
      }
      const key = completesGroup(state, me.id, ph.tile) || blocksOpponent(state, me.id, ph.tile);
      if (key && me.cash - price >= 0) {
        return { type: "buy" };
      }
      if (me.cash - price < prof.reserve) {
        return { type: "decline-buy" };
      }
      if (prof.skipBuy > 0 && hash01(state.rng, state.version, playerId, ph.tile) < prof.skipBuy) {
        return { type: "decline-buy" };
      }
      return { type: "buy" };
    }
    case "await-end-turn": {
      if (!isCur) {
        return null;
      }
      const props = playerProperties(state, playerId);
      // 1. repay mortgages when comfortable
      const unm = props
        .filter((t) => unmortgageBlocker(state, playerId, t) === null)
        .filter((t) => me.cash - unmortgageCost(tileDef(t)) >= prof.buildReserve)
        .sort((a, b) => priceOf(tileDef(b)) - priceOf(tileDef(a)));
      if (unm.length > 0) {
        return { type: "unmortgage", tile: at(unm, 0) };
      }
      // 2. build
      const builds = props
        .filter((t) => buildBlocker(state, playerId, t) === null)
        .filter(
          (t) =>
            me.cash - buildCostFor(tileDef(t), propState(state, t).level + 1) >= prof.buildReserve,
        )
        .sort(
          (a, b) =>
            propState(state, a).level - propState(state, b).level ||
            priceOf(tileDef(b)) - priceOf(tileDef(a)) ||
            a - b,
        );
      if (builds.length > 0) {
        return { type: "build", tile: at(builds, 0) };
      }
      // 2b. show-off mode: borrow to build on a full colour set (the builds follow in the next steps)
      const loan = borrowAction(state, me, prof);
      if (loan) {
        return loan;
      }
      // 3. securities mode: take profits, invest part of the surplus
      const securities = turnSecuritiesAction(
        state,
        me,
        prof.buildReserve + SECURITIES_EXTRA_RESERVE,
        prof.reserve,
      );
      if (securities) {
        return securities;
      }
      // 4. try to complete a colour set by trading
      const offer = proposeTradeFor(state, me, prof);
      if (offer) {
        return { type: "propose-trade", offer };
      }
      return ph.canRollAgain ? { type: "roll" } : { type: "end-turn" };
    }
    case "game-over":
      return null;
  }
}
