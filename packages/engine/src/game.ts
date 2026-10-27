// Rules engine. All exported functions are pure: they clone the input state and never mutate it.
import { BOARD } from "./board.ts";
import { at, defined } from "./guards.ts";
import { formatMessage, groupDigits, makeMsg } from "./i18n/index.ts";
import type { EngineMsgKey, MsgArgs, MsgResolver } from "./i18n/index.ts";
import { CARDS } from "./cards.ts";
import type { CardDef } from "./cards.ts";
import {
  JAIL_FINE,
  mortgageOf,
  priceOf,
  propState,
  tileDef,
  buildBlockerMsg,
  buildCostFor,
  maxBid,
  getPlayer,
  mortgageBlockerMsg,
  playerProperties,
  rankPlayers,
  rentFor,
  sellBlockerMsg,
  sellValue,
  unmortgageBlockerMsg,
  unmortgageCost,
  isBuyable,
  netWorth,
} from "./helpers.ts";
import { rollDie, shuffle } from "./rng.ts";
import type { PublicGameState } from "./protocol.ts";
import { chooseBotAction } from "./bot.ts";
import { mortgageInterest, tradeProblem } from "./trade-rules.ts";
import {
  HEADLINE_KEYS,
  addLot,
  buyBlocker,
  canBuyAny,
  canSellAny,
  dividendFor,
  dividendsOn,
  drawDividendEvent,
  holdingsOf,
  initMarket,
  planSale,
  priceOfSecurity,
  saleProceeds,
  stepMarket,
  transferHoldings,
} from "./securities.ts";
import {
  addTranche,
  interestDue,
  loanDebt,
  loanRateFor,
  loanRoom,
  LOAN_STEP,
  repayLoanBlocker,
  repayTranches,
  takeLoanBlocker,
} from "./loans.ts";
import { getTheme } from "./themes/index.ts";
import {
  AUTO_BID_STEP,
  BOARD_SIZE,
  DEFAULT_SETTINGS,
  END_VOTE_COOLDOWN_ROUNDS,
  GameError,
  HOTEL_LEVEL,
  JAIL_INDEX,
  MAX_COUNTERS,
  SKYSCRAPER_LEVEL,
} from "./types.ts";
import type {
  ApplyResult,
  Auction,
  BuildingLevel,
  CashReason,
  Controller,
  GameAction,
  GameEvent,
  GameOverReason,
  GameSettings,
  GameState,
  MarketActivity,
  NewPlayer,
  PlayerId,
  PlayerState,
  PropertyState,
  Trade,
  TradeOffer,
} from "./types.ts";

const MAX_LOG = 200;
const MAX_FINISHED_TRADES = 20;
const MAX_JAIL_TURNS = 3;
const DOUBLES_TO_JAIL = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MS_PER_SEC = 1000;
/** dice total assumed for dice-based rent when no dice were rolled yet */
const FALLBACK_DICE_TOTAL = 7;
/** safety bound on timeout-driven iterations (bot catch-up loops) */
const MAX_TIMEOUT_ROUNDS = 3000;
const MAX_BOT_STEPS_PER_ROUND = 600;
/** safety bound for auto-bid resolution; real auctions need far fewer (maximums / step) */
const MAX_AUTO_BID_ROUNDS = 100_000;

interface Ctx {
  s: GameState;
  ev: GameEvent[];
  now: number;
}

const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

// ------------------------------------------------------------------ small utils

const cur = (c: Ctx): PlayerState => at(c.s.players, c.s.current);
const player = (c: Ctx, id: PlayerId): PlayerState => {
  const p = c.s.players.find((x) => x.id === id);
  if (!p) {
    throw GameError.of("err.unknownPlayer");
  }
  return p;
};
const emit = (c: Ctx, e: GameEvent) => void c.ev.push(e);
const tileName = (i: number) => `Feld ${i}`;
/** Resolver for the German fallback text stored next to every structured log message. */
const legacyResolver = (s: GameState): MsgResolver => ({
  player: (id) => s.players.find((x) => x.id === id)?.name ?? id,
  tile: tileName,
  money: groupDigits,
  security: (id) => getTheme(s.settings.themeId).securities.find((x) => x.id === id)?.name ?? id,
});
/** Appends a log entry: structured `msg` plus the German rendering as `text`. */
const log = <K extends EngineMsgKey>(c: Ctx, key: K, ...args: MsgArgs<K>): void => {
  const msg = makeMsg(key, ...args);
  c.s.log.push({ at: c.now, text: formatMessage("de", msg, legacyResolver(c.s)), msg });
};
const diceTotal = (s: GameState) => (s.dice ? s.dice[0] + s.dice[1] : FALLBACK_DICE_TOTAL);
const alive = (s: GameState) => s.players.filter((p) => !p.bankrupt);

function newCtx(state: GameState, now: number): Ctx {
  return { s: structuredClone(state), ev: [], now };
}

function deckOf(cardId: string): "chance" | "community" {
  return at(CARD_BY_ID, cardId).deck;
}

// ------------------------------------------------------------------ creation

export function createGame(
  id: string,
  players: NewPlayer[],
  settings: GameSettings,
  seed: number,
  now: number,
): ApplyResult {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw GameError.of("err.playerCount", { min: MIN_PLAYERS, max: MAX_PLAYERS });
  }
  const st: GameSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    buildingLimits: { ...DEFAULT_SETTINGS.buildingLimits, ...(settings.buildingLimits ?? {}) },
  };
  let rng = seed | 0;
  const ch = shuffle(
    rng,
    CARDS.filter((x) => x.deck === "chance").map((x) => x.id),
  );
  const cm = shuffle(
    ch.rng,
    CARDS.filter((x) => x.deck === "community").map((x) => x.id),
  );
  rng = cm.rng;
  const properties: Record<number, PropertyState> = {};
  for (const t of BOARD) {
    if (isBuyable(t.index)) {
      properties[t.index] = { owner: null, level: 0, mortgaged: false };
    }
  }
  const state: GameState = {
    id,
    version: 0,
    status: "running",
    settings: st,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      tokenId: p.tokenId,
      controller: p.controller,
      botLevel: p.botLevel,
      cash: st.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
      missedTurns: 0,
    })),
    current: 0,
    round: 1,
    phase: { type: "await-roll" },
    properties,
    dice: null,
    doublesCount: 0,
    decks: { chance: ch.value, community: cm.value },
    bank: {
      houses: st.buildingLimits.houses,
      hotels: st.buildingLimits.hotels,
      skyscrapers: st.buildingLimits.skyscrapers,
    },
    ...(st.securities ? { market: initMarket(st.themeId) } : {}),
    freeParkingPot: 0,
    trades: [],
    deadline: null,
    rng,
    log: [],
  };
  const c: Ctx = { s: state, ev: [], now };
  emit(c, { type: "turn-start", playerId: cur(c).id, round: 1 });
  log(c, "log.gameStarted", { player: cur(c).id });
  setDeadline(c);
  return { state: c.s, events: c.ev };
}

// ------------------------------------------------------------------ queries

export function whoMustAct(state: GameState): PlayerId[] {
  if (state.status === "finished") {
    return [];
  }
  const ph = state.phase;
  switch (ph.type) {
    case "await-roll":
    case "await-buy":
    case "await-end-turn":
      return [at(state.players, state.current).id];
    case "auction":
      return [ph.auction.turn];
    case "debt":
      return [ph.debtor];
    case "game-over":
      return [];
    default: {
      const exhaustive: never = ph;
      return exhaustive;
    }
  }
}

/**
 * What `viewer` may see: no rng, only deck sizes, and of all auto-bid maximums only their own
 * (`null` = spectator, sees none; the default is the most private view).
 */
export function redactState(state: GameState, viewer: PlayerId | null = null): PublicGameState {
  const { rng: _rng, decks, ...rest } = state;
  const pub: PublicGameState = structuredClone({
    ...rest,
    decks: { chance: decks.chance.length, community: decks.community.length },
  });
  if (pub.phase.type === "auction") {
    const own = viewer === null ? undefined : pub.phase.auction.autoBids?.[viewer];
    if (viewer !== null && own !== undefined) {
      pub.phase.auction.autoBids = { [viewer]: own };
    } else {
      delete pub.phase.auction.autoBids;
    }
  }
  return pub;
}

const MAX_OPEN_OFFERS = 5;

function openOffersFrom(state: GameState, playerId: PlayerId): number {
  return state.trades.filter((t) => t.status === "pending" && t.from === playerId).length;
}

function canProposeEndGame(state: GameState, playerId: PlayerId): boolean {
  return state.endVote === undefined && state.round >= (state.endVoteCooldown?.[playerId] ?? 0);
}

export function legalActions(state: GameState, playerId: PlayerId): GameAction["type"][] {
  if (state.status === "finished") {
    return [];
  }
  const p = getPlayer(state, playerId);
  if (!p || p.bankrupt) {
    return [];
  }
  const out = new Set<GameAction["type"]>();
  if (
    state.players.some((o) => o.id !== playerId && !o.bankrupt) &&
    openOffersFrom(state, playerId) < MAX_OPEN_OFFERS
  ) {
    out.add("propose-trade");
  }
  if (state.trades.some((t) => t.status === "pending" && t.to === playerId)) {
    out.add("respond-trade");
  }
  if (
    state.trades.some(
      (t) => t.status === "pending" && t.to === playerId && (t.counterDepth ?? 0) < MAX_COUNTERS,
    )
  ) {
    out.add("counter-trade");
  }
  if (state.trades.some((t) => t.status === "pending" && t.from === playerId)) {
    out.add("cancel-trade");
  }
  if (canProposeEndGame(state, playerId)) {
    out.add("propose-end-game");
  }
  if (state.endVote !== undefined && state.endVote.votes[playerId] === undefined) {
    out.add("vote-end-game");
  }
  const isCur = at(state.players, state.current).id === playerId;
  const props = playerProperties(state, playerId);
  const manage = (buildAndUnmortgage: boolean) => {
    if (props.some((t) => sellBlockerMsg(state, playerId, t) === null)) {
      out.add("sell-building");
    }
    if (props.some((t) => mortgageBlockerMsg(state, playerId, t) === null)) {
      out.add("mortgage");
    }
    if (buildAndUnmortgage) {
      if (props.some((t) => buildBlockerMsg(state, playerId, t) === null)) {
        out.add("build");
      }
      if (props.some((t) => unmortgageBlockerMsg(state, playerId, t) === null)) {
        out.add("unmortgage");
      }
    }
  };
  const ph = state.phase;
  const inDebt = ph.type === "debt" && ph.debtor === playerId;
  const securitiesTurn =
    isCur && (ph.type === "await-roll" || ph.type === "await-end-turn" || ph.type === "await-buy");
  if (state.settings.securities) {
    if (inDebt || securitiesTurn) {
      if (canSellAny(state, p, inDebt)) {
        out.add("sell-securities");
      }
    }
    if (
      isCur &&
      (ph.type === "await-roll" || ph.type === "await-end-turn") &&
      canBuyAny(state, p)
    ) {
      out.add("buy-securities");
    }
  }
  if (takeLoanBlocker(state, p, Math.min(LOAN_STEP, loanRoom(state, p))) === null) {
    out.add("take-loan");
  }
  if (repayLoanBlocker(state, p, LOAN_STEP) === null) {
    out.add("repay-loan");
  }
  switch (ph.type) {
    case "await-roll":
      if (!isCur) {
        break;
      }
      out.add("roll");
      if (p.inJail) {
        if (p.cash >= JAIL_FINE) {
          out.add("pay-jail-fine");
        }
        if (p.jailCards.length > 0) {
          out.add("use-jail-card");
        }
      }
      manage(true);
      break;
    case "await-buy":
      if (!isCur) {
        break;
      }
      if (p.cash >= priceOf(tileDef(ph.tile))) {
        out.add("buy");
      }
      out.add("decline-buy");
      manage(false);
      break;
    case "auction":
      if (ph.auction.bidders.includes(playerId)) {
        out.add("set-auto-bid");
      }
      if (ph.auction.turn !== playerId) {
        break;
      }
      if (maxBid(state, playerId) > ph.auction.highestBid) {
        out.add("bid");
      }
      if (ph.auction.highestBidder !== playerId) {
        out.add("pass-auction");
      }
      break;
    case "await-end-turn":
      if (!isCur) {
        break;
      }
      out.add(ph.canRollAgain ? "roll" : "end-turn");
      manage(true);
      break;
    case "debt":
      if (ph.debtor !== playerId) {
        break;
      }
      out.add("declare-bankruptcy");
      manage(false);
      break;
    case "game-over":
      break;
    default: {
      const exhaustive: never = ph;
      return exhaustive;
    }
  }
  return [...out];
}

// ------------------------------------------------------------------ deadlines & finalisation

function setDeadline(c: Ctx): void {
  const actors = whoMustAct(c.s);
  const t = c.s.settings.turnTimeoutSec;
  if (actors.length === 0 || t <= 0) {
    c.s.deadline = null;
    return;
  }
  const p = player(c, at(actors, 0));
  c.s.deadline = p.controller === "human" ? c.now + t * MS_PER_SEC : null;
}

function finalize(c: Ctx, prevActors: string, prevPhase: string, actingPid: PlayerId | null): void {
  sweepTrades(c);
  const actors = whoMustAct(c.s);
  if (
    actors.join(",") !== prevActors ||
    c.s.phase.type !== prevPhase ||
    (actingPid !== null && actors[0] === actingPid)
  ) {
    setDeadline(c);
  }
  capLog(c);
  c.s.version++;
}

function capLog(c: Ctx): void {
  if (c.s.log.length > MAX_LOG) {
    c.s.log.splice(0, c.s.log.length - MAX_LOG);
  }
}

// ------------------------------------------------------------------ entry points

function run(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now: number,
  byBot: boolean,
): ApplyResult {
  const c = newCtx(state, now);
  const s = c.s;
  if (s.status === "finished") {
    throw GameError.of("err.gameFinished");
  }
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.bankrupt) {
    throw GameError.of("err.playerInactive");
  }
  const prevActors = whoMustAct(s).join(",");
  const prevPhase = s.phase.type;
  if (!byBot) {
    if (p.controller === "away") {
      p.controller = "human";
      emit(c, { type: "controller", playerId: p.id, controller: "human" });
      log(c, "log.back", { player: p.id });
    }
    p.missedTurns = 0;
  }
  dispatch(c, p, action);
  resolveAutoBids(c);
  resolveEndVote(c);
  finalize(c, prevActors, prevPhase, playerId);
  return { state: c.s, events: c.ev };
}

export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now: number,
): ApplyResult {
  return run(state, playerId, action, now, false);
}

/** Like applyAction but for bot-driven moves: does not flip an 'away' player back to 'human'. */
export function applyBotAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
  now: number,
): ApplyResult {
  return run(state, playerId, action, now, true);
}

/** `now` should be the current clock; it defaults to the time of the last log entry. */
export function setController(
  state: GameState,
  playerId: PlayerId,
  controller: Controller,
  now?: number,
): ApplyResult {
  const c = newCtx(state, now ?? state.log[state.log.length - 1]?.at ?? 0);
  const p = player(c, playerId);
  if (p.controller !== controller) {
    p.controller = controller;
    if (controller === "human") {
      p.missedTurns = 0;
    }
    emit(c, { type: "controller", playerId, controller });
    if (controller === "human") {
      log(c, "log.back", { player: p.id });
    } else {
      log(c, "log.botTakesOver", { player: p.id });
    }
  }
  if (c.s.deadline === null && controller === "human") {
    setDeadline(c);
  }
  if (controller !== "human" && whoMustAct(c.s)[0] === playerId) {
    c.s.deadline = null;
  }
  resolveEndVote(c);
  capLog(c);
  c.s.version++;
  return { state: c.s, events: c.ev };
}

export function handleTimeout(state: GameState, now: number): ApplyResult {
  let st = state;
  const events: GameEvent[] = [];
  // expire trades
  if (st.trades.some((t) => t.status === "pending" && t.expiresAt !== null && now >= t.expiresAt)) {
    const c = newCtx(st, now);
    for (const t of c.s.trades) {
      if (t.status === "pending" && t.expiresAt !== null && now >= t.expiresAt) {
        t.status = "expired";
        emit(c, { type: "trade", trade: structuredClone(t) });
      }
    }
    capLog(c);
    c.s.version++;
    st = c.s;
    events.push(...c.ev);
  }
  if (st.endVote !== undefined && st.endVote.expiresAt !== null && now >= st.endVote.expiresAt) {
    const c = newCtx(st, now);
    cancelEndVote(c);
    log(c, "log.endVoteExpired");
    capLog(c);
    c.s.version++;
    st = c.s;
    events.push(...c.ev);
  }
  for (let guard = 0; guard < MAX_TIMEOUT_ROUNDS; guard++) {
    if (st.status === "finished") {
      break;
    }
    const actors = whoMustAct(st);
    if (actors.length === 0) {
      break;
    }
    const pid = at(actors, 0);
    const p = defined(getPlayer(st, pid), "Player");
    const timedOut = p.controller === "human" && st.deadline !== null && now >= st.deadline;
    if (!timedOut && p.controller !== "away") {
      break;
    }
    const turnOwner = at(st.players, st.current).id === pid;
    if (timedOut && turnOwner) {
      const c = newCtx(st, now);
      const pp = player(c, pid);
      pp.missedTurns++;
      log(c, "log.timeout", { player: pp.id });
      if (pp.missedTurns >= c.s.settings.awayAfterMissedTurns) {
        pp.controller = "away";
        emit(c, { type: "controller", playerId: pid, controller: "away" });
        log(c, "log.away", { player: pp.id });
        resolveEndVote(c);
      }
      capLog(c);
      c.s.version++;
      st = c.s;
      events.push(...c.ev);
      if (st.status === "finished") {
        break;
      }
    }
    const turnStart = st.current;
    let progressed = false;
    for (let g2 = 0; g2 < MAX_BOT_STEPS_PER_ROUND; g2++) {
      if (st.status === "finished") {
        break;
      }
      const stillActing = whoMustAct(st)[0] === pid;
      if (!stillActing) {
        break;
      }
      if (turnOwner && st.current !== turnStart) {
        break;
      }
      // non-owners (auction bidders) only act for one decision
      if (!turnOwner && progressed) {
        break;
      }
      const a = chooseBotAction(st, pid);
      if (!a) {
        break;
      }
      const r = applyBotAction(st, pid, a, now);
      st = r.state;
      events.push(...r.events);
      progressed = true;
    }
    if (!progressed) {
      break;
    }
  }
  return { state: st, events };
}

// ------------------------------------------------------------------ dispatch

function need<K extends EngineMsgKey>(cond: boolean, key: K, ...args: MsgArgs<K>): asserts cond {
  if (!cond) {
    throw GameError.of(key, ...args);
  }
}

function dispatch(c: Ctx, p: PlayerState, a: GameAction): void {
  const s = c.s;
  switch (a.type) {
    case "propose-trade":
      return proposeTrade(c, p, a.offer);
    case "respond-trade":
      return respondTrade(c, p, a.tradeId, a.accept);
    case "counter-trade":
      return counterTrade(c, p, a.tradeId, a.offer);
    case "cancel-trade":
      return cancelTrade(c, p, a.tradeId);
    case "propose-end-game":
      return proposeEndGame(c, p);
    case "vote-end-game":
      return voteEndGame(c, p, a.accept);
    case "roll":
    case "pay-jail-fine":
    case "use-jail-card":
    case "buy":
    case "decline-buy":
    case "bid":
    case "pass-auction":
    case "set-auto-bid":
    case "build":
    case "sell-building":
    case "mortgage":
    case "unmortgage":
    case "buy-securities":
    case "sell-securities":
    case "take-loan":
    case "repay-loan":
    case "declare-bankruptcy":
    case "end-turn":
      break;
  }
  const isCur = cur(c).id === p.id;
  const ph = s.phase;
  switch (a.type) {
    case "roll":
      need(isCur, "err.notYourTurn");
      need(
        ph.type === "await-roll" || (ph.type === "await-end-turn" && ph.canRollAgain),
        "err.rollNotAllowed",
      );
      return doRoll(c, p);
    case "pay-jail-fine":
      need(isCur && ph.type === "await-roll" && p.inJail, "err.notInJail");
      need(p.cash >= JAIL_FINE, "err.notEnoughCash");
      pay(c, p, null, JAIL_FINE, "jail-fine");
      releaseFromJail(c, p);
      return;
    case "use-jail-card": {
      need(isCur && ph.type === "await-roll" && p.inJail, "err.notInJail");
      need(p.jailCards.length > 0, "err.noJailCard");
      const id = defined(p.jailCards.shift(), "Get-out-of-jail card");
      s.decks[deckOf(id)].push(id);
      releaseFromJail(c, p);
      log(c, "log.usesJailCard", { player: p.id });
      return;
    }
    case "buy": {
      need(isCur && ph.type === "await-buy", "err.buyNotPossible");
      const price = priceOf(tileDef(ph.tile));
      need(p.cash >= price, "err.notEnoughCash");
      assignProperty(c, p, ph.tile, price, "buy");
      finish(c);
      return;
    }
    case "decline-buy": {
      need(isCur && ph.type === "await-buy", "err.buyNotPossible");
      if (s.settings.auctions) {
        startAuction(c, ph.tile);
      } else {
        finish(c);
      }
      return;
    }
    case "bid":
      need(ph.type === "auction" && ph.auction.turn === p.id, "err.notYourBid");
      return doBid(c, p, ph.auction, a.amount);
    case "pass-auction":
      need(ph.type === "auction" && ph.auction.turn === p.id, "err.notYourBid");
      return doPass(c, p, ph.auction);
    case "set-auto-bid":
      need(ph.type === "auction" && ph.auction.bidders.includes(p.id), "err.notInAuction");
      return doSetAutoBid(c, p, ph.auction, a.max);
    case "build":
      need(isCur && (ph.type === "await-roll" || ph.type === "await-end-turn"), "err.buildNotNow");
      return doBuild(c, p, a.tile);
    case "unmortgage":
      need(isCur && (ph.type === "await-roll" || ph.type === "await-end-turn"), "err.notNow");
      return doUnmortgage(c, p, a.tile);
    case "sell-building":
    case "mortgage": {
      const ok =
        (isCur &&
          (ph.type === "await-roll" || ph.type === "await-end-turn" || ph.type === "await-buy")) ||
        (ph.type === "debt" && ph.debtor === p.id);
      need(ok, "err.notNow");
      if (a.type === "sell-building") {
        doSell(c, p, a.tile);
      } else {
        doMortgage(c, p, a.tile);
      }
      settleDebt(c);
      return;
    }
    case "buy-securities":
      need(isCur && (ph.type === "await-roll" || ph.type === "await-end-turn"), "err.notNow");
      return doBuySecurities(c, p, a.secId, a.shares);
    case "sell-securities": {
      const inDebt = ph.type === "debt" && ph.debtor === p.id;
      need(
        inDebt ||
          (isCur &&
            (ph.type === "await-roll" || ph.type === "await-end-turn" || ph.type === "await-buy")),
        "err.notNow",
      );
      doSellSecurities(c, p, a.secId, a.lot, inDebt);
      settleDebt(c);
      return;
    }
    case "take-loan":
      return doTakeLoan(c, p, a.amount);
    case "repay-loan":
      return doRepayLoan(c, p, a.amount);
    case "end-turn":
      need(isCur && ph.type === "await-end-turn" && !ph.canRollAgain, "err.endTurnNotAllowed");
      return advanceTurn(c);
    case "declare-bankruptcy":
      need(ph.type === "debt" && ph.debtor === p.id, "err.onlyInDebt");
      return bankrupt(c, p);
    default: {
      const exhaustive: never = a;
      throw GameError.of("err.unknownAction", { action: JSON.stringify(exhaustive) });
    }
  }
}

// ------------------------------------------------------------------ money

function cash(
  c: Ctx,
  p: PlayerState,
  delta: number,
  reason: CashReason,
  counterparty: PlayerId | null,
): void {
  p.cash += delta;
  emit(c, { type: "cash", playerId: p.id, delta, reason, counterparty });
}

/** Pay `amount`. Returns false (and enters the debt phase) if the payer cannot afford it. */
function pay(
  c: Ctx,
  from: PlayerState,
  to: PlayerState | null,
  amount: number,
  reason: CashReason,
): boolean {
  if (amount <= 0) {
    return true;
  }
  if (from.cash >= amount) {
    cash(c, from, -amount, reason, to?.id ?? null);
    if (to) {
      cash(c, to, amount, reason, from.id);
    }
    return true;
  }
  c.s.phase = { type: "debt", debtor: from.id, creditor: to?.id ?? null, amount };
  log(c, "log.owes", { player: from.id, amount });
  return false;
}

function settleDebt(c: Ctx): void {
  const ph = c.s.phase;
  if (ph.type !== "debt") {
    return;
  }
  const debtor = player(c, ph.debtor);
  if (debtor.cash < ph.amount) {
    return;
  }
  const creditor = ph.creditor ? player(c, ph.creditor) : null;
  const tile = tileDef(debtor.position);
  const auctionDebt = ph.auctionTile !== undefined;
  if (ph.loanInterest === true) {
    // the interest due at the start of the turn: paid, now the turn begins
    cash(c, debtor, -ph.amount, "loan-interest", null);
    log(c, "log.debtSettled", { player: debtor.id, amount: ph.amount });
    c.s.phase = { type: "await-roll" };
    return;
  }
  const reason: CashReason = auctionDebt
    ? "auction"
    : creditor
      ? "rent"
      : tile.kind === "tax"
        ? "tax"
        : tile.kind === "jail" && ph.amount === JAIL_FINE
          ? "jail-fine"
          : "card";
  cash(c, debtor, -ph.amount, reason, creditor?.id ?? null);
  if (creditor) {
    cash(c, creditor, ph.amount, reason, debtor.id);
  } else if (
    !auctionDebt &&
    c.s.settings.freeParkingJackpot &&
    tile.kind === "tax" &&
    tile.taxAmount === ph.amount
  ) {
    c.s.freeParkingPot += ph.amount;
  }
  log(c, "log.debtSettled", { player: debtor.id, amount: ph.amount });
  // forced fine after the third failed jail roll: the player was released and now moves by the roll
  if (
    !auctionDebt &&
    !creditor &&
    tile.kind === "jail" &&
    !debtor.inJail &&
    ph.amount === JAIL_FINE
  ) {
    walk(c, debtor, diceTotal(c.s));
    return;
  }
  finish(c);
}

function finish(c: Ctx): void {
  const p = cur(c);
  const d = c.s.dice;
  const again = !!d && d[0] === d[1] && c.s.doublesCount > 0 && !p.inJail && !p.bankrupt;
  c.s.phase = { type: "await-end-turn", canRollAgain: again };
}

// ------------------------------------------------------------------ movement

function collectGo(c: Ctx, p: PlayerState, landedExactly: boolean): void {
  const mult = landedExactly && c.s.settings.doubleOnGoLanding ? 2 : 1;
  const amount = c.s.settings.goSalary * mult;
  cash(c, p, amount, "go", null);
  log(c, "log.goSalary", { player: p.id, amount });
}

function moveTo(
  c: Ctx,
  p: PlayerState,
  to: number,
  mode: "walk" | "walk-back" | "teleport",
  passedGo: boolean,
): void {
  const from = p.position;
  p.position = to;
  emit(c, { type: "move", playerId: p.id, from, to, mode, passedGo });
  if (passedGo) {
    collectGo(c, p, to === 0);
  }
}

function sendToJail(c: Ctx, p: PlayerState): void {
  const from = p.position;
  p.position = JAIL_INDEX;
  p.inJail = true;
  p.jailTurns = 0;
  c.s.doublesCount = 0;
  emit(c, {
    type: "move",
    playerId: p.id,
    from,
    to: JAIL_INDEX,
    mode: "teleport",
    passedGo: false,
  });
  emit(c, { type: "jail", playerId: p.id, inJail: true });
  log(c, "log.goToJail", { player: p.id });
}

function releaseFromJail(c: Ctx, p: PlayerState): void {
  p.inJail = false;
  p.jailTurns = 0;
  emit(c, { type: "jail", playerId: p.id, inJail: false });
}

function doRoll(c: Ctx, p: PlayerState): void {
  const s = c.s;
  let r = rollDie(s.rng);
  const d1 = r.value;
  r = rollDie(r.rng);
  const d2 = r.value;
  s.rng = r.rng;
  s.dice = [d1, d2];
  const doubles = d1 === d2;
  const total = d1 + d2;
  emit(c, { type: "dice", playerId: p.id, dice: [d1, d2], doubles });
  log(c, doubles ? "log.rolledDoubles" : "log.rolled", { player: p.id, a: d1, b: d2 });
  if (p.inJail) {
    if (doubles) {
      releaseFromJail(c, p);
      s.doublesCount = 0;
      return walk(c, p, total);
    }
    p.jailTurns++;
    if (p.jailTurns >= MAX_JAIL_TURNS) {
      // forced fine; the move is skipped if the player cannot pay immediately
      releaseFromJail(c, p);
      if (pay(c, p, null, JAIL_FINE, "jail-fine")) {
        return walk(c, p, total);
      }
      return;
    }
    return finish(c);
  }
  if (doubles) {
    s.doublesCount++;
    if (s.doublesCount >= DOUBLES_TO_JAIL) {
      log(c, "log.threeDoubles", { player: p.id });
      sendToJail(c, p);
      return finish(c);
    }
  } else {
    s.doublesCount = 0;
  }
  walk(c, p, total);
}

function walk(c: Ctx, p: PlayerState, steps: number): void {
  const from = p.position;
  const to = (from + steps) % BOARD_SIZE;
  moveTo(c, p, to, "walk", from + steps >= BOARD_SIZE);
  landOn(c, to);
}

interface Special {
  kind: "station" | "utility";
  mult: number;
}

function landOn(c: Ctx, idx: number, special?: Special): void {
  const s = c.s;
  const p = cur(c);
  const t = tileDef(idx);
  switch (t.kind) {
    case "street":
    case "station":
    case "utility": {
      const pr = propState(s, idx);
      if (!pr.owner) {
        s.phase = { type: "await-buy", tile: idx };
        return;
      }
      if (pr.owner === p.id || pr.mortgaged) {
        return finish(c);
      }
      const owner = player(c, pr.owner);
      const d = diceTotal(s);
      let amount: number;
      if (special?.kind === "utility" && t.kind === "utility") {
        amount = special.mult * d;
      } else if (special?.kind === "station" && t.kind === "station") {
        amount = rentFor(s, idx, d, { stationMultiplier: special.mult });
      } else {
        amount = rentFor(s, idx, d);
      }
      emit(c, { type: "rent", payer: p.id, owner: owner.id, tile: idx, amount });
      noteActivity(c, (a) => {
        a.rentPaid += amount;
        if (t.kind === "station") {
          a.stationRents++;
        } else if (t.kind === "utility") {
          a.utilityRents++;
        }
      });
      log(c, "log.rentPaid", { player: p.id, amount, owner: owner.id, tile: idx });
      if (pay(c, p, owner, amount, "rent")) {
        finish(c);
      }
      return;
    }
    case "tax": {
      const amount = t.taxAmount ?? 0;
      log(c, "log.taxPaid", { player: p.id, amount });
      if (s.settings.freeParkingJackpot) {
        if (p.cash >= amount) {
          cash(c, p, -amount, "tax", null);
          s.freeParkingPot += amount;
          return finish(c);
        }
        s.phase = { type: "debt", debtor: p.id, creditor: null, amount };
        log(c, "log.owes", { player: p.id, amount });
        return;
      }
      if (pay(c, p, null, amount, "tax")) {
        finish(c);
      }
      return;
    }
    case "chance":
    case "community": {
      const def = drawCard(c, t.kind);
      emit(c, { type: "card", playerId: p.id, deck: t.kind, cardId: def.id });
      log(c, "log.cardDrawn", { player: p.id, card: def.id });
      return applyCard(c, def);
    }
    case "go-to-jail":
      sendToJail(c, p);
      return finish(c);
    case "free-parking":
      if (s.settings.freeParkingJackpot && s.freeParkingPot > 0) {
        const pot = s.freeParkingPot;
        s.freeParkingPot = 0;
        cash(c, p, pot, "free-parking", null);
        log(c, "log.freeParking", { player: p.id, amount: pot });
      }
      return finish(c);
    case "go":
    case "jail":
      return finish(c);
  }
}

// ------------------------------------------------------------------ cards

function drawCard(c: Ctx, deck: "chance" | "community"): CardDef {
  const s = c.s;
  if (s.decks[deck].length === 0) {
    const held = new Set(s.players.flatMap((p) => p.jailCards));
    const ids = CARDS.filter((x) => x.deck === deck && !held.has(x.id)).map((x) => x.id);
    const sh = shuffle(s.rng, ids);
    s.rng = sh.rng;
    s.decks[deck] = sh.value;
  }
  const id = defined(s.decks[deck].shift(), "Card");
  const def = at(CARD_BY_ID, id);
  if (def.effect.kind !== "jail-card") {
    s.decks[deck].push(id);
  }
  return def;
}

function applyCard(c: Ctx, def: CardDef): void {
  const s = c.s;
  const p = cur(c);
  const e = def.effect;
  switch (e.kind) {
    case "move-to": {
      const passed = e.collectGo && e.tile < p.position;
      moveTo(c, p, e.tile, "walk", passed);
      return landOn(c, e.tile);
    }
    case "move-by": {
      const to = (((p.position + e.steps) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
      const passed = e.steps > 0 && p.position + e.steps >= BOARD_SIZE;
      moveTo(c, p, to, e.steps < 0 ? "walk-back" : "walk", passed);
      return landOn(c, to);
    }
    case "nearest": {
      let to = p.position;
      for (let i = 1; i < BOARD_SIZE; i++) {
        const idx = (p.position + i) % BOARD_SIZE;
        if (tileDef(idx).kind === e.target) {
          to = idx;
          break;
        }
      }
      moveTo(c, p, to, "walk", to < p.position);
      return landOn(c, to, { kind: e.target, mult: e.rentMultiplier });
    }
    case "cash":
      if (e.amount >= 0) {
        cash(c, p, e.amount, "card", null);
        return finish(c);
      }
      if (pay(c, p, null, -e.amount, "card")) {
        finish(c);
      }
      return;
    case "cash-from-each": {
      for (const o of alive(s)) {
        if (o.id === p.id) {
          continue;
        }
        const amt = Math.min(o.cash, e.amount);
        if (amt > 0) {
          cash(c, o, -amt, "card", p.id);
          cash(c, p, amt, "card", o.id);
        }
      }
      return finish(c);
    }
    case "cash-to-each": {
      const others = alive(s).filter((o) => o.id !== p.id);
      const total = e.amount * others.length;
      if (p.cash >= total) {
        for (const o of others) {
          cash(c, p, -e.amount, "card", o.id);
          cash(c, o, e.amount, "card", p.id);
        }
        return finish(c);
      }
      // cannot afford: debt to the bank (simplification)
      pay(c, p, null, total, "card");
      return;
    }
    case "repairs": {
      let total = 0;
      for (const i of playerProperties(s, p.id)) {
        const lv = propState(s, i).level;
        if (lv >= 1 && lv <= 4) {
          total += lv * e.perHouse;
        } else if (lv === HOTEL_LEVEL) {
          total += e.perHotel;
        } else if (lv === SKYSCRAPER_LEVEL) {
          total += e.perSkyscraper;
        }
      }
      if (total === 0 || pay(c, p, null, total, "card")) {
        finish(c);
      }
      return;
    }
    case "go-to-jail":
      sendToJail(c, p);
      return finish(c);
    case "jail-card":
      p.jailCards.push(def.id);
      return finish(c);
  }
}

// ------------------------------------------------------------------ buying & auctions

function assignProperty(
  c: Ctx,
  p: PlayerState,
  tile: number,
  price: number,
  reason: CashReason,
): void {
  cash(c, p, -price, reason, null);
  propState(c.s, tile).owner = p.id;
  emit(c, { type: "property-bought", playerId: p.id, tile, price });
  log(c, "log.bought", { player: p.id, tile, amount: price });
}

function startAuction(c: Ctx, tile: number): void {
  const s = c.s;
  const order: PlayerId[] = [];
  for (let i = 1; i <= s.players.length; i++) {
    const pl = at(s.players, (s.current + i) % s.players.length);
    if (!pl.bankrupt) {
      order.push(pl.id);
    }
  }
  const auction: Auction = {
    tile,
    highestBid: 0,
    highestBidder: null,
    bidders: order,
    turn: at(order, 0),
  };
  s.phase = { type: "auction", auction };
  emit(c, { type: "auction-start", tile });
  log(c, "log.auctionStart", { tile });
}

function doBid(c: Ctx, p: PlayerState, a: Auction, amount: number): void {
  need(Number.isInteger(amount) && amount > a.highestBid && amount >= 1, "err.bidTooLow");
  need(amount <= maxBid(c.s, p.id), "err.bidTooHigh");
  placeBid(c, p, a, amount);
  log(c, "log.bid", { player: p.id, amount });
  advanceAfterBid(c, p, a);
}

/** Records a (validated) bid; the caller logs it and then calls `advanceAfterBid`. */
function placeBid(c: Ctx, p: PlayerState, a: Auction, amount: number): void {
  a.highestBid = amount;
  a.highestBidder = p.id;
  emit(c, { type: "auction-bid", playerId: p.id, amount });
}

function advanceAfterBid(c: Ctx, p: PlayerState, a: Auction): void {
  if (a.bidders.length === 1) {
    return endAuction(c, a);
  }
  const idx = a.bidders.indexOf(p.id);
  a.turn = at(a.bidders, (idx + 1) % a.bidders.length);
}

function doPass(c: Ctx, p: PlayerState, a: Auction): void {
  need(a.highestBidder !== p.id, "err.alreadyLeading");
  const idx = leaveAuction(a, p.id);
  log(c, "log.passed", { player: p.id });
  afterLeaving(c, a, idx);
}

/** Removes the player (and their auto-bid) from the auction; returns their old position in the order. */
function leaveAuction(a: Auction, playerId: PlayerId): number {
  const idx = a.bidders.indexOf(playerId);
  a.bidders.splice(idx, 1);
  if (a.autoBids) {
    delete a.autoBids[playerId];
  }
  return idx;
}

function afterLeaving(c: Ctx, a: Auction, idx: number): void {
  if (a.bidders.length === 0) {
    return endAuction(c, a);
  }
  if (a.bidders.length === 1 && a.highestBidder === a.bidders[0]) {
    return endAuction(c, a);
  }
  a.turn = at(a.bidders, idx % a.bidders.length);
}

function doSetAutoBid(c: Ctx, p: PlayerState, a: Auction, max: number | null): void {
  if (max === null) {
    if (a.autoBids) {
      delete a.autoBids[p.id];
    }
    return;
  }
  need(Number.isInteger(max) && max > a.highestBid, "err.autoBidTooLow");
  need(max <= maxBid(c.s, p.id), "err.bidTooHigh");
  a.autoBids = { ...a.autoBids, [p.id]: max };
}

/**
 * Proxy bidding: while the player whose turn it is has an auto-bid, bid for them (the step above
 * the leader, at most their maximum and what they can raise) or pass once outbid. Each round
 * either raises the highest bid (bounded by the maximums) or removes a bidder, so it terminates.
 */
function resolveAutoBids(c: Ctx): void {
  for (let round = 0; round < MAX_AUTO_BID_ROUNDS; round++) {
    const ph = c.s.phase;
    if (ph.type !== "auction") {
      return;
    }
    const a = ph.auction;
    const max = a.autoBids?.[a.turn];
    if (max === undefined || a.highestBidder === a.turn) {
      return;
    }
    const p = player(c, a.turn);
    const amount = Math.min(max, a.highestBid + AUTO_BID_STEP, maxBid(c.s, p.id));
    if (amount > a.highestBid) {
      placeBid(c, p, a, amount);
      log(c, "log.autoBid", { player: p.id, amount });
      advanceAfterBid(c, p, a);
    } else {
      const idx = leaveAuction(a, p.id);
      log(c, "log.autoBidExhausted", { player: p.id });
      afterLeaving(c, a, idx);
    }
  }
}

function endAuction(c: Ctx, a: Auction): void {
  const winner = a.highestBidder ? player(c, a.highestBidder) : null;
  if (winner) {
    propState(c.s, a.tile).owner = winner.id;
    emit(c, { type: "auction-end", tile: a.tile, winner: winner.id, amount: a.highestBid });
    emit(c, { type: "property-bought", playerId: winner.id, tile: a.tile, price: a.highestBid });
    if (winner.cash < a.highestBid) {
      // bid beyond cash is allowed (maxBid): the winner must raise the money or go bankrupt
      c.s.phase = {
        type: "debt",
        debtor: winner.id,
        creditor: null,
        amount: a.highestBid,
        auctionTile: a.tile,
      };
      log(c, "log.auctionWonDebt", { player: winner.id, tile: a.tile, amount: a.highestBid });
      return;
    }
    cash(c, winner, -a.highestBid, "auction", null);
    log(c, "log.auctionWon", { player: winner.id, tile: a.tile, amount: a.highestBid });
  } else {
    emit(c, { type: "auction-end", tile: a.tile, winner: null, amount: 0 });
    log(c, "log.auctionUnsold", { tile: a.tile });
  }
  finish(c);
}

// ------------------------------------------------------------------ buildings, mortgages

function setLevel(c: Ctx, p: PlayerState, tile: number, level: BuildingLevel): void {
  propState(c.s, tile).level = level;
  emit(c, { type: "building", tile, level, playerId: p.id });
}

function doBuild(c: Ctx, p: PlayerState, tile: number): void {
  const why = buildBlockerMsg(c.s, p.id, tile);
  if (why) {
    throw GameError.fromMsg(why);
  }
  const pr = propState(c.s, tile);
  const def = tileDef(tile);
  const next = (pr.level + 1) as BuildingLevel;
  const cost = buildCostFor(def, next);
  const bank = c.s.bank;
  if (next <= 4) {
    bank.houses--;
  } else if (next === HOTEL_LEVEL) {
    bank.hotels--;
    bank.houses += 4;
  } else {
    bank.skyscrapers--;
    bank.hotels++;
  }
  cash(c, p, -cost, "build", null);
  noteActivity(c, (a) => {
    a.builds++;
    if (getTheme(c.s.settings.themeId).scenicGroups.includes(def.group ?? -1)) {
      a.scenicBuilds++;
    }
  });
  setLevel(c, p, tile, next);
  log(c, "log.built", { player: p.id, tile, level: next });
}

function doSell(c: Ctx, p: PlayerState, tile: number): void {
  const why = sellBlockerMsg(c.s, p.id, tile);
  if (why) {
    throw GameError.fromMsg(why);
  }
  const pr = propState(c.s, tile);
  const def = tileDef(tile);
  const bank = c.s.bank;
  const gain = sellValue(def, pr.level);
  if (pr.level <= 4) {
    bank.houses++;
  } else if (pr.level === HOTEL_LEVEL) {
    bank.hotels++;
    bank.houses -= 4;
  } else {
    bank.skyscrapers++;
    bank.hotels--;
  }
  cash(c, p, gain, "sell-building", null);
  setLevel(c, p, tile, (pr.level - 1) as BuildingLevel);
  log(c, "log.soldBuilding", { player: p.id, tile });
}

function doMortgage(c: Ctx, p: PlayerState, tile: number): void {
  const why = mortgageBlockerMsg(c.s, p.id, tile);
  if (why) {
    throw GameError.fromMsg(why);
  }
  propState(c.s, tile).mortgaged = true;
  cash(c, p, mortgageOf(tileDef(tile)), "mortgage", null);
  emit(c, { type: "mortgage", tile, mortgaged: true, playerId: p.id });
  log(c, "log.mortgaged", { player: p.id, tile });
}

function doUnmortgage(c: Ctx, p: PlayerState, tile: number): void {
  const why = unmortgageBlockerMsg(c.s, p.id, tile);
  if (why) {
    throw GameError.fromMsg(why);
  }
  cash(c, p, -unmortgageCost(tileDef(tile)), "unmortgage", null);
  propState(c.s, tile).mortgaged = false;
  emit(c, { type: "mortgage", tile, mortgaged: false, playerId: p.id });
  log(c, "log.unmortgaged", { player: p.id, tile });
}

// ------------------------------------------------------------------ trades

function copyOffer(offer: TradeOffer): TradeOffer {
  return {
    to: offer.to,
    giveCash: offer.giveCash,
    giveTiles: [...offer.giveTiles],
    giveJailCards: offer.giveJailCards,
    wantCash: offer.wantCash,
    wantTiles: [...offer.wantTiles],
    wantJailCards: offer.wantJailCards,
  };
}

/** A fresh pending trade; `counterOf` links it to the offer it answers. */
function openTrade(c: Ctx, from: PlayerState, o: TradeOffer, counterOf?: Trade): Trade {
  const target = player(c, o.to);
  const t: Trade = {
    ...o,
    id: `t${c.s.version + 1}`,
    from: from.id,
    status: "pending",
    createdAt: c.now,
    expiresAt:
      c.s.settings.turnTimeoutSec > 0 && target.controller !== "bot"
        ? c.now + c.s.settings.turnTimeoutSec * 1000
        : null,
  };
  if (counterOf) {
    t.counterOf = counterOf.id;
    t.counterDepth = (counterOf.counterDepth ?? 0) + 1;
  }
  c.s.trades.push(t);
  emit(c, { type: "trade", trade: structuredClone(t) });
  return t;
}

function proposeTrade(c: Ctx, p: PlayerState, offer: TradeOffer): void {
  const s = c.s;
  const o = copyOffer(offer);
  const err = tradeProblem(s, { ...o, from: p.id }, true);
  if (err) {
    throw GameError.fromMsg(err);
  }
  need(openOffersFrom(s, p.id) < MAX_OPEN_OFFERS, "err.tooManyOffers");
  const target = player(c, o.to);
  openTrade(c, p, o);
  log(c, "log.tradeOffered", { player: p.id, target: target.id });
}

function findPending(c: Ctx, id: string): Trade {
  const t = c.s.trades.find((x) => x.id === id);
  if (!t) {
    throw GameError.of("err.tradeNotFound");
  }
  if (t.status !== "pending") {
    throw GameError.of("err.tradeClosed");
  }
  return t;
}

function cancelTrade(c: Ctx, p: PlayerState, id: string): void {
  const t = findPending(c, id);
  need(t.from === p.id, "err.tradeOnlyProposer");
  t.status = "cancelled";
  emit(c, { type: "trade", trade: structuredClone(t) });
}

/**
 * The addressee answers an offer with a counteroffer to its proposer: the original is closed as
 * "countered" and a new pending offer (same validation as any offer) takes its place. A negotiation
 * holds at most MAX_COUNTERS counteroffers.
 */
function counterTrade(c: Ctx, p: PlayerState, id: string, offer: TradeOffer): void {
  const s = c.s;
  const t = findPending(c, id);
  need(t.to === p.id, "err.tradeNotForYou");
  need((t.counterDepth ?? 0) < MAX_COUNTERS, "err.counterLimit");
  need(offer.to === t.from, "err.counterTarget");
  if (tradeProblem(s, t, false)) {
    // the offer being answered is stale (ownership changed): close it, nothing to counter
    t.status = "invalid";
    emit(c, { type: "trade", trade: structuredClone(t) });
    log(c, "log.tradeInvalid");
    return;
  }
  const o = copyOffer(offer);
  const err = tradeProblem(s, { ...o, from: p.id }, true);
  if (err) {
    throw GameError.fromMsg(err);
  }
  t.status = "countered";
  emit(c, { type: "trade", trade: structuredClone(t) });
  openTrade(c, p, o, t);
  const sameItems =
    sameSet(t.giveTiles, o.wantTiles) &&
    sameSet(t.wantTiles, o.giveTiles) &&
    t.giveJailCards === o.wantJailCards &&
    t.wantJailCards === o.giveJailCards;
  const was = t.giveCash - t.wantCash; // net cash towards the countering player in the old offer (negative = they pay)
  const now = o.wantCash - o.giveCash;
  if (sameItems && was * now >= 0 && was !== now) {
    log(c, "log.tradeCounteredCash", {
      player: p.id,
      target: t.from,
      amount: Math.abs(now),
      was: Math.abs(was),
    });
  } else {
    log(c, "log.tradeCountered", { player: p.id, target: t.from });
  }
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function respondTrade(c: Ctx, p: PlayerState, id: string, accept: boolean): void {
  const s = c.s;
  const t = findPending(c, id);
  need(t.to === p.id, "err.tradeNotForYou");
  if (!accept) {
    t.status = "rejected";
    emit(c, { type: "trade", trade: structuredClone(t) });
    log(c, "log.tradeRejected", { player: p.id });
    return;
  }
  if (tradeProblem(s, t, true)) {
    t.status = "invalid";
    emit(c, { type: "trade", trade: structuredClone(t) });
    log(c, "log.tradeInvalid");
    return;
  }
  const from = player(c, t.from);
  const to = player(c, t.to);
  const net = t.wantCash - t.giveCash; // to -> from
  if (net !== 0) {
    cash(c, from, net, "trade", to.id);
    cash(c, to, -net, "trade", from.id);
  }
  const move = (tiles: number[], dest: PlayerState) => {
    for (const i of tiles) {
      const pr = propState(s, i);
      pr.owner = dest.id;
      if (pr.mortgaged) {
        cash(c, dest, -mortgageInterest(i), "trade", null);
      }
    }
  };
  move(t.giveTiles, to);
  move(t.wantTiles, from);
  from.jailCards.push(...to.jailCards.splice(0, t.wantJailCards));
  to.jailCards.push(...from.jailCards.splice(0, t.giveJailCards));
  t.status = "accepted";
  emit(c, { type: "trade", trade: structuredClone(t) });
  log(c, "log.traded", { player: from.id, target: to.id });
  settleDebt(c);
}

function sweepTrades(c: Ctx): void {
  const s = c.s;
  for (const t of s.trades) {
    if (t.status === "pending" && tradeProblem(s, t, false)) {
      t.status = "invalid";
      emit(c, { type: "trade", trade: structuredClone(t) });
    }
  }
  const finished = s.trades.filter((t) => t.status !== "pending");
  if (finished.length > MAX_FINISHED_TRADES) {
    const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED_TRADES).map((t) => t.id));
    s.trades = s.trades.filter((t) => !drop.has(t.id));
  }
}

// ------------------------------------------------------------------ securities (Wertpapiere)

/** Records what happened in the game for the market coupling (no-op without a market). */
function noteActivity(c: Ctx, fn: (a: MarketActivity) => void): void {
  if (c.s.market) {
    fn(c.s.market.activity);
  }
}

function doBuySecurities(c: Ctx, p: PlayerState, secId: string, shares: number): void {
  const why = buyBlocker(c.s, p, secId, shares);
  if (why) {
    throw GameError.fromMsg(why);
  }
  const price = priceOfSecurity(c.s, secId);
  cash(c, p, -price * shares, "securities", null);
  addLot(c.s, p, secId, shares);
  emit(c, { type: "securities-trade", playerId: p.id, secId, shares, price, side: "buy" });
  log(c, "log.secBought", { player: p.id, shares, security: secId, amount: price * shares });
}

function doSellSecurities(
  c: Ctx,
  p: PlayerState,
  secId: string,
  lot: number | "all",
  inDebt: boolean,
): void {
  const plan = planSale(c.s, p, secId, lot, inDebt);
  if (!plan.ok) {
    throw GameError.fromMsg(plan.msg);
  }
  const price = priceOfSecurity(c.s, secId);
  const sold = new Set(plan.lots.map((l) => l.index));
  for (const l of plan.lots) {
    const h = at(holdingsOf(p), l.index);
    const amount = saleProceeds(price, h.shares, l.emergency);
    cash(c, p, amount, "securities", null);
    emit(c, {
      type: "securities-trade",
      playerId: p.id,
      secId,
      shares: h.shares,
      price,
      side: l.emergency ? "emergency-sell" : "sell",
    });
    log(c, l.emergency ? "log.secSoldEmergency" : "log.secSold", {
      player: p.id,
      shares: h.shares,
      security: secId,
      amount,
    });
  }
  p.holdings = holdingsOf(p).filter((_, i) => !sold.has(i));
}

/** Bankruptcy: holdings go to the creditor player, or are sold to the bank at the market price. */
function releaseHoldings(c: Ctx, p: PlayerState, creditor: PlayerState | null): void {
  const lots = holdingsOf(p);
  if (lots.length === 0) {
    return;
  }
  if (creditor) {
    transferHoldings(p, creditor);
    log(c, "log.secToCreditor", { player: p.id, target: creditor.id });
    return;
  }
  let total = 0;
  for (const h of lots) {
    const price = priceOfSecurity(c.s, h.secId);
    total += price * h.shares;
    emit(c, {
      type: "securities-trade",
      playerId: p.id,
      secId: h.secId,
      shares: h.shares,
      price,
      side: "bankruptcy-sale",
    });
  }
  delete p.holdings;
  log(c, "log.secToBank", { player: p.id, amount: total });
}

/**
 * Round end, before the price update: pays the dividends (securities.ts) as cash, one log line and
 * one event per paid player, plus a log line when a company pays a special dividend or suspends it.
 */
function payDividends(c: Ctx): void {
  const s = c.s;
  if (!dividendsOn(s)) {
    return;
  }
  const draw = drawDividendEvent(s);
  s.rng = draw.rng;
  if (draw.event) {
    log(c, draw.event.kind === "special" ? "log.dividendSpecial" : "log.dividendSuspended", {
      security: draw.event.secId,
    });
  }
  for (const p of s.players) {
    if (p.bankrupt) {
      continue;
    }
    const { total } = dividendFor(s, p, draw.event);
    if (total > 0) {
      p.cash += total;
      p.dividends = (p.dividends ?? 0) + total;
      log(c, "log.dividend", { player: p.id, amount: total });
      emit(c, { type: "dividend", playerId: p.id, amount: total, round: s.round });
    }
  }
}

/** Round end: moves the prices (random walk + coupling + rare headline), see securities.ts. */
function updateMarket(c: Ctx): void {
  const s = c.s;
  if (!s.market) {
    return;
  }
  const step = stepMarket(s);
  s.market = step.market;
  s.rng = step.rng;
  const headline = step.market.headline ?? null;
  emit(c, { type: "market", round: s.round + 1, headline });
  if (headline) {
    log(c, HEADLINE_KEYS[headline.sector][headline.kind], {
      security: headline.secId,
      pct: headline.pct,
    });
  }
}

// ------------------------------------------------------------------ show-off mode (Protzmodus, bank loans)

function doTakeLoan(c: Ctx, p: PlayerState, amount: number): void {
  const why = takeLoanBlocker(c.s, p, amount);
  if (why) {
    throw GameError.fromMsg(why);
  }
  const ratePct = loanRateFor(c.s, p.id, netWorth);
  addTranche(p, amount, ratePct);
  cash(c, p, amount, "loan", null);
  emit(c, { type: "loan", playerId: p.id, amount, ratePct });
  log(c, "log.loanTaken", { player: p.id, amount, pct: ratePct });
}

function doRepayLoan(c: Ctx, p: PlayerState, amount: number): void {
  const why = repayLoanBlocker(c.s, p, amount);
  if (why) {
    throw GameError.fromMsg(why);
  }
  const ratePct = p.loans?.[0]?.ratePct ?? 0;
  repayTranches(p, amount);
  cash(c, p, -amount, "loan", null);
  emit(c, { type: "loan", playerId: p.id, amount: -amount, ratePct });
  log(c, "log.loanRepaid", { player: p.id, amount });
}

/**
 * Start of a turn: the interest of all tranches is due in cash. Short of cash, the usual debt phase
 * follows (flagged so that the turn starts once it is settled); the debt itself never grows.
 */
function chargeInterest(c: Ctx, p: PlayerState): void {
  const due = interestDue(p);
  if (due <= 0) {
    return;
  }
  if (p.cash >= due) {
    cash(c, p, -due, "loan-interest", null);
    log(c, "log.loanInterest", { player: p.id, amount: due });
    return;
  }
  c.s.phase = { type: "debt", debtor: p.id, creditor: null, amount: due, loanInterest: true };
  log(c, "log.owes", { player: p.id, amount: due });
}

/** Bankruptcy: the open loans disappear with the player (the bank writes them off). */
function writeOffLoans(c: Ctx, p: PlayerState): void {
  const debt = loanDebt(p);
  delete p.loans;
  if (debt > 0) {
    log(c, "log.loanWrittenOff", { player: p.id, amount: debt });
  }
}

// ------------------------------------------------------------------ turn flow, bankruptcy, game end

function advanceTurn(c: Ctx): void {
  const s = c.s;
  const n = s.players.length;
  let i = s.current;
  let wrapped = false;
  do {
    i = (i + 1) % n;
    if (i === 0) {
      wrapped = true;
    }
  } while (at(s.players, i).bankrupt);
  if (wrapped) {
    payDividends(c);
    updateMarket(c);
    s.round++;
    if (s.settings.maxRounds > 0 && s.round > s.settings.maxRounds) {
      return endGame(c, "round-limit");
    }
  }
  s.current = i;
  s.dice = null;
  s.doublesCount = 0;
  s.phase = { type: "await-roll" };
  emit(c, { type: "turn-start", playerId: at(s.players, i).id, round: s.round });
  chargeInterest(c, at(s.players, i));
}

function endGame(c: Ctx, reason: GameOverReason): void {
  const s = c.s;
  const results = rankPlayers(s);
  const top = results[0];
  const winner = top && !top.bankrupt ? top.playerId : null;
  s.phase = { type: "game-over", winner, reason, results };
  s.status = "finished";
  s.deadline = null;
  delete s.endVote;
  emit(c, { type: "game-over", winner });
  if (winner) {
    log(c, "log.gameOverWinner", { player: winner });
  } else {
    log(c, "log.gameOver");
  }
}

/**
 * A game that waited for its players (nobody was connected, docs/DESIGN.md #60): every running clock starts over
 * with its full length, so the first human back is not punished for the time nobody was looking. The current
 * human's turn deadline, open trade offers and a running end vote get a fresh window; missed turns are untouched.
 */
export function restartClocks(state: GameState, now: number): ApplyResult {
  const t = state.settings.turnTimeoutSec;
  const open = state.trades.some((x) => x.status === "pending" && x.expiresAt !== null);
  if (t <= 0 || (state.deadline === null && !open && !state.endVote?.expiresAt)) {
    return { state, events: [] };
  }
  const c = newCtx(state, now);
  if (c.s.deadline !== null) {
    c.s.deadline = now + t * MS_PER_SEC;
  }
  for (const trade of c.s.trades) {
    if (trade.status === "pending" && trade.expiresAt !== null) {
      trade.expiresAt = now + t * MS_PER_SEC;
    }
  }
  if (c.s.endVote && c.s.endVote.expiresAt !== null) {
    c.s.endVote.expiresAt = now + t * MS_PER_SEC;
  }
  c.s.version++;
  return { state: c.s, events: c.ev };
}

// ------------------------------------------------------------------ vote to end the game

function proposeEndGame(c: Ctx, p: PlayerState): void {
  const s = c.s;
  need(s.endVote === undefined, "err.endVoteRunning");
  need(s.round >= (s.endVoteCooldown?.[p.id] ?? 0), "err.endVoteCooldown");
  const timeout = s.settings.turnTimeoutSec;
  s.endVote = {
    by: p.id,
    votes: { [p.id]: true },
    createdAt: c.now,
    expiresAt: timeout > 0 ? c.now + timeout * MS_PER_SEC : null,
  };
  log(c, "log.endVoteProposed", { player: p.id });
}

function voteEndGame(c: Ctx, p: PlayerState, accept: boolean): void {
  const vote = c.s.endVote;
  need(vote !== undefined, "err.endVoteNone");
  need(vote.votes[p.id] === undefined, "err.endVoteAlreadyVoted");
  vote.votes[p.id] = accept;
  if (accept) {
    log(c, "log.endVoteAgreed", { player: p.id });
  }
}

/** Drops the pending vote; its proposer may ask again after END_VOTE_COOLDOWN_ROUNDS rounds. */
function cancelEndVote(c: Ctx): void {
  const vote = c.s.endVote;
  if (vote === undefined) {
    return;
  }
  c.s.endVoteCooldown = {
    ...c.s.endVoteCooldown,
    [vote.by]: c.s.round + END_VOTE_COOLDOWN_ROUNDS,
  };
  delete c.s.endVote;
}

/**
 * Settles a pending vote: bots and away players agree on their own, one "no" cancels it, and when
 * every non-bankrupt player agreed the game is over.
 */
function resolveEndVote(c: Ctx): void {
  const vote = c.s.endVote;
  if (vote === undefined || c.s.status === "finished") {
    return;
  }
  const voters = alive(c.s);
  for (const p of voters) {
    if (p.controller !== "human" && vote.votes[p.id] === undefined) {
      vote.votes[p.id] = true;
    }
  }
  const decliner = voters.find((p) => vote.votes[p.id] === false);
  if (decliner) {
    cancelEndVote(c);
    log(c, "log.endVoteDeclined", { player: decliner.id });
  } else if (voters.every((p) => vote.votes[p.id] === true)) {
    log(c, "log.endVoteUnanimous");
    endGame(c, "vote");
  }
}

function bankrupt(c: Ctx, p: PlayerState): void {
  const s = c.s;
  const ph = s.phase;
  const creditor = ph.type === "debt" && ph.creditor ? player(c, ph.creditor) : null;
  const auctionDebt = ph.type === "debt" && ph.auctionTile !== undefined;
  const bank = s.bank;
  for (const i of playerProperties(s, p.id)) {
    const pr = propState(s, i);
    if (pr.level >= 1 && pr.level <= 4) {
      bank.houses += pr.level;
    } else if (pr.level === HOTEL_LEVEL) {
      bank.hotels++;
    } else if (pr.level === SKYSCRAPER_LEVEL) {
      bank.skyscrapers++;
    }
    if (pr.level > 0) {
      emit(c, { type: "building", tile: i, level: 0, playerId: p.id });
    }
    pr.level = 0;
    if (creditor) {
      pr.owner = creditor.id;
    } else {
      pr.owner = null;
      pr.mortgaged = false;
    }
  }
  noteActivity(c, (a) => {
    a.bankruptcies++;
  });
  releaseHoldings(c, p, creditor);
  writeOffLoans(c, p);
  if (creditor) {
    if (p.cash > 0) {
      cash(c, creditor, p.cash, "bankruptcy", p.id);
    }
    creditor.jailCards.push(...p.jailCards);
  } else {
    for (const id of p.jailCards) {
      s.decks[deckOf(id)].push(id);
    }
  }
  p.jailCards = [];
  p.cash = 0;
  p.bankrupt = true;
  p.inJail = false;
  for (const t of s.trades) {
    if (t.status === "pending" && (t.from === p.id || t.to === p.id)) {
      t.status = "cancelled";
      emit(c, { type: "trade", trade: structuredClone(t) });
    }
  }
  emit(c, { type: "bankrupt", playerId: p.id, creditor: creditor?.id ?? null });
  log(c, "log.bankrupt", { player: p.id });
  const left = alive(s);
  if (left.length <= 1) {
    return endGame(c, "last-player");
  }
  if (auctionDebt && p.id !== cur(c).id) {
    // the bidder went bankrupt, not the player whose turn it is: that turn resumes
    return finish(c);
  }
  advanceTurn(c);
}
