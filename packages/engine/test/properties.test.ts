import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOARD } from "../src/board.ts";
import { chooseBotAction } from "../src/bot.ts";
import {
  applyAction,
  applyBotAction,
  createGame,
  handleTimeout,
  legalActions,
  redactState,
  setController,
  whoMustAct,
} from "../src/game.ts";
import {
  buildBlocker,
  buildCostFor,
  groupTiles,
  rentFor,
  sellValue,
  STATION_TILES,
  UTILITY_TILES,
  unmortgageCost,
} from "../src/helpers.ts";
import { GameActionSchema } from "../src/schemas.ts";
import { DEFAULT_SETTINGS, GameError } from "../src/types.ts";
import type {
  ApplyResult,
  GameAction,
  GameEvent,
  GameSettings,
  GameState,
  PlayerId,
} from "../src/types.ts";
import { assertInvariants, candidates } from "./invariants.ts";
import { seatPlayers } from "./sim.ts";
import { give, groupOf, mk } from "./util.ts";

const SOAK = process.env["ENGINE_SOAK"] === "1";
const RUNS = (n: number): number => (SOAK ? n * 10 : n);

// ------------------------------------------------------------------ arbitraries

const settingsArb: fc.Arbitrary<GameSettings> = fc.record({
  themeId: fc.constant("ch"),
  startingCash: fc.constantFrom(500, 700, 1500, 2000, 10_000),
  goSalary: fc.constantFrom(0, 200, 500),
  doubleOnGoLanding: fc.boolean(),
  turnTimeoutSec: fc.constantFrom(0, 0, 5, 60, 3600),
  awayAfterMissedTurns: fc.integer({ min: 1, max: 4 }),
  auctions: fc.boolean(),
  freeParkingJackpot: fc.boolean(),
  evenBuild: fc.boolean(),
  buildingLimits: fc.record({
    houses: fc.constantFrom(0, 1, 4, 8, 48),
    hotels: fc.constantFrom(0, 1, 2, 16),
    skyscrapers: fc.constantFrom(0, 1, 8),
  }),
  maxRounds: fc.constantFrom(0, 0, 1, 3, 8),
  securities: fc.boolean(),
  securitiesLockRounds: fc.integer({ min: 1, max: 10 }),
  securitiesDividends: fc.boolean(),
  loans: fc.boolean(),
});

const seatsArb = fc.array(fc.constantFrom<"human" | "bot">("human", "human", "bot"), {
  minLength: 2,
  maxLength: 8,
});

interface Step {
  k: number;
  a: number;
  b: number;
  c: number;
  d: number;
}
const stepArb: fc.Arbitrary<Step> = fc.record({
  k: fc.nat(99),
  a: fc.nat(1000),
  b: fc.nat(1000),
  c: fc.integer({ min: -50, max: 3000 }),
  d: fc.nat(1000),
});
const stepsArb = fc.array(stepArb, { minLength: 1, maxLength: 160 });

const gameArb = fc.record({
  seed: fc.integer({ min: 1, max: 2 ** 30 }),
  settings: settingsArb,
  seats: seatsArb,
  steps: stepsArb,
});
type GameInput = {
  seed: number;
  settings: GameSettings;
  seats: ("human" | "bot")[];
  steps: Step[];
};

// ------------------------------------------------------------------ interpreter

const TYPES: GameAction["type"][] = [
  "roll",
  "pay-jail-fine",
  "use-jail-card",
  "buy",
  "decline-buy",
  "bid",
  "pass-auction",
  "set-auto-bid",
  "build",
  "sell-building",
  "mortgage",
  "unmortgage",
  "buy-securities",
  "sell-securities",
  "take-loan",
  "repay-loan",
  "propose-trade",
  "respond-trade",
  "cancel-trade",
  "end-turn",
  "declare-bankruptcy",
  "propose-end-game",
  "vote-end-game",
];

function arbitraryAction(s: GameState, st: Step): GameAction {
  const tile = (st.b % 56) - 2 + (st.d % 7 === 0 ? 0.5 : 0);
  const type = TYPES[st.a % TYPES.length]!;
  const pid = (): PlayerId => (st.d % 11 === 0 ? "ghost" : s.players[st.d % s.players.length]!.id);
  switch (type) {
    case "bid":
      return { type, amount: st.c };
    case "vote-end-game":
      return { type, accept: st.c % 4 !== 0 };
    case "set-auto-bid":
      return { type, max: st.d % 5 === 0 ? null : Math.abs(st.c) };
    case "build":
    case "sell-building":
    case "mortgage":
    case "unmortgage":
      return { type, tile };
    case "buy-securities":
      return {
        type,
        secId: Object.keys(s.market?.prices ?? { none: 1 })[st.b % 7] ?? "ch-nope",
        shares: (st.c % 20) - 2,
      };
    case "sell-securities":
      return {
        type,
        secId: Object.keys(s.market?.prices ?? { none: 1 })[st.b % 7] ?? "ch-nope",
        lot: st.d % 4 === 0 ? "all" : st.a % 5,
      };
    case "take-loan":
    case "repay-loan":
      return { type, amount: st.d % 3 === 0 ? st.c : (st.c % 12) * 100 };
    case "respond-trade":
      return {
        type,
        tradeId: s.trades[st.b % Math.max(1, s.trades.length)]?.id ?? "tX",
        accept: st.c % 2 === 0,
      };
    case "cancel-trade":
      return { type, tradeId: s.trades[st.b % Math.max(1, s.trades.length)]?.id ?? "tX" };
    case "counter-trade":
      return {
        type,
        tradeId: s.trades[st.b % Math.max(1, s.trades.length)]?.id ?? "tX",
        offer: {
          to: pid(),
          giveCash: Math.abs(st.c) % 400,
          giveTiles: st.b % 3 === 0 ? [] : [tile],
          giveJailCards: 0,
          wantCash: st.d % 300,
          wantTiles: st.a % 3 === 0 ? [] : [(st.a + st.b) % 52],
          wantJailCards: 0,
        },
      };
    case "propose-trade":
      return {
        type,
        offer: {
          to: pid(),
          giveCash: Math.abs(st.c) % 700,
          giveTiles: st.b % 3 === 0 ? [] : [tile],
          giveJailCards: st.d % 13 === 0 ? 1 : 0,
          wantCash: st.d % 300,
          wantTiles: st.a % 3 === 0 ? [] : [(st.a + st.b) % 52],
          wantJailCards: st.d % 17 === 0 ? 1 : 0,
        },
      };
    default:
      return { type };
  }
}

/** A trade between real owners built from current holdings (so many are actually acceptable). */
function plausibleTrade(s: GameState, st: Step): GameAction | null {
  const alive = s.players.filter((p) => !p.bankrupt);
  const from = alive[st.a % alive.length]!;
  const others = alive.filter((p) => p.id !== from.id);
  if (others.length === 0) {
    return null;
  }
  const to = others[st.b % others.length]!;
  const mine = BOARD.filter((t) => s.properties[t.index]?.owner === from.id).map((t) => t.index);
  const theirs = BOARD.filter((t) => s.properties[t.index]?.owner === to.id).map((t) => t.index);
  return {
    type: "propose-trade",
    offer: {
      to: to.id,
      giveCash: Math.abs(st.c) % 300,
      giveTiles: mine.length > 0 && st.d % 2 === 0 ? [mine[st.d % mine.length]!] : [],
      giveJailCards: 0,
      wantCash: st.d % 150,
      wantTiles:
        theirs.length > 0 && st.b % 3 !== 0 ? [theirs[Math.abs(st.c) % theirs.length]!] : [],
      wantJailCards: 0,
    },
  };
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return o;
}

interface Trace {
  state: GameState;
  events: GameEvent[];
  applied: number;
  rejected: number;
  acceptedTrades: number;
}

type StepCheck = (
  prev: GameState,
  next: GameState,
  events: GameEvent[],
  action: GameAction | null,
) => void;

function interpret(input: GameInput, check?: StepCheck): Trace {
  let now = 10_000;
  let s = deepFreeze(
    createGame("prop", seatPlayers(input.seats, input.seed), input.settings, input.seed, now).state,
  );
  assertInvariants(s);
  const events: GameEvent[] = [];
  let applied = 0;
  let rejected = 0;
  let acceptedTrades = 0;

  for (const st of input.steps) {
    if (s.status !== "running") {
      // finished games must reject everything
      expect(() => applyAction(s, s.players[0]!.id, { type: "roll" }, now)).toThrow(GameError);
      break;
    }
    now += 1 + (st.d % 4000);
    const actors = whoMustAct(s);
    const actor = actors[0]!;
    const who = st.d % 10 < 7 ? actor : s.players[st.b % s.players.length]!.id;
    const snapshot = JSON.stringify(s);
    let action: GameAction | null = null;
    let run: () => ApplyResult;
    const kind = st.k;
    if (kind < 40) {
      const types = legalActions(s, who);
      const type = types.length > 0 ? types[st.a % types.length]! : "roll";
      const cs = candidates(s, who, type);
      const a: GameAction = cs.length > 0 ? cs[st.b % cs.length]! : { type: "roll" };
      action = a;
      run = () => applyAction(s, who, a, now);
    } else if (kind < 55) {
      action = arbitraryAction(s, st);
      const a = action;
      run = () => applyAction(s, who, a, now);
    } else if (kind < 70) {
      action = plausibleTrade(s, st);
      const a = action ?? { type: "end-turn" as const };
      run = () => applyAction(s, who, a, now);
    } else if (kind < 80) {
      const accept = s.trades.filter((t) => t.status === "pending");
      const t = accept[st.a % Math.max(1, accept.length)];
      action = t
        ? { type: "respond-trade", tradeId: t.id, accept: st.c % 3 !== 0 }
        : { type: "end-turn" };
      const a = action;
      const responder = t ? t.to : who;
      run = () => applyAction(s, responder, a, now);
    } else if (kind < 88) {
      const jump = st.a * 5_000;
      now += jump;
      run = () => handleTimeout(s, now);
    } else if (kind < 96) {
      const a = chooseBotAction(s, actor);
      expect(a).not.toBeNull();
      action = a;
      run = () => applyBotAction(s, actor, a!, now);
    } else {
      const ctrl = (["human", "away", "bot"] as const)[st.a % 3]!;
      run = () => setController(s, who, ctrl, now);
    }
    let r: ApplyResult;
    try {
      r = run();
    } catch (e) {
      // invalid input: must be a domain error and must not touch the previous state
      expect(e).toBeInstanceOf(GameError);
      expect(JSON.stringify(s)).toBe(snapshot);
      rejected++;
      continue;
    }
    expect(JSON.stringify(s)).toBe(snapshot);
    const next = deepFreeze(r.state);
    assertInvariants(next, { prevVersion: next === s ? undefined : s.version });
    if (action) {
      const parsed = GameActionSchema.safeParse(action);
      if (!parsed.success && kind < 40) {
        throw new Error(`legal-derived action fails schema: ${JSON.stringify(action)}`);
      }
    }
    for (const e of r.events) {
      if (e.type === "trade" && e.trade.status === "accepted") {
        acceptedTrades++;
      }
    }
    check?.(s, next, r.events, action);
    events.push(...r.events);
    s = next;
    applied++;
  }
  return { state: s, events, applied, rejected, acceptedTrades };
}

// ------------------------------------------------------------------ properties

describe("property: arbitrary action sequences", () => {
  it("keep every invariant; invalid actions throw GameError without touching the state", () => {
    let applied = 0;
    let rejected = 0;
    let finished = 0;
    let trades = 0;
    fc.assert(
      fc.property(gameArb, (g) => {
        const t = interpret(g);
        applied += t.applied;
        rejected += t.rejected;
        trades += t.acceptedTrades;
        if (t.state.status === "finished") {
          finished++;
        }
      }),
      { numRuns: RUNS(250) },
    );
    expect(applied).toBeGreaterThan(1000);
    expect(rejected).toBeGreaterThan(100);

    console.log(
      `property sequences: applied ${applied}, rejected ${rejected}, finished ${finished}, accepted trades ${trades}`,
    );
  }, 120_000);

  it("is deterministic: same seed and actions give identical states and events", () => {
    fc.assert(
      fc.property(gameArb, (g) => {
        const a = interpret(g);
        const b = interpret(g);
        expect(b.state).toStrictEqual(a.state);
        expect(b.events).toStrictEqual(a.events);
      }),
      { numRuns: RUNS(60) },
    );
  }, 120_000);

  it("survives a JSON round trip losslessly and redacts rng and deck order", () => {
    fc.assert(
      fc.property(gameArb, (g) => {
        const { state } = interpret(g);
        expect(JSON.parse(JSON.stringify(state))).toStrictEqual(structuredClone(state));
        const pub = redactState(state);
        const walk = (o: unknown): void => {
          if (o !== null && typeof o === "object") {
            for (const [k, v] of Object.entries(o)) {
              expect(k).not.toBe("rng");
              walk(v);
            }
          }
        };
        walk(pub);
        expect(pub.decks).toEqual({
          chance: state.decks.chance.length,
          community: state.decks.community.length,
        });
        const text = JSON.stringify(pub);
        expect(text).not.toContain(`"rng"`);
        // mutating the public copy must not leak back into the engine state
        const before = JSON.stringify(state);
        (pub.players[0] as { cash: number }).cash = -1;
        pub.properties[1] = { owner: "x", level: 6, mortgaged: true };
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: RUNS(60) },
    );
  }, 120_000);

  it("accepted trades conserve cash (minus mortgage interest), jail cards and tile count and swap exactly the listed tiles", () => {
    let checked = 0;
    fc.assert(
      fc.property(gameArb, (g) => {
        interpret(g, (prev, next, events) => {
          for (const e of events) {
            if (e.type !== "trade" || e.trade.status !== "accepted") {
              continue;
            }
            const t = e.trade;
            checked++;
            const interest = [...t.giveTiles, ...t.wantTiles]
              .filter((i) => prev.properties[i]!.mortgaged)
              .reduce((a, i) => a + Math.ceil((BOARD[i]!.mortgage ?? 0) * 0.1), 0);
            const sum = (s: GameState): number =>
              s.players
                .filter((p) => p.id === t.from || p.id === t.to)
                .reduce((a, p) => a + p.cash, 0);
            const debtPaid =
              prev.phase.type === "debt" && next.phase.type !== "debt" ? prev.phase.amount : 0;
            expect(sum(next)).toBe(
              sum(prev) -
                interest -
                (prev.phase.type === "debt" &&
                (prev.phase.debtor === t.from || prev.phase.debtor === t.to)
                  ? debtPaid
                  : 0) +
                creditorShare(prev, next, t.from, t.to, debtPaid),
            );
            for (const i of t.giveTiles) {
              expect(prev.properties[i]!.owner).toBe(t.from);
              expect(next.properties[i]!.owner).toBe(t.to);
            }
            for (const i of t.wantTiles) {
              expect(prev.properties[i]!.owner).toBe(t.to);
              expect(next.properties[i]!.owner).toBe(t.from);
            }
            const listed = new Set([...t.giveTiles, ...t.wantTiles]);
            for (const [i, pr] of Object.entries(next.properties)) {
              if (!listed.has(Number(i))) {
                expect(pr.owner).toBe(prev.properties[Number(i)]!.owner);
              }
            }
            const jail = (s: GameState): number =>
              s.players.reduce((a, p) => a + p.jailCards.length, 0);
            expect(jail(next)).toBe(jail(prev));
            const owned = (s: GameState): number =>
              Object.values(s.properties).filter((p) => p.owner !== null).length;
            expect(owned(next)).toBe(owned(prev));
          }
        });
      }),
      { numRuns: RUNS(150) },
    );
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});

/** cash the trade parties receive from settling a debt of the other side (debtor pays, creditor is one of the parties) */
function creditorShare(
  prev: GameState,
  next: GameState,
  from: PlayerId,
  to: PlayerId,
  debtPaid: number,
): number {
  if (prev.phase.type !== "debt" || next.phase.type === "debt" || debtPaid === 0) {
    return 0;
  }
  const c = prev.phase.creditor;
  return c !== null && (c === from || c === to) ? debtPaid : 0;
}

describe("property: pure rules", () => {
  it("rent never decreases with more buildings, more stations or more utilities", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (dice) => {
        for (const t of BOARD.filter((x) => x.kind === "street")) {
          const s = mk(2);
          give(s, "p1", groupTiles(t.group!));
          let last = 0;
          for (let level = 0; level <= 6; level++) {
            s.properties[t.index]!.level = level as 0;
            const r = rentFor(s, t.index, dice);
            expect(r).toBeGreaterThanOrEqual(last);
            last = r;
          }
        }
        const s = mk(2);
        let last = 0;
        for (const i of STATION_TILES) {
          s.properties[i]!.owner = "p1";
          const r = rentFor(s, STATION_TILES[0]!, dice);
          expect(r).toBeGreaterThanOrEqual(last);
          last = r;
        }
        last = 0;
        for (const i of UTILITY_TILES) {
          s.properties[i]!.owner = "p1";
          const r = rentFor(s, UTILITY_TILES[0]!, dice);
          expect(r).toBeGreaterThanOrEqual(last);
          last = r;
        }
      }),
      { numRuns: RUNS(11) },
    );
  });

  it("build then sell on the same street restores level and bank stock; cash changes by sellValue - buildCost", () => {
    let roundTrips = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 40 }),
        fc.boolean(),
        fc.record({
          houses: fc.constantFrom(4, 12, 48),
          hotels: fc.constantFrom(1, 3, 16),
          skyscrapers: fc.constantFrom(1, 3, 8),
        }),
        fc.nat(1000),
        (group, prebuilt, evenBuild, limits, pick) => {
          let s = mk(2, { evenBuild, buildingLimits: limits, startingCash: 10_000 });
          s.players[0]!.cash = 1_000_000;
          give(s, "p0", groupOf(group));
          // pre-build in rotation so uneven levels occur when evenBuild is off
          for (let i = 0; i < prebuilt; i++) {
            const open = groupOf(group).filter((t) => buildBlocker(s, "p0", t) === null);
            if (open.length === 0) {
              break;
            }
            const t = open[(i * 7 + pick) % open.length]!;
            s = applyAction(s, "p0", { type: "build", tile: t }, 5).state;
          }
          const open = groupOf(group).filter((t) => buildBlocker(s, "p0", t) === null);
          if (open.length === 0) {
            return;
          }
          const tile = open[pick % open.length]!;
          const built = applyAction(s, "p0", { type: "build", tile }, 6).state;
          const level = built.properties[tile]!.level;
          const sold = applyAction(built, "p0", { type: "sell-building", tile }, 7).state;
          roundTrips++;
          expect(sold.properties[tile]!.level).toBe(s.properties[tile]!.level);
          expect(sold.bank).toEqual(s.bank);
          expect(sold.players[0]!.cash).toBe(
            s.players[0]!.cash - buildCostFor(BOARD[tile]!, level) + sellValue(BOARD[tile]!, level),
          );
          assertInvariants(sold);
        },
      ),
      { numRuns: RUNS(300) },
    );
    expect(roundTrips).toBeGreaterThan(50);
  }, 120_000);

  it("mortgage then unmortgage costs exactly the interest on the mortgage value", () => {
    const buyable = BOARD.filter((t) => t.price !== undefined).map((t) => t.index);
    fc.assert(
      fc.property(fc.constantFrom(...buyable), (tile) => {
        const s = mk(2);
        give(s, "p0", [tile]);
        const m = applyAction(s, "p0", { type: "mortgage", tile }, 5).state;
        expect(m.players[0]!.cash).toBe(2000 + BOARD[tile]!.mortgage!);
        const u = applyAction(m, "p0", { type: "unmortgage", tile }, 6).state;
        const interest = Math.ceil(BOARD[tile]!.mortgage! * 0.1);
        expect(u.players[0]!.cash).toBe(2000 - interest);
        expect(unmortgageCost(BOARD[tile]!)).toBe(BOARD[tile]!.mortgage! + interest);
        expect(u.properties[tile]!.mortgaged).toBe(false);
      }),
      { numRuns: buyable.length },
    );
  });

  it("every action the bots choose passes the wire schema", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 2, max: 6 }), (seed, n) => {
        let s = createGame(
          "b",
          seatPlayers(
            Array.from({ length: n }, () => "bot" as const),
            seed,
          ),
          { ...DEFAULT_SETTINGS, turnTimeoutSec: 0 },
          seed,
          0,
        ).state;
        for (let i = 0; i < 400 && s.status === "running"; i++) {
          const pid = whoMustAct(s)[0]!;
          const a = chooseBotAction(s, pid)!;
          expect(GameActionSchema.safeParse(a).success).toBe(true);
          s = applyBotAction(s, pid, a, i).state;
        }
      }),
      { numRuns: RUNS(25) },
    );
  }, 120_000);
});
