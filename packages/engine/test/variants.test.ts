import { describe, expect, it } from "vitest";
import { runSim } from "./sim.ts";
import type { HumanStyle, SimConfig } from "./sim.ts";
import type { GameSettings } from "../src/types.ts";

type Seat = "bot" | "human";

interface Variant {
  name: string;
  settings: Partial<GameSettings>;
  /** player count range */
  players: [number, number];
  humans: number;
  style: HumanStyle;
  tradeRate: number;
  returnRate: number;
  roundCap: number;
}

const BASE = {
  humans: 0,
  style: "never" as HumanStyle,
  tradeRate: 0,
  returnRate: 0,
  roundCap: 150,
};

const VARIANTS: Variant[] = [
  { ...BASE, name: "defaults, bots only", settings: { turnTimeoutSec: 0 }, players: [2, 8] },
  {
    ...BASE,
    name: "no auctions",
    settings: { turnTimeoutSec: 0, auctions: false },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "rest-stop jackpot",
    settings: { turnTimeoutSec: 0, freeParkingJackpot: true },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "double on GO landing",
    settings: { turnTimeoutSec: 0, doubleOnGoLanding: true },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "even build off",
    settings: { turnTimeoutSec: 0, evenBuild: false },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "tiny building limits (h4 / ht1 / s1)",
    settings: { turnTimeoutSec: 0, buildingLimits: { houses: 4, hotels: 1, skyscrapers: 1 } },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "no skyscrapers, 8 houses",
    settings: { turnTimeoutSec: 0, buildingLimits: { houses: 8, hotels: 2, skyscrapers: 0 } },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "starting cash 500",
    settings: { turnTimeoutSec: 0, startingCash: 500 },
    players: [2, 8],
  },
  {
    ...BASE,
    name: "starting cash 10000",
    settings: { turnTimeoutSec: 0, startingCash: 10_000 },
    players: [2, 6],
    roundCap: 80,
  },
  {
    ...BASE,
    name: "securities, lock-up 1",
    settings: { turnTimeoutSec: 0, securities: true, securitiesLockRounds: 1 },
    players: [2, 8],
  },
  {
    ...BASE,
    name: "securities, lock-up 10, rich start, maxRounds 12",
    settings: {
      turnTimeoutSec: 0,
      securities: true,
      securitiesLockRounds: 10,
      startingCash: 10_000,
      maxRounds: 12,
    },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "securities, dividends off",
    settings: { turnTimeoutSec: 0, securities: true, securitiesDividends: false },
    players: [2, 6],
  },
  {
    ...BASE,
    name: "securities with humans, timeouts and trades",
    settings: { turnTimeoutSec: 30, securities: true },
    players: [2, 6],
    humans: 2,
    style: "sometimes",
    tradeRate: 0.1,
    returnRate: 0.1,
  },
  { ...BASE, name: "maxRounds 5", settings: { turnTimeoutSec: 0, maxRounds: 5 }, players: [2, 8] },
  {
    ...BASE,
    name: "maxRounds 5 with timeouts",
    settings: { turnTimeoutSec: 30, maxRounds: 5 },
    players: [2, 5],
    humans: 1,
    style: "sometimes",
  },
  {
    ...BASE,
    name: "idle humans become away",
    settings: { turnTimeoutSec: 60 },
    players: [3, 6],
    humans: 2,
    style: "never",
    returnRate: 0,
  },
  {
    ...BASE,
    name: "sometimes-acting humans",
    settings: { turnTimeoutSec: 60 },
    players: [2, 6],
    humans: 2,
    style: "sometimes",
    tradeRate: 0.1,
    returnRate: 0.1,
  },
  {
    ...BASE,
    name: "humans return from away",
    settings: { turnTimeoutSec: 20, awayAfterMissedTurns: 1 },
    players: [3, 6],
    humans: 3,
    style: "never",
    returnRate: 0.2,
  },
  {
    ...BASE,
    name: "random trades, humans only act randomly",
    settings: { turnTimeoutSec: 45 },
    players: [3, 6],
    humans: 3,
    style: "always",
    tradeRate: 0.3,
    returnRate: 0.05,
  },
  {
    ...BASE,
    name: "no time limit, random humans",
    settings: { turnTimeoutSec: 0 },
    players: [2, 4],
    humans: 2,
    style: "always",
    tradeRate: 0.2,
  },
  {
    ...BASE,
    name: "poor humans, jackpot, no auctions, tight buildings",
    settings: {
      turnTimeoutSec: 30,
      startingCash: 500,
      freeParkingJackpot: true,
      auctions: false,
      buildingLimits: { houses: 6, hotels: 2, skyscrapers: 1 },
    },
    players: [2, 6],
    humans: 2,
    style: "sometimes",
    tradeRate: 0.15,
    returnRate: 0.1,
  },
];

function configs(v: Variant, games: number, offset: number, legalEvery: number): SimConfig[] {
  const out: SimConfig[] = [];
  for (let g = 0; g < games; g++) {
    const seed = offset + g * 31 + 1;
    const n = v.players[0] + (seed % (v.players[1] - v.players[0] + 1));
    const humans = Math.min(v.humans, n - 1);
    const seats: Seat[] = Array.from({ length: n }, (_, i) => (i < humans ? "human" : "bot"));
    out.push({
      seed,
      seats,
      settings: v.settings,
      humanStyle: v.style,
      tradeRate: v.tradeRate,
      returnRate: v.returnRate,
      legalEvery: g % 5 === 0 ? legalEvery : 0,
      roundCap: v.roundCap,
    });
  }
  return out;
}

const SOAK = process.env["ENGINE_SOAK"] === "1";
const GAMES_PER_VARIANT = SOAK ? Math.ceil(2000 / VARIANTS.length) : 8;
const LEGAL_EVERY = SOAK ? 40 : 15;

// One test per game (not per variant) so no single synchronous test blocks the vitest worker for long.
describe("variant simulations (invariants checked after every action)", () => {
  for (const v of VARIANTS) {
    describe(v.name, () => {
      const results: { rounds: number; finished: boolean }[] = [];
      configs(v, GAMES_PER_VARIANT, 0, LEGAL_EVERY).forEach((cfg, game) => {
        it(`game ${game + 1}`, () => {
          results.push(runSim(cfg));
        }, 600_000);
      });

      it("plays rounds (and finishes every game when maxRounds = 5)", () => {
        expect(results).toHaveLength(GAMES_PER_VARIANT);
        expect(results.reduce((sum, r) => sum + r.rounds, 0)).toBeGreaterThan(0);
        if (v.settings.maxRounds === 5) {
          expect(results.filter((r) => r.finished)).toHaveLength(GAMES_PER_VARIANT);
        }
      });
    });
  }
});
