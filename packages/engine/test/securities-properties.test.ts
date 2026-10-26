// Wertpapiere: property-based tests (docs/DESIGN.md #24, #48).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, legalActions } from "../src/game.ts";
import { netWorth } from "../src/helpers.ts";
import {
  EMERGENCY_DISCOUNT_PERCENT,
  HISTORY_LENGTH,
  MAX_PRICE,
  holdingsOf,
  stepMarket,
} from "../src/securities.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { GameState, MarketActivity } from "../src/types.ts";
import { THEMES } from "../src/themes/index.ts";
import { assertInvariants } from "./invariants.ts";
import { mk, players } from "./util.ts";

const SOAK = process.env["ENGINE_SOAK"] === "1";
const RUNS = (n: number): number => (SOAK ? n * 10 : n);

const activityArb: fc.Arbitrary<MarketActivity> = fc.record({
  builds: fc.nat(30),
  scenicBuilds: fc.nat(30),
  rentPaid: fc.nat(5000),
  stationRents: fc.nat(20),
  utilityRents: fc.nat(20),
  bankruptcies: fc.nat(7),
});

const themeArb = fc.constantFrom(...Object.keys(THEMES));

function marketGame(themeId: string, rng: number): GameState {
  return {
    ...createGame("g", players(3), { ...DEFAULT_SETTINGS, themeId, securities: true }, rng, 1000)
      .state,
    rng,
  };
}

describe("property: the price model", () => {
  it("keeps prices integers in [1, MAX_PRICE] and the history bounded, over many rounds", () => {
    fc.assert(
      fc.property(
        themeArb,
        fc.integer({ min: -2_000_000_000, max: 2_000_000_000 }),
        fc.array(activityArb, { minLength: 1, maxLength: 60 }),
        (themeId, seed, activities) => {
          let s = marketGame(themeId, seed);
          for (const a of activities) {
            if (!s.market) {
              throw new Error("market missing");
            }
            s.market.activity = a;
            const step = stepMarket(s);
            s = { ...s, market: step.market, rng: step.rng, round: s.round + 1 };
            for (const [id, p] of Object.entries(s.market?.prices ?? {})) {
              expect(Number.isInteger(p) && p >= 1 && p <= MAX_PRICE, `${id}: ${p}`).toBe(true);
              expect(s.market?.history[id]?.length).toBeLessThanOrEqual(HISTORY_LENGTH);
              expect(s.market?.history[id]?.at(-1)).toBe(p);
            }
            assertInvariants(s);
          }
        },
      ),
      { numRuns: RUNS(150) },
    );
  });

  it("is deterministic: the same state and activity give the same market and rng", () => {
    fc.assert(
      fc.property(themeArb, fc.integer(), activityArb, (themeId, seed, activity) => {
        const a = marketGame(themeId, seed);
        if (a.market) {
          a.market.activity = activity;
        }
        const b = structuredClone(a);
        expect(stepMarket(a)).toEqual(stepMarket(b));
      }),
      { numRuns: RUNS(200) },
    );
  });

  it("does not consume rng differently with and without activity (coupling is additive only)", () => {
    fc.assert(
      fc.property(themeArb, fc.integer(), activityArb, (themeId, seed, activity) => {
        const calm = marketGame(themeId, seed);
        const busy = structuredClone(calm);
        if (busy.market) {
          busy.market.activity = activity;
        }
        expect(stepMarket(busy).rng).toBe(stepMarket(calm).rng);
      }),
      { numRuns: RUNS(200) },
    );
  });
});

describe("property: money conservation of buying and selling", () => {
  interface Op {
    kind: "buy" | "sell";
    sec: number;
    n: number;
  }
  const opArb: fc.Arbitrary<Op> = fc.record({
    kind: fc.constantFrom("buy", "sell"),
    sec: fc.nat(5),
    n: fc.integer({ min: 1, max: 30 }),
  });

  it("buying and (unlocked) selling at a constant price keep cash + holdings value unchanged", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        // lock-up 1 and a start in round 1: lots are sellable from round 2, so move the round by hand
        let s = mk(2, { securities: true, securitiesLockRounds: 1, startingCash: 10_000 });
        const ids = Object.keys(s.market?.prices ?? {});
        for (const op of ops) {
          const secId = ids[op.sec % ids.length] ?? "";
          const before = netWorth(s, "p0");
          const cashBefore = s.players[0]?.cash ?? 0;
          let next: GameState;
          try {
            next =
              op.kind === "buy"
                ? applyAction(s, "p0", { type: "buy-securities", secId, shares: op.n }, 2000).state
                : applyAction(
                    { ...s, round: s.round + 1 },
                    "p0",
                    { type: "sell-securities", secId, lot: "all" },
                    2000,
                  ).state;
          } catch {
            continue;
          }
          assertInvariants(next);
          expect(netWorth(next, "p0")).toBe(before);
          expect(next.players[0]?.cash).not.toBe(cashBefore);
          // money is only moved between player and market: nobody else's cash changes
          expect(next.players[1]?.cash).toBe(s.players[1]?.cash);
          s = op.kind === "sell" ? { ...next, round: s.round } : next;
        }
      }),
      { numRuns: RUNS(120) },
    );
  });

  it("an emergency sale loses exactly the discount (rounded down) and nothing else", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 4000 }),
        (shares, price) => {
          const s = mk(2, { securities: true, securitiesLockRounds: 5 });
          const secId = Object.keys(s.market?.prices ?? {})[0] ?? "";
          const p0 = s.players[0];
          if (!p0 || !s.market) {
            throw new Error("setup");
          }
          s.market.prices[secId] = price;
          s.market.history[secId] = [price];
          p0.cash = 0;
          p0.holdings = [{ secId, shares, buyPrice: price, boughtRound: 1 }];
          const amount = shares * price;
          s.phase = { type: "debt", debtor: "p0", creditor: null, amount: amount + 1 };
          const r = applyAction(s, "p0", { type: "sell-securities", secId, lot: 0 }, 2000).state;
          const gross = shares * price;
          const net = Math.floor((gross * (100 - EMERGENCY_DISCOUNT_PERCENT)) / 100);
          expect(r.players[0]?.cash).toBe(net);
          expect(gross - net).toBeLessThanOrEqual(Math.ceil(gross * 0.2));
          expect(holdingsOf(r.players[0]!)).toHaveLength(0);
        },
      ),
      { numRuns: RUNS(200) },
    );
  });

  it("legalActions lists buy/sell-securities only when an instance is accepted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 10 }),
        (cash, round) => {
          const s = mk(2, { securities: true });
          const p0 = s.players[0];
          if (!p0 || !s.market) {
            throw new Error("setup");
          }
          p0.cash = cash;
          s.round = round;
          p0.holdings = [
            {
              secId: Object.keys(s.market.prices)[0] ?? "",
              shares: 1,
              buyPrice: 5,
              boughtRound: 1,
            },
          ];
          const legal = legalActions(s, "p0");
          const secId = Object.keys(s.market.prices)[0] ?? "";
          const sells = (() => {
            try {
              applyAction(s, "p0", { type: "sell-securities", secId, lot: 0 }, 2000);
              return true;
            } catch {
              return false;
            }
          })();
          expect(legal.includes("sell-securities")).toBe(sells);
        },
      ),
      { numRuns: RUNS(100) },
    );
  });
});
