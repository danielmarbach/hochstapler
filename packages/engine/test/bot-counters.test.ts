import { describe, expect, it } from "vitest";
import { chooseBotTradeResponses } from "../src/bot.ts";
import { applyAction } from "../src/game.ts";
import type { BotLevel, GameAction, GameState } from "../src/types.ts";
import { MAX_COUNTERS } from "../src/types.ts";
import { given } from "./scenario.ts";
import { runSim } from "./sim.ts";

/** Anna (human) offers `cash` for Ben's tile 1; Ben is a bot of the given level. */
function offerToBot(level: BotLevel, cash: number): GameState {
  let state: GameState | null = null;
  given()
    .players("Anna", "Bot Ben")
    .player("Bot Ben")
    .owns(1)
    .when("Anna")
    .proposesTrade("Bot Ben", { giveCash: cash, wantTiles: [1] })
    .then()
    .that((s) => {
      state = structuredClone(s);
      const ben = state.players[1];
      if (ben) {
        ben.botLevel = level;
      }
    });
  if (!state) {
    throw new Error("no state");
  }
  return state;
}

/** The same position at different game versions: the deterministic dice of the bot differ. */
function answers(level: BotLevel, cash: number, tries = 40): GameAction[] {
  const base = offerToBot(level, cash);
  const out: GameAction[] = [];
  for (let v = 0; v < tries; v++) {
    const s = structuredClone(base);
    s.version += v;
    const ben = s.players[1]?.id ?? "";
    const [a] = chooseBotTradeResponses(s, ben);
    if (a) {
      out.push(a);
    }
  }
  return out;
}

describe("bot counteroffers", () => {
  it("counters an offer that is close to but below its valuation, with a valid higher price", () => {
    const res = answers("normal", 60); // worth 60, wants 5% on top: 63
    const counters = res.filter((a) => a.type === "counter-trade");
    expect(counters.length).toBeGreaterThan(0);
    expect(res.some((a) => a.type === "respond-trade" && !a.accept)).toBe(true); // the dice say no sometimes
    for (const a of counters) {
      if (a.type !== "counter-trade") {
        continue;
      }
      expect(a.offer.giveTiles).toEqual([1]);
      expect(a.offer.wantCash).toBeGreaterThan(60);
      expect(a.offer.wantCash).toBeLessThanOrEqual(80);
      expect(a.offer.giveCash).toBe(0);
      // the reducer accepts it
      const s = offerToBot("normal", 60);
      const ben = s.players[1]?.id ?? "";
      const done = applyAction(s, ben, a, 9000);
      expect(done.state.trades.map((t) => t.status)).toEqual(["countered", "pending"]);
    }
  });

  it("is deterministic for the same state", () => {
    const s = offerToBot("hard", 60);
    const ben = s.players[1]?.id ?? "";
    expect(chooseBotTradeResponses(s, ben)).toEqual(chooseBotTradeResponses(s, ben));
  });

  it("refuses an offer far below its valuation and accepts a good one", () => {
    expect(answers("normal", 10).every((a) => a.type === "respond-trade" && !a.accept)).toBe(true);
    expect(answers("normal", 200).every((a) => a.type === "respond-trade" && a.accept)).toBe(true);
  });

  it("easy bots never counter, and the test switch turns countering off", () => {
    expect(answers("easy", 60).some((a) => a.type === "counter-trade")).toBe(false);
    const base = offerToBot("normal", 60);
    for (let v = 0; v < 40; v++) {
      const s = structuredClone(base);
      s.version += v;
      const ben = s.players[1]?.id ?? "";
      expect(
        chooseBotTradeResponses(s, ben, { counters: false }).some(
          (a) => a.type === "counter-trade",
        ),
      ).toBe(false);
    }
  });

  it("does not counter once the negotiation holds the maximum number of counters", () => {
    const base = offerToBot("hard", 60);
    const trade = base.trades[0];
    if (!trade) {
      throw new Error("no trade");
    }
    trade.counterDepth = MAX_COUNTERS;
    trade.counterOf = "t0";
    for (let v = 0; v < 40; v++) {
      const s = structuredClone(base);
      s.version += v;
      const ben = s.players[1]?.id ?? "";
      expect(chooseBotTradeResponses(s, ben).every((a) => a.type === "respond-trade")).toBe(true);
    }
  });

  it("two bots haggling over a deal always end within the chain limit", () => {
    for (let seed = 0; seed < 10; seed++) {
      const r = runSim({
        seed,
        seats: ["bot", "bot", "bot", "bot"],
        settings: { turnTimeoutSec: 0 },
        humanStyle: "never",
        tradeRate: 0,
        returnRate: 0,
        legalEvery: 0,
        roundCap: 60,
        levels: ["hard", "normal", "hard", "normal"],
      });
      expect(r.maxChain).toBeLessThanOrEqual(MAX_COUNTERS);
      expect(r.state.trades.filter((t) => t.status === "pending").length).toBeLessThanOrEqual(5);
    }
  }, 30_000);
});
