// Decaying dividends (docs/DESIGN.md #85): the yield factor by round, payout and anticipation.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction } from "../src/game.ts";
import {
  DIVIDEND_BASE_PERMILLE,
  DIVIDEND_DECAY_EVERY_ROUNDS,
  DIVIDEND_DECAY_START_ROUND,
  DIVIDEND_DECAY_STEP_PERCENT,
  SPECIAL_DIVIDEND_PERMILLE,
  anticipatedYieldPermille,
  currentYieldPermille,
  dividendDecayPercent,
  dividendFloorRound,
  dividendYieldPermille,
  expectedDividend,
} from "../src/securities.ts";
import type { GameSettings, GameState } from "../src/types.ts";
import { mk } from "./util.ts";

const GOTTHARD = "ch-gotthard"; // energy, start 70
const RUNS = (n: number): number => (process.env["FAST"] ? Math.ceil(n / 10) : n);

function setup(over: Partial<GameSettings> = {}): GameState {
  const s = mk(2, { securities: true, ...over });
  s.current = 1;
  s.phase = { type: "await-end-turn", canRollAgain: false };
  const p = s.players[0];
  if (!p) {
    throw new Error("setup");
  }
  p.holdings = [{ secId: GOTTHARD, shares: 10, buyPrice: 50, boughtRound: 1 }];
  return s;
}

describe("Dividends: decay over the rounds", () => {
  it("pays the full yield up to the start round and decays stepwise afterwards", () => {
    expect(DIVIDEND_DECAY_START_ROUND).toBeGreaterThanOrEqual(15);
    expect(dividendDecayPercent(1)).toBe(100);
    expect(dividendDecayPercent(DIVIDEND_DECAY_START_ROUND)).toBe(100);
    expect(dividendDecayPercent(DIVIDEND_DECAY_START_ROUND + 1)).toBe(
      100 - DIVIDEND_DECAY_STEP_PERCENT,
    );
    expect(dividendDecayPercent(DIVIDEND_DECAY_START_ROUND + DIVIDEND_DECAY_EVERY_ROUNDS)).toBe(
      100 - DIVIDEND_DECAY_STEP_PERCENT,
    );
    expect(dividendDecayPercent(DIVIDEND_DECAY_START_ROUND + DIVIDEND_DECAY_EVERY_ROUNDS + 1)).toBe(
      100 - 2 * DIVIDEND_DECAY_STEP_PERCENT,
    );
  });

  it("is exactly 0 at and after the floor round, which is the first zero", () => {
    const floor = dividendFloorRound();
    expect(dividendDecayPercent(floor)).toBe(0);
    expect(dividendDecayPercent(floor - 1)).toBeGreaterThan(0);
    expect(dividendDecayPercent(floor + 500)).toBe(0);
    expect(dividendYieldPermille("energy", 100, 100, floor)).toBe(0);
  });

  it("is monotonically non-increasing, an integer in 0..100 and never negative", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 0, max: 50 }), (r, d) => {
        const a = dividendDecayPercent(r);
        const b = dividendDecayPercent(r + d);
        expect(Number.isInteger(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(100);
        expect(b).toBeLessThanOrEqual(a);
        if (r <= DIVIDEND_DECAY_START_ROUND) {
          expect(a).toBe(100);
        }
        if (r >= dividendFloorRound()) {
          expect(a).toBe(0);
        }
      }),
      { numRuns: RUNS(300) },
    );
  });

  it("scales the yield with the round; rounds up to the start round are unchanged", () => {
    const base = DIVIDEND_BASE_PERMILLE.energy;
    expect(dividendYieldPermille("energy", 100, 100, DIVIDEND_DECAY_START_ROUND)).toBe(base);
    expect(dividendYieldPermille("energy", 100, 100)).toBe(base);
    const later = dividendYieldPermille("energy", 100, 100, DIVIDEND_DECAY_START_ROUND + 1);
    expect(later).toBe(Math.floor((base * (100 - DIVIDEND_DECAY_STEP_PERCENT)) / 100));
    expect(later).toBeLessThan(base);
  });

  it("the payout uses the factor of the round that just ended", () => {
    const s = setup();
    s.round = DIVIDEND_DECAY_START_ROUND + 1;
    const price = s.market?.prices[GOTTHARD] ?? 0;
    const y = dividendYieldPermille("energy", price, price, s.round);
    expect(currentYieldPermille(s, GOTTHARD)).toBe(y);
    const regular = Math.floor((price * 10 * y) / 1000);
    expect(regular).toBeGreaterThan(0);
    expect(expectedDividend(s, "p0")).toBe(regular);
    let regularSeen = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      const r = applyAction(t, "p1", { type: "end-turn" }, 2000);
      const special = r.state.log.some((l) => l.msg?.key === "log.dividendSpecial");
      const suspended = r.state.log.some((l) => l.msg?.key === "log.dividendSuspended");
      if (!special && !suspended) {
        expect(r.state.players[0]?.dividends).toBe(regular);
        regularSeen++;
      }
    }
    expect(regularSeen).toBeGreaterThan(0);
  });

  it("pays nothing at and after the floor round, also with a special dividend", () => {
    const s = setup();
    s.round = dividendFloorRound();
    expect(expectedDividend(s, "p0")).toBe(0);
    let specials = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      const r = applyAction(t, "p1", { type: "end-turn" }, 2000);
      specials += r.state.log.some((l) => l.msg?.key === "log.dividendSpecial") ? 1 : 0;
      expect(r.state.players[0]?.dividends ?? 0).toBe(0);
    }
    expect(specials).toBeGreaterThan(0);
  });

  it("the special dividend decays with the same factor", () => {
    expect(SPECIAL_DIVIDEND_PERMILLE).toBeGreaterThan(0);
    const s = setup();
    s.round = DIVIDEND_DECAY_START_ROUND + 1;
    let found = false;
    for (let seed = 1; seed <= 400 && !found; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      const r = applyAction(t, "p1", { type: "end-turn" }, 2000);
      const special = r.state.log.find((l) => l.msg?.key === "log.dividendSpecial");
      if (special?.msg?.params?.["security"] === GOTTHARD) {
        const price = s.market?.prices[GOTTHARD] ?? 0;
        const y =
          currentYieldPermille(s, GOTTHARD) +
          Math.floor(
            (SPECIAL_DIVIDEND_PERMILLE * dividendDecayPercent(DIVIDEND_DECAY_START_ROUND + 1)) /
              100,
          );
        expect(r.state.players[0]?.dividends).toBe(Math.floor((price * 10 * y) / 1000));
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("the anticipated yield lies below the current one before the start round and is 0 at the floor", () => {
    const s = setup();
    s.round = DIVIDEND_DECAY_START_ROUND - 2;
    const now = currentYieldPermille(s, GOTTHARD);
    const ahead = anticipatedYieldPermille(s, GOTTHARD, 10);
    expect(ahead).toBeLessThan(now);
    expect(ahead).toBeGreaterThan(0);
    s.round = 1;
    expect(anticipatedYieldPermille(s, GOTTHARD, 1)).toBe(now);
    s.round = dividendFloorRound();
    expect(anticipatedYieldPermille(s, GOTTHARD, 10)).toBe(0);
  });
});
