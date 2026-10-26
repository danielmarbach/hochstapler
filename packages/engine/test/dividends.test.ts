// Dividends of the securities mode (docs/DESIGN.md #83): yield curve, round-end payout, events.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction } from "../src/game.ts";
import {
  DIVIDEND_BASE_PERMILLE,
  DIVIDEND_MIN_RATIO_PERCENT,
  SECURITY_SECTORS,
  dividendFor,
  dividendYieldPermille,
  expectedDividend,
} from "../src/securities.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { GameEvent, GameSettings, GameState } from "../src/types.ts";
import { formatMessage } from "../src/i18n/index.ts";
import { mk } from "./util.ts";

const PILATUS = "ch-pilatus"; // tourism, start 80
const GOTTHARD = "ch-gotthard"; // energy, start 70
const KRYPTO = "ch-krypto"; // bank, start 100
const awaitEndTurn = { type: "await-end-turn", canRollAgain: false } as const;
const RUNS = (n: number): number => (process.env["FAST"] ? Math.ceil(n / 10) : n);

function setup(over: Partial<GameSettings> = {}): GameState {
  const s = mk(2, { securities: true, ...over });
  s.current = 1;
  s.phase = awaitEndTurn;
  return s;
}

/** Anna (p0) holds the lot; Ben (p1) ends the round. */
function hold(s: GameState, secId: string, shares: number, boughtRound = 1): void {
  const p = s.players[0];
  if (!p) {
    throw new Error("setup");
  }
  (p.holdings ??= []).push({ secId, shares, buyPrice: 50, boughtRound });
}

function setPrice(s: GameState, secId: string, price: number): void {
  if (s.market) {
    s.market.prices[secId] = price;
    s.market.history[secId] = [price];
  }
}

function endRound(s: GameState): { state: GameState; events: GameEvent[] } {
  return applyAction(s, "p1", { type: "end-turn" }, 2000);
}

const isSpecial = (s: GameState): boolean =>
  s.log.some((l) => l.msg?.key === "log.dividendSpecial");
const isSuspended = (s: GameState): boolean =>
  s.log.some((l) => l.msg?.key === "log.dividendSuspended");

describe("Dividends: yield curve", () => {
  it("defaults on (effective only with the securities mode)", () => {
    expect(DEFAULT_SETTINGS.securitiesDividends).toBe(true);
  });

  it("has a base yield per sector: steady for energy/rail/real estate, medium for banks, none for tech", () => {
    expect(DIVIDEND_BASE_PERMILLE.energy).toBeGreaterThanOrEqual(DIVIDEND_BASE_PERMILLE.bank);
    expect(DIVIDEND_BASE_PERMILLE.bank).toBeGreaterThan(DIVIDEND_BASE_PERMILLE.tourism);
    expect(DIVIDEND_BASE_PERMILLE.tourism).toBeGreaterThan(DIVIDEND_BASE_PERMILLE.tech);
    expect(DIVIDEND_BASE_PERMILLE.tech).toBe(0);
    for (const sector of SECURITY_SECTORS) {
      expect(DIVIDEND_BASE_PERMILLE[sector]).toBeLessThanOrEqual(40);
    }
  });

  it("pays the base yield at the issue price, more above and less below it", () => {
    const base = DIVIDEND_BASE_PERMILLE.energy;
    expect(dividendYieldPermille("energy", 100, 100)).toBe(base);
    expect(dividendYieldPermille("energy", 130, 100)).toBeGreaterThan(base);
    expect(dividendYieldPermille("energy", 90, 100)).toBeLessThan(base);
    expect(dividendYieldPermille("energy", 90, 100)).toBeGreaterThan(0);
  });

  it("pays nothing below the threshold of the issue price", () => {
    expect(DIVIDEND_MIN_RATIO_PERCENT).toBe(70);
    expect(dividendYieldPermille("energy", 70, 100)).toBeGreaterThan(0);
    expect(dividendYieldPermille("energy", 69, 100)).toBe(0);
    expect(dividendYieldPermille("energy", 1, 100)).toBe(0);
  });

  it("never exceeds 4.5 percent, is never negative and does not fall when the price rises", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SECURITY_SECTORS),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (sector, price, start) => {
          const y = dividendYieldPermille(sector, price, start);
          expect(Number.isInteger(y)).toBe(true);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(45);
          // above the threshold the yield is monotone in the price
          if (price * 100 >= start * DIVIDEND_MIN_RATIO_PERCENT) {
            expect(dividendYieldPermille(sector, price + 1, start)).toBeGreaterThanOrEqual(y);
          }
        },
      ),
      { numRuns: RUNS(300) },
    );
  });
});

describe("Dividends: round-end payout", () => {
  it("credits price x yield per share as cash, logs it per player and emits an event", () => {
    const s = setup();
    hold(s, GOTTHARD, 10); // energy, price == issue price
    const cashBefore = s.players[0]?.cash ?? 0;
    const price = s.market?.prices[GOTTHARD] ?? 0;
    const regular = Math.floor((price * 10 * DIVIDEND_BASE_PERMILLE.energy) / 1000);
    expect(regular).toBeGreaterThan(0);
    expect(expectedDividend(s, "p0")).toBe(regular);
    const r = endRound(s);
    expect(r.state.round).toBe(2);
    const paid = r.events.find((e) => e.type === "dividend" && e.playerId === "p0");
    expect(paid).toMatchObject({ type: "dividend", playerId: "p0", round: 1 });
    const amount = paid?.type === "dividend" ? paid.amount : 0;
    if (!isSpecial(r.state) && !isSuspended(r.state)) {
      expect(amount).toBe(regular);
    }
    expect(r.state.players[0]?.cash).toBe(cashBefore + amount);
    expect(r.state.players[0]?.dividends).toBe(amount);
    const entry = r.state.log.find((l) => l.msg?.key === "log.dividend");
    expect(entry?.msg?.params).toMatchObject({ player: "p0", amount });
    expect(r.state.players[1]?.cash).toBe(s.players[1]?.cash);
    expect(r.state.players[1]?.dividends).toBeUndefined();
  });

  it("pays holdings that are still locked", () => {
    const s = setup({ securitiesLockRounds: 10 });
    hold(s, GOTTHARD, 10, 1);
    const r = endRound(s);
    expect(r.state.players[0]?.dividends ?? 0).toBeGreaterThan(0);
  });

  it("pays nothing for a company below 70 percent of its issue price or in the tech sector", () => {
    const s = setup();
    hold(s, GOTTHARD, 10);
    hold(s, KRYPTO, 5);
    setPrice(s, GOTTHARD, 40); // < 70 % of 70
    const p = s.players[0];
    if (!p) {
      throw new Error("setup");
    }
    const due = dividendFor(s, p);
    expect(due.parts.find((x) => x.secId === GOTTHARD)).toBeUndefined();
    expect(due.parts.find((x) => x.secId === KRYPTO)?.amount).toBeGreaterThan(0);
    expect(due.total).toBe(due.parts.reduce((sum, x) => sum + x.amount, 0));
  });

  it("is off with the setting off: no cash, no log, no event", () => {
    const s = setup({ securitiesDividends: false });
    hold(s, GOTTHARD, 10);
    expect(expectedDividend(s, "p0")).toBe(0);
    const r = endRound(s);
    expect(r.state.players[0]?.cash).toBe(s.players[0]?.cash);
    expect(r.state.players[0]?.dividends).toBeUndefined();
    expect(r.events.some((e) => e.type === "dividend")).toBe(false);
    expect(r.state.log.some((l) => l.msg?.key?.startsWith("log.dividend"))).toBe(false);
  });

  it("pays nothing without the securities mode", () => {
    const s = mk(2, { securitiesDividends: true });
    s.current = 1;
    s.phase = awaitEndTurn;
    const r = endRound(s);
    expect(r.events.some((e) => e.type === "dividend")).toBe(false);
  });

  it("pays exactly once per round: only when the round counter increments", () => {
    const s = mk(3, { securities: true });
    (s.players[0]!.holdings ??= []).push({
      secId: GOTTHARD,
      shares: 10,
      buyPrice: 50,
      boughtRound: 1,
    });
    s.current = 0;
    s.phase = awaitEndTurn;
    const a = applyAction(s, "p0", { type: "end-turn" }, 2000); // p1 is next: same round
    expect(a.state.round).toBe(1);
    expect(a.events.some((e) => e.type === "dividend")).toBe(false);
    const mid = structuredClone(a.state);
    mid.current = 2;
    mid.phase = awaitEndTurn;
    const b = applyAction(mid, "p2", { type: "end-turn" }, 2000);
    expect(b.state.round).toBe(2);
    expect(b.events.filter((e) => e.type === "dividend")).toHaveLength(1);
  });

  it("does not pay bankrupt players", () => {
    const s = setup();
    const p = s.players[0];
    if (p) {
      p.bankrupt = true;
    }
    hold(s, GOTTHARD, 10);
    const r = endRound(s);
    expect(r.events.some((e) => e.type === "dividend" && e.playerId === "p0")).toBe(false);
  });

  it("renders the log line in every language", () => {
    const s = setup();
    hold(s, GOTTHARD, 10);
    const msg = endRound(s).state.log.find((l) => l.msg?.key === "log.dividend")?.msg;
    if (!msg) {
      throw new Error("no log");
    }
    for (const lang of ["de", "en", "gsw", "fr", "it"] as const) {
      const text = formatMessage(lang, msg);
      expect(text).not.toContain("{");
      expect(text).toMatch(/\d/);
    }
  });
});

describe("Dividends: events (special / suspended), deterministic from the game rng", () => {
  /** Finds a seed whose round end produces the wanted event. */
  function withEvent(kind: "special" | "suspended"): {
    s: GameState;
    r: { state: GameState; events: GameEvent[] };
  } {
    for (let rng = 1; rng < 20000; rng++) {
      const s = setup();
      s.rng = rng;
      hold(s, GOTTHARD, 10);
      hold(s, PILATUS, 10);
      hold(s, KRYPTO, 10);
      const r = endRound(s);
      const key = kind === "special" ? "log.dividendSpecial" : "log.dividendSuspended";
      const hit = r.state.log.find((l) => l.msg?.key === key)?.msg?.params["security"];
      if (hit === GOTTHARD || hit === PILATUS || hit === KRYPTO) {
        return { s, r };
      }
    }
    throw new Error("no seed found");
  }

  it("a special dividend pays more than the regular one", () => {
    const { s, r } = withEvent("special");
    expect(r.state.players[0]?.dividends ?? 0).toBeGreaterThan(expectedDividend(s, "p0"));
  });

  it("a suspension pays nothing for that company and names it in the log", () => {
    const { s, r } = withEvent("suspended");
    expect(r.state.players[0]?.dividends ?? 0).toBeLessThan(expectedDividend(s, "p0"));
    const entry = r.state.log.find((l) => l.msg?.key === "log.dividendSuspended");
    expect(entry?.msg?.params["security"]).toBeTypeOf("string");
  });

  it("events are rare and the whole payout is deterministic", () => {
    let events = 0;
    const N = 400;
    for (let rng = 1; rng <= N; rng++) {
      const s = setup();
      s.rng = rng;
      hold(s, GOTTHARD, 10);
      const a = endRound(s);
      const b = endRound(structuredClone(s));
      expect(a.state).toEqual(b.state);
      if (isSpecial(a.state) || isSuspended(a.state)) {
        events++;
      }
    }
    expect(events).toBeGreaterThan(0);
    expect(events / N).toBeLessThan(0.2);
  });
});

describe("Dividends: money accounting (fast-check)", () => {
  it("dividends are the only new money: cash grows by exactly the logged amounts, never negative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(
          fc.record({
            sec: fc.nat(5),
            shares: fc.integer({ min: 1, max: 100 }),
            price: fc.integer({ min: 1, max: 600 }),
          }),
          { maxLength: 6 },
        ),
        (rng, lots) => {
          const s = setup();
          s.rng = rng;
          const ids = Object.keys(s.market?.prices ?? {});
          for (const l of lots) {
            const id = ids[l.sec % ids.length] ?? "";
            setPrice(s, id, l.price);
            hold(s, id, l.shares);
          }
          const before = s.players.map((p) => p.cash);
          const r = endRound(s);
          const paid = r.events.flatMap((e) => (e.type === "dividend" ? [e] : []));
          const logged = r.state.log
            .filter((l) => l.msg?.key === "log.dividend")
            .reduce((sum, l) => sum + Number(l.msg?.params["amount"] ?? 0), 0);
          const gained = r.state.players.reduce(
            (sum, p, i) => sum + (p.cash - (before[i] ?? 0)),
            0,
          );
          expect(gained).toBe(paid.reduce((sum, e) => sum + e.amount, 0));
          expect(gained).toBe(logged);
          expect(paid.every((e) => e.amount > 0)).toBe(true);
          expect(r.state.players.every((p) => p.cash >= 0)).toBe(true);
          expect(r.state.players[0]?.dividends ?? 0).toBe(gained);
        },
      ),
      { numRuns: RUNS(200) },
    );
  });
});
