/**
 * Scenario DSL: readable given / when / then unit tests over the real engine.
 *
 *   given()
 *     .players("Anna", "Ben", "Bot Heidi")
 *     .player("Anna").owns(group(4)).withLevel(5).cash(300)
 *     .player("Ben").at(19).cash(1000)
 *     .when("Ben").rolls(1, 2)
 *     .then().pays("Ben", "Anna", rentOf(22, 5)).phase().is("await-end-turn");
 *
 * Players are addressed by name; ids are internal. Names starting with "Bot " are bots.
 * assertInvariants runs automatically after every step.
 */
import { expect } from "vitest";
import { BOARD } from "../src/board.ts";
import {
  applyAction,
  createGame,
  handleTimeout,
  legalActions,
  setController,
} from "../src/game.ts";
import { groupTiles } from "../src/helpers.ts";
import { rollDie } from "../src/rng.ts";
import { DEFAULT_SETTINGS, JAIL_INDEX } from "../src/types.ts";
import type {
  ApplyResult,
  Controller,
  Holding,
  Market,
  GameAction,
  GameEvent,
  GameSettings,
  GameState,
  NewPlayer,
  PlayerId,
  PlayerState,
  TradeOffer,
  TurnPhase,
} from "../src/types.ts";
import { assertInvariants } from "./invariants.ts";

// ------------------------------------------------------------------ small helpers

/** Street tile indices of colour group `g`. */
export function group(g: number): number[] {
  return groupTiles(g);
}

/** Rent printed on the board for a street at building `level` (0 = base rent). */
export function rentOf(tile: number, level = 0): number {
  const rent = BOARD[tile]?.rent?.[level];
  if (rent === undefined) {
    throw new Error(`no rent for tile ${tile} level ${level}`);
  }
  return rent;
}

/** Set the rng so that the next roll yields (a, b). */
function rigDice(s: GameState, a: number, b: number): void {
  for (let r = 1; r < 200_000; r++) {
    const x = rollDie(r);
    if (x.value !== a) {
      continue;
    }
    if (rollDie(x.rng).value === b) {
      s.rng = r;
      return;
    }
  }
  throw new Error(`no rng found for dice ${a},${b}`);
}

export const emptyOffer = (to: PlayerId): TradeOffer => ({
  to,
  giveCash: 0,
  giveTiles: [],
  giveJailCards: 0,
  wantCash: 0,
  wantTiles: [],
  wantJailCards: 0,
});

type JailCardId = "ch-jail-card" | "cc-jail-card";
type OfferSpec = Partial<Omit<TradeOffer, "to">>;
type PhaseType = TurnPhase["type"];
type EventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

// ------------------------------------------------------------------ shared context

interface Ctx {
  /** player name -> id */
  ids: ReadonlyMap<string, PlayerId>;
  state: GameState;
  /** state before the last step */
  before: GameState;
  events: GameEvent[];
  now: number;
  /** player of the last `when`, default actor for `rejects` */
  actor: string | null;
}

function idOf(ctx: Pick<Ctx, "ids">, name: string): PlayerId {
  const id = ctx.ids.get(name);
  if (id === undefined) {
    throw new Error(`unknown player "${name}"; known: ${[...ctx.ids.keys()].join(", ")}`);
  }
  return id;
}

function playerOf(ctx: Ctx, name: string, state: GameState = ctx.state): PlayerState {
  const id = idOf(ctx, name);
  const p = state.players.find((x) => x.id === id);
  if (!p) {
    throw new Error(`player ${name} not in state`);
  }
  return p;
}

function step(ctx: Ctx, run: (s: GameState) => ApplyResult): void {
  const before = ctx.state;
  const r = run(before);
  ctx.before = before;
  ctx.state = r.state;
  ctx.events = r.events;
  assertInvariants(r.state, { lastNow: ctx.now, prevVersion: before.version });
}

// ------------------------------------------------------------------ given

type Tweak = (s: GameState) => void;

export class Given {
  private names: string[] = [];
  private overrides: Partial<GameSettings> = {};
  private readonly tweaks: Array<(s: GameState, ids: ReadonlyMap<string, PlayerId>) => void> = [];
  private subject: string | null = null;
  private lastTiles: number[] = [];
  private nowMs = 2000;

  players(...names: string[]): this {
    this.names = names;
    return this;
  }

  theme(themeId: string): this {
    return this.settings({ themeId });
  }

  settings(over: Partial<GameSettings>): this {
    this.overrides = { ...this.overrides, ...over };
    return this;
  }

  /** Clock used for the steps of the scenario. */
  clock(ms: number): this {
    this.nowMs = ms;
    return this;
  }

  /** Select the player the following setup calls apply to. */
  player(name: string): this {
    this.subject = name;
    this.lastTiles = [];
    return this;
  }

  cash(amount: number): this {
    return this.onPlayer((p) => {
      p.cash = amount;
    });
  }

  at(tile: number): this {
    return this.onPlayer((p) => {
      p.position = tile;
    });
  }

  /** Subject owns these tiles (a tile or a list, e.g. `group(4)`). */
  owns(tiles: number | number[]): this {
    const list = Array.isArray(tiles) ? tiles : [tiles];
    this.lastTiles = list;
    const name = this.subjectName();
    this.tweaks.push((s, ids) => {
      for (const t of list) {
        propOf(s, t).owner = idFrom(ids, name);
      }
    });
    return this;
  }

  /** All tiles of the last `owns` get this building level. */
  withLevel(level: number): this {
    const tiles = this.lastTiles;
    this.tweaks.push((s) => {
      for (const t of tiles) {
        propOf(s, t).level = level as GameState["properties"][number]["level"];
      }
    });
    return this;
  }

  /** Per-tile building levels for the last `owns`, in order. */
  withLevels(...levels: number[]): this {
    const tiles = this.lastTiles;
    this.tweaks.push((s) => {
      tiles.forEach((t, i) => {
        propOf(s, t).level = (levels[i] ?? 0) as GameState["properties"][number]["level"];
      });
    });
    return this;
  }

  /** All tiles of the last `owns` are mortgaged. */
  mortgaged(): this {
    const tiles = this.lastTiles;
    this.tweaks.push((s) => {
      for (const t of tiles) {
        propOf(s, t).mortgaged = true;
      }
    });
    return this;
  }

  inJail(jailTurns = 0): this {
    return this.onPlayer((p) => {
      p.inJail = true;
      p.position = JAIL_INDEX;
      p.jailTurns = jailTurns;
    });
  }

  /** Hand the subject a jail card (taken out of its deck). */
  jailCard(id: JailCardId): this {
    const name = this.subjectName();
    this.tweaks.push((s, ids) => {
      const deck = id === "ch-jail-card" ? "chance" : "community";
      s.decks[deck] = s.decks[deck].filter((x) => x !== id);
      playerIn(s, idFrom(ids, name)).jailCards.push(id);
    });
    return this;
  }

  /** The subject is away (played by a bot). */
  away(): this {
    return this.onPlayer((p) => {
      p.controller = "away";
    });
  }

  bankrupt(): this {
    return this.onPlayer((p) => {
      p.bankrupt = true;
      p.cash = 0;
    });
  }

  /** Put card `id` on top of its deck. */
  nextCard(deck: "chance" | "community", id: string): this {
    this.tweaks.push((s) => {
      const d = s.decks[deck];
      const i = d.indexOf(id);
      if (i < 0) {
        throw new Error(`card ${id} not in deck ${deck}`);
      }
      d.splice(i, 1);
      d.unshift(id);
    });
    return this;
  }

  /** Current player and turn state, e.g. after a double: `turnState(1, [2, 2], {...})`. */
  turnState(doublesCount: number, dice: [number, number], phase: TurnPhase): this {
    return this.tweak((s) => {
      s.doublesCount = doublesCount;
      s.dice = dice;
      s.phase = phase;
    });
  }

  /** Securities mode on (docs/DESIGN.md #48), lock-up in rounds. */
  securities(lockRounds = 3): this {
    return this.settings({ securities: true, securitiesLockRounds: lockRounds });
  }

  /** Current round (the lock-up counts in rounds). */
  round(n: number): this {
    return this.tweak((s) => {
      s.round = n;
    });
  }

  /** Market price of a security (history follows so the change since last round stays 0). */
  price(secId: string, price: number): this {
    return this.tweak((s) => {
      const m = marketOf(s);
      m.prices[secId] = price;
      m.history[secId] = [price];
    });
  }

  /** The subject holds a lot of `shares` of `secId` bought at `buyPrice` in round `boughtRound`. */
  holds(secId: string, shares: number, buyPrice: number, boughtRound: number): this {
    const name = this.subjectName();
    this.tweaks.push((s, ids) => {
      const p = playerIn(s, idFrom(ids, name));
      (p.holdings ??= []).push({ secId, shares, buyPrice, boughtRound });
    });
    return this;
  }

  /** Escape hatch for setup the DSL does not cover. */
  tweak(fn: Tweak): this {
    this.tweaks.push((s) => fn(s));
    return this;
  }

  when(name: string): Actor {
    return this.build().when(name);
  }

  then(): Expectations {
    return this.build().then();
  }

  build(): Scenario {
    const names = this.names.length > 0 ? this.names : ["Anna", "Ben"];
    const ids = new Map(names.map((n, i): [string, PlayerId] => [n, `p${i}`]));
    const newPlayers: NewPlayer[] = names.map((name, i) => ({
      id: `p${i}`,
      name,
      color: "#fff",
      tokenId: `t${i}`,
      controller: name.startsWith("Bot ") ? "bot" : "human",
      botLevel: "normal",
    }));
    const state = createGame(
      "g",
      newPlayers,
      { ...DEFAULT_SETTINGS, ...this.overrides },
      12345,
      1000,
    ).state;
    for (const t of this.tweaks) {
      t(state, ids);
    }
    syncBank(state);
    const ctx: Ctx = {
      ids,
      state,
      before: state,
      events: [],
      now: this.nowMs,
      actor: null,
    };
    return new Scenario(ctx);
  }

  private onPlayer(fn: (p: PlayerState) => void): this {
    const name = this.subjectName();
    this.tweaks.push((s, ids) => fn(playerIn(s, idFrom(ids, name))));
    return this;
  }

  private subjectName(): string {
    if (this.subject === null) {
      throw new Error('select a player first: .player("Anna")');
    }
    return this.subject;
  }
}

export function given(): Given {
  return new Given();
}

function idFrom(ids: ReadonlyMap<string, PlayerId>, name: string): PlayerId {
  return idOf({ ids }, name);
}

function propOf(s: GameState, tile: number): GameState["properties"][number] {
  const pr = s.properties[tile];
  if (!pr) {
    throw new Error(`tile ${tile} is not buyable`);
  }
  return pr;
}

function marketOf(s: GameState): Market {
  if (!s.market) {
    throw new Error("securities mode is off: .securities() first");
  }
  return s.market;
}

function playerIn(s: GameState, id: PlayerId): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) {
    throw new Error(`no player ${id}`);
  }
  return p;
}

/** Recompute the bank stock from the building levels so hand-built boards stay consistent. */
function syncBank(s: GameState): void {
  let houses = 0;
  let hotels = 0;
  let skyscrapers = 0;
  for (const pr of Object.values(s.properties)) {
    if (pr.level >= 1 && pr.level <= 4) {
      houses += pr.level;
    } else if (pr.level === 5) {
      hotels++;
    } else if (pr.level === 6) {
      skyscrapers++;
    }
  }
  const lim = s.settings.buildingLimits;
  s.bank = {
    houses: lim.houses - houses,
    hotels: lim.hotels - hotels,
    skyscrapers: lim.skyscrapers - skyscrapers,
  };
}

// ------------------------------------------------------------------ when

export class Scenario {
  private readonly ctx: Ctx;
  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  /** Raw state for custom assertions. */
  get state(): GameState {
    return this.ctx.state;
  }

  /** Readability sugar between steps. */
  and(): this {
    return this;
  }

  when(name: string): Actor {
    idOf(this.ctx, name);
    this.ctx.actor = name;
    return new Actor(this, this.ctx, name);
  }

  /** Continue the scenario at another point in time. */
  atTime(ms: number): this {
    this.ctx.now = ms;
    return this;
  }

  /** The clock runs out: the engine lets a bot act for whoever must act. */
  timesOut(atMs: number): Scenario {
    this.ctx.now = atMs;
    step(this.ctx, (s) => handleTimeout(s, atMs));
    return this;
  }

  /** A player's controller changes (e.g. back from away); `at` defaults to the clock. */
  setsController(name: string, controller: Controller, at?: number): Scenario {
    const id = idOf(this.ctx, name);
    const now = at ?? this.ctx.now;
    this.ctx.now = now;
    step(this.ctx, (s) => setController(s, id, controller, now));
    return this;
  }

  /** Change state between steps (e.g. a property changes owner behind a pending trade). */
  meanwhile(fn: Tweak): Scenario {
    fn(this.ctx.state);
    syncBank(this.ctx.state);
    return this;
  }

  then(): Expectations {
    return new Expectations(this, this.ctx);
  }
}

export class Actor {
  private readonly scenario: Scenario;
  private readonly ctx: Ctx;
  private readonly name: string;
  constructor(scenario: Scenario, ctx: Ctx, name: string) {
    this.scenario = scenario;
    this.ctx = ctx;
    this.name = name;
  }

  /** Roll with the dice rigged to show (a, b). */
  rolls(a: number, b: number): Scenario {
    const rigged = structuredClone(this.ctx.state);
    rigDice(rigged, a, b);
    this.ctx.state = rigged;
    return this.does({ type: "roll" });
  }

  does(action: GameAction): Scenario {
    const id = idOf(this.ctx, this.name);
    step(this.ctx, (s) => applyAction(s, id, action, this.ctx.now));
    return this.scenario;
  }

  buys(): Scenario {
    return this.does({ type: "buy" });
  }

  declinesToBuy(): Scenario {
    return this.does({ type: "decline-buy" });
  }

  bids(amount: number): Scenario {
    return this.does({ type: "bid", amount });
  }

  passesAuction(): Scenario {
    return this.does({ type: "pass-auction" });
  }

  /** Proxy bidding: bid up to `max` automatically whenever it is this player's turn to bid. */
  setsAutoBid(max: number): Scenario {
    return this.does({ type: "set-auto-bid", max });
  }

  cancelsAutoBid(): Scenario {
    return this.does({ type: "set-auto-bid", max: null });
  }

  buysSecurities(secId: string, shares: number): Scenario {
    return this.does({ type: "buy-securities", secId, shares });
  }

  /** Sell the lot at index `lot` of the portfolio, or all lots of `secId`. */
  sellsSecurities(secId: string, lot: number | "all" = "all"): Scenario {
    return this.does({ type: "sell-securities", secId, lot });
  }

  endsTurn(): Scenario {
    return this.does({ type: "end-turn" });
  }

  /** Asks for a vote to end the game (the proposer agrees implicitly). */
  proposesEndGame(): Scenario {
    return this.does({ type: "propose-end-game" });
  }

  agreesToEndGame(): Scenario {
    return this.does({ type: "vote-end-game", accept: true });
  }

  refusesToEndGame(): Scenario {
    return this.does({ type: "vote-end-game", accept: false });
  }

  declaresBankruptcy(): Scenario {
    return this.does({ type: "declare-bankruptcy" });
  }

  proposesTrade(to: string, offer: OfferSpec): Scenario {
    return this.does({
      type: "propose-trade",
      offer: { ...emptyOffer(idOf(this.ctx, to)), ...offer },
    });
  }

  /** Accept the nth (default: first) pending trade addressed to this player. */
  acceptsTrade(nth = 0): Scenario {
    return this.respond(true, nth);
  }

  declinesTrade(nth = 0): Scenario {
    return this.respond(false, nth);
  }

  /** Answer the nth pending trade addressed to this player with a counteroffer to its proposer. */
  countersTrade(offer: OfferSpec, nth = 0): Scenario {
    const id = idOf(this.ctx, this.name);
    const trade = this.ctx.state.trades.filter((t) => t.status === "pending" && t.to === id)[nth];
    if (!trade) {
      throw new Error(`${this.name} has no pending trade #${nth}`);
    }
    return this.does({
      type: "counter-trade",
      tradeId: trade.id,
      offer: { ...emptyOffer(trade.from), ...offer },
    });
  }

  private respond(accept: boolean, nth: number): Scenario {
    const id = idOf(this.ctx, this.name);
    const pending = this.ctx.state.trades.filter((t) => t.status === "pending" && t.to === id);
    const trade = pending[nth];
    if (!trade) {
      throw new Error(`${this.name} has no pending trade #${nth}`);
    }
    return this.does({ type: "respond-trade", tradeId: trade.id, accept });
  }
}

// ------------------------------------------------------------------ then

/** Assertion on a value read from the state; `.is` returns to the expectations chain. */
class Check<T> {
  private readonly back: Expectations;
  private readonly label: string;
  private readonly read: () => T;

  constructor(back: Expectations, label: string, read: () => T) {
    this.back = back;
    this.label = label;
    this.read = read;
  }

  is(expected: T): Expectations {
    expect(this.read(), this.label).toEqual(expected);
    return this.back;
  }

  /** Partial structural match, e.g. `.phase().matches({ type: "debt", amount: 100 })`. */
  matches(expected: Partial<T>): Expectations {
    expect(this.read(), this.label).toMatchObject(expected as Record<string, unknown>);
    return this.back;
  }
}

class ActionTypes {
  private readonly back: Expectations;
  private readonly label: string;
  private readonly read: () => GameAction["type"][];

  constructor(back: Expectations, label: string, read: () => GameAction["type"][]) {
    this.back = back;
    this.label = label;
    this.read = read;
  }

  contains(...types: GameAction["type"][]): Expectations {
    expect(this.read(), this.label).toEqual(expect.arrayContaining(types));
    return this.back;
  }

  excludes(...types: GameAction["type"][]): Expectations {
    for (const t of types) {
      expect(this.read(), this.label).not.toContain(t);
    }
    return this.back;
  }

  is(types: GameAction["type"][]): Expectations {
    expect([...this.read()].sort(), this.label).toEqual([...types].sort());
    return this.back;
  }
}

export class Expectations {
  private readonly scenario: Scenario;
  private readonly ctx: Ctx;
  constructor(scenario: Scenario, ctx: Ctx) {
    this.scenario = scenario;
    this.ctx = ctx;
  }

  /** Continue with another step. */
  when(name: string): Actor {
    return this.scenario.when(name);
  }

  /** Back to the scenario for non-actor steps: `timesOut`, `meanwhile`, `setsController`. */
  and(): Scenario {
    return this.scenario;
  }

  cash(name: string): Check<number> {
    return new Check(this, `cash of ${name}`, () => playerOf(this.ctx, name).cash);
  }

  position(name: string): Check<number> {
    return new Check(this, `position of ${name}`, () => playerOf(this.ctx, name).position);
  }

  inJail(name: string): Check<boolean> {
    return new Check(this, `${name} in jail`, () => playerOf(this.ctx, name).inJail);
  }

  jailCards(name: string): Check<string[]> {
    return new Check(this, `jail cards of ${name}`, () => [
      ...playerOf(this.ctx, name).jailCards.sort(),
    ]);
  }

  bankrupt(name: string): Check<boolean> {
    return new Check(this, `${name} bankrupt`, () => playerOf(this.ctx, name).bankrupt);
  }

  missedTurns(name: string): Check<number> {
    return new Check(this, `missed turns of ${name}`, () => playerOf(this.ctx, name).missedTurns);
  }

  /** Owner of a tile by player name, or null for the bank. */
  owner(tile: number): Check<string | null> {
    return new Check(this, `owner of tile ${tile}`, () => {
      const owner = propOf(this.ctx.state, tile).owner;
      if (owner === null) {
        return null;
      }
      const name = [...this.ctx.ids].find(([, id]) => id === owner)?.[0];
      return name ?? owner;
    });
  }

  level(tile: number): Check<number> {
    return new Check(this, `level of tile ${tile}`, () => propOf(this.ctx.state, tile).level);
  }

  isMortgaged(tile: number): Check<boolean> {
    return new Check(this, `tile ${tile} mortgaged`, () => propOf(this.ctx.state, tile).mortgaged);
  }

  /** The securities lots of a player, in portfolio order. */
  holdings(name: string): Check<Holding[]> {
    return new Check(this, `holdings of ${name}`, () => playerOf(this.ctx, name).holdings ?? []);
  }

  /** Market price of a security. */
  price(secId: string): Check<number> {
    return new Check(
      this,
      `price of ${secId}`,
      () => marketOf(this.ctx.state).prices[secId] ?? NaN,
    );
  }

  /** Auto-bid maximum of a player in the running auction (undefined = none). */
  autoBid(name: string): Check<number | undefined> {
    const id = idOf(this.ctx, name);
    return new Check(this, `auto-bid of ${name}`, () => {
      const ph = this.ctx.state.phase;
      return ph.type === "auction" ? ph.auction.autoBids?.[id] : undefined;
    });
  }

  /** The auction as a plain view with player names, e.g. `{ highestBid: 110, highestBidder: "Anna", turn: "Ben" }`. */
  auction(): Check<{
    highestBid: number;
    highestBidder: string | null;
    turn: string;
    bidders: string[];
  }> {
    const nameOf = (id: string): string => [...this.ctx.ids].find(([, v]) => v === id)?.[0] ?? id;
    return new Check(this, "auction", () => {
      const ph = this.ctx.state.phase;
      if (ph.type !== "auction") {
        throw new Error(`no auction running (phase ${ph.type})`);
      }
      const a = ph.auction;
      return {
        highestBid: a.highestBid,
        highestBidder: a.highestBidder === null ? null : nameOf(a.highestBidder),
        turn: nameOf(a.turn),
        bidders: a.bidders.map(nameOf),
      };
    });
  }

  /** The newest log entry carries this structured message key. */
  lastLogKey(key: string): Expectations {
    expect(this.ctx.state.log.at(-1)?.msg?.key, "key of the newest log entry").toBe(key);
    return this;
  }

  phase(): Check<TurnPhase> {
    return new Check(this, "phase", () => this.ctx.state.phase);
  }

  phaseType(): Check<PhaseType> {
    return new Check(this, "phase type", () => this.ctx.state.phase.type);
  }

  status(): Check<GameState["status"]> {
    return new Check(this, "status", () => this.ctx.state.status);
  }

  /** Winner by name, null for none; only valid in the game-over phase. */
  winner(): Check<string | null> {
    return new Check(this, "winner", () => {
      const ph = this.ctx.state.phase;
      if (ph.type !== "game-over") {
        throw new Error(`game is not over (phase ${ph.type})`);
      }
      if (ph.winner === null) {
        return null;
      }
      return [...this.ctx.ids].find(([, id]) => id === ph.winner)?.[0] ?? ph.winner;
    });
  }

  /** The pending end-game vote with player names; undefined when none is running. */
  endVote(): Check<
    { by: string; votes: Record<string, boolean>; expiresAt: number | null } | undefined
  > {
    const nameOf = (id: string): string => [...this.ctx.ids].find(([, v]) => v === id)?.[0] ?? id;
    return new Check(this, "end vote", () => {
      const v = this.ctx.state.endVote;
      if (v === undefined) {
        return undefined;
      }
      return {
        by: nameOf(v.by),
        votes: Object.fromEntries(Object.entries(v.votes).map(([k, x]) => [nameOf(k), x])),
        expiresAt: v.expiresAt,
      };
    });
  }

  /** Final ranking (player names, best first); only valid in the game-over phase. */
  ranking(): Check<string[]> {
    const nameOf = (id: string): string => [...this.ctx.ids].find(([, v]) => v === id)?.[0] ?? id;
    return new Check(this, "ranking", () => {
      const ph = this.ctx.state.phase;
      if (ph.type !== "game-over") {
        throw new Error(`game is not over (phase ${ph.type})`);
      }
      return (ph.results ?? []).map((r) => nameOf(r.playerId));
    });
  }

  deadline(): Check<number | null> {
    return new Check(this, "deadline", () => this.ctx.state.deadline);
  }

  freeParkingPot(): Check<number> {
    return new Check(this, "rest-stop pot", () => this.ctx.state.freeParkingPot);
  }

  /** Trade statuses in creation order. */
  trades(): Check<string[]> {
    return new Check(this, "trade statuses", () => this.ctx.state.trades.map((t) => t.status));
  }

  /** Counter chain of every trade: `<status>@<depth>` (depth 0 = original offer). */
  tradeChain(): Check<string[]> {
    return new Check(this, "trade chain", () =>
      this.ctx.state.trades.map((t) => `${t.status}@${t.counterDepth ?? 0}`),
    );
  }

  bank(): Check<GameState["bank"]> {
    return new Check(this, "bank stock", () => this.ctx.state.bank);
  }

  /** Players listed here are asked to act, in this order. */
  legal(name: string): ActionTypes {
    const id = idOf(this.ctx, name);
    return new ActionTypes(this, `legal actions of ${name}`, () =>
      legalActions(this.ctx.state, id),
    );
  }

  /** `from` paid `to` exactly `amount` in the last step (cash deltas). */
  pays(from: string, to: string, amount: number): Expectations {
    const delta = (name: string): number =>
      playerOf(this.ctx, name).cash - playerOf(this.ctx, name, this.ctx.before).cash;
    expect(delta(from), `${from} paid`).toBe(-amount);
    expect(delta(to), `${to} received`).toBe(amount);
    return this;
  }

  /** An event of the last step matches; player names in `match` are mapped to ids. */
  emitted<T extends GameEvent["type"]>(type: T, match: Partial<EventOf<T>> = {}): Expectations {
    const mapped = mapNames(match, this.ctx.ids);
    expect(this.ctx.events, `events of last step`).toEqual(
      expect.arrayContaining([expect.objectContaining({ type, ...mapped })]),
    );
    return this;
  }

  didNotEmit(type: GameEvent["type"]): Expectations {
    expect(this.ctx.events.map((e) => e.type)).not.toContain(type);
    return this;
  }

  /**
   * The action is rejected with a GameError matching `message`, and the state stays untouched.
   * `by` defaults to the player of the last `when`, else the current player.
   */
  rejects(action: GameAction, message: RegExp | string, by?: string): Expectations {
    const name = by ?? this.ctx.actor ?? this.currentName();
    const id = idOf(this.ctx, name);
    const snapshot = structuredClone(this.ctx.state);
    expect(() => applyAction(this.ctx.state, id, action, this.ctx.now)).toThrow(message);
    expect(this.ctx.state, "rejected action must not change the state").toEqual(snapshot);
    return this;
  }

  /** `by` cannot respond to the nth trade of the game any more (e.g. it became invalid). */
  rejectsTradeResponse(by: string, nth: number, message: RegExp | string): Expectations {
    const trade = this.ctx.state.trades[nth];
    if (!trade) {
      throw new Error(`no trade #${nth}`);
    }
    return this.rejects({ type: "respond-trade", tradeId: trade.id, accept: true }, message, by);
  }

  /** Custom assertion on the raw state. */
  that(check: (s: GameState) => void): Expectations {
    check(this.ctx.state);
    return this;
  }

  /** Name of the player whose turn it is. */
  private currentName(): string {
    const id = this.ctx.state.players[this.ctx.state.current]?.id;
    const name = [...this.ctx.ids].find(([, v]) => v === id)?.[0];
    if (name === undefined) {
      throw new Error("no current player");
    }
    return name;
  }
}

function mapNames(value: unknown, ids: ReadonlyMap<string, PlayerId>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? (ids.get(v) ?? v) : v;
  }
  return out;
}
