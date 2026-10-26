import { describe, expect, it } from "vitest";
import { chooseBotAction, chooseBotTradeResponses } from "../src/bot.ts";
import { applyAction, createGame, legalActions, whoMustAct } from "../src/game.ts";
import { BOARD } from "../src/board.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { BotLevel, GameEvent, GameState, NewPlayer } from "../src/types.ts";

const LEVELS: BotLevel[] = ["easy", "normal", "hard"];

function sane(s: GameState): void {
  for (const p of s.players) {
    expect(Number.isFinite(p.cash)).toBe(true);
    expect(Number.isInteger(p.cash)).toBe(true);
    if (s.phase.type !== "debt") {
      expect(p.cash).toBeGreaterThanOrEqual(0);
    }
    if (p.bankrupt) {
      expect(p.cash).toBe(0);
    }
  }
  expect(Number.isFinite(s.freeParkingPot)).toBe(true);
  expect(s.bank.houses).toBeGreaterThanOrEqual(0);
  expect(s.bank.hotels).toBeGreaterThanOrEqual(0);
  expect(s.bank.skyscrapers).toBeGreaterThanOrEqual(0);
  // building conservation
  let houses = 0;
  let hotels = 0;
  let sky = 0;
  for (const [i, pr] of Object.entries(s.properties)) {
    if (pr.level >= 1 && pr.level <= 4) {
      houses += pr.level;
    }
    if (pr.level === 5) {
      hotels++;
    }
    if (pr.level === 6) {
      sky++;
    }
    if (pr.owner) {
      expect(s.players.find((p) => p.id === pr.owner)!.bankrupt).toBe(false);
    }
    if (pr.level > 0) {
      expect(BOARD[Number(i)]!.kind).toBe("street");
    }
  }
  expect(houses + s.bank.houses).toBe(s.settings.buildingLimits.houses);
  expect(hotels + s.bank.hotels).toBe(s.settings.buildingLimits.hotels);
  expect(sky + s.bank.skyscrapers).toBe(s.settings.buildingLimits.skyscrapers);
}

function play(seed: number): { rounds: number; finished: boolean; events: number; trades: number } {
  const n = 2 + (seed % 5);
  const players: NewPlayer[] = Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    name: `Bot${i}`,
    color: "#000",
    tokenId: "t",
    controller: "bot",
    botLevel: LEVELS[(seed + i) % 3]!,
  }));
  const settings = {
    ...DEFAULT_SETTINGS,
    turnTimeoutSec: 0,
    maxRounds: seed % 2 === 0 ? 150 : 0,
    auctions: seed % 4 !== 0,
    freeParkingJackpot: seed % 3 === 0,
    doubleOnGoLanding: seed % 5 === 0,
  };
  let s = createGame(`f${seed}`, players, settings, seed * 7919 + 1, 0).state;
  let steps = 0;
  let evCount = 0;
  const evs: GameEvent[] = [];
  while (s.status === "running" && s.round <= 500) {
    if (++steps > 200_000) {
      throw new Error("stuck");
    }
    // bots answer trades first
    let acted = false;
    for (const p of s.players) {
      if (p.bankrupt) {
        continue;
      }
      for (const a of chooseBotTradeResponses(s, p.id)) {
        const r = applyAction(s, p.id, a, steps);
        s = r.state;
        evs.push(...r.events);
        acted = true;
      }
    }
    if (acted) {
      continue;
    }
    const actors = whoMustAct(s);
    expect(actors.length).toBe(1);
    const pid = actors[0]!;
    const action = chooseBotAction(s, pid);
    expect(action).not.toBeNull();
    expect(legalActions(s, pid)).toContain(action!.type);
    const r = applyAction(s, pid, action!, steps);
    s = r.state;
    evCount += r.events.length;
    evs.push(...r.events);
    if (steps % 25 === 0) {
      sane(s);
    }
  }
  sane(s);
  void evCount;
  return {
    rounds: s.round,
    finished: s.status === "finished",
    events: evs.length,
    trades: evs.filter((e) => e.type === "trade" && e.trade.status === "accepted").length,
  };
}

const GAMES = 50;

// One test per game: keeps each test short so the vitest worker stays responsive (a single 17 s
// synchronous test starved its RPC channel → "Timeout calling onTaskUpdate"), and a failure names the seed.
describe("fuzz: bot-only simulations", () => {
  const results: ReturnType<typeof play>[] = [];

  for (let seed = 1; seed <= GAMES; seed++) {
    it(`game ${seed} with ${2 + (seed % 5)} bots runs to completion without errors`, () => {
      const r = play(seed);
      expect(r.rounds).toBeLessThanOrEqual(501);
      results.push(r);
    });
  }

  it("most games finish and bots trade", () => {
    const finished = results.filter((r) => r.finished).length;
    const trades = results.reduce((sum, r) => sum + r.trades, 0);
    console.log(`finished ${finished}/${GAMES}, accepted trades ${trades}`);
    expect(results).toHaveLength(GAMES);
    expect(finished).toBeGreaterThan(10);
  });
});
