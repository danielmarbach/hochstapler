// Hard bots price in the full colour set they would hand a rival; normal bots do not (docs/DESIGN.md #86).
import { describe, expect, it } from "vitest";
import { chooseBotTradeResponses } from "../src/bot.ts";
import { applyAction } from "../src/game.ts";
import { priceOf, tileDef } from "../src/helpers.ts";
import type { BotLevel, GameAction, GameState } from "../src/types.ts";
import { MAX_COUNTERS } from "../src/types.ts";
import { given, group } from "./scenario.ts";

const [, LAST = 3] = group(0);
const GROUP_PRICE = group(0).reduce((a, i) => a + priceOf(tileDef(i)), 0);

/** Anna holds all of group 0 but the last tile, which Bot Ben owns; she offers `cash` for it. */
function fullSetOffer(level: BotLevel, cash: number): GameState {
  let state: GameState | null = null;
  given()
    .players("Anna", "Bot Ben")
    .player("Anna")
    .owns(group(0).filter((i) => i !== LAST))
    .cash(2000)
    .player("Bot Ben")
    .owns(LAST)
    .cash(2000)
    .when("Anna")
    .proposesTrade("Bot Ben", { giveCash: cash, wantTiles: [LAST] })
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

function answers(base: GameState, tries = 40): GameAction[] {
  const out: GameAction[] = [];
  for (let v = 0; v < tries; v++) {
    const s = structuredClone(base);
    s.version += v;
    const [a] = chooseBotTradeResponses(s, s.players[1]?.id ?? "");
    if (a) {
      out.push(a);
    }
  }
  return out;
}

describe("full-set-aware trade valuation", () => {
  it("a normal bot sells the last tile of a group for a fair price, a hard bot does not", () => {
    const price = priceOf(tileDef(LAST));
    const cash = Math.ceil((price * 1.6) / 10) * 10; // 1.6 x price: what a bot offers
    expect(
      answers(fullSetOffer("normal", cash)).every((a) => a.type === "respond-trade" && a.accept),
    ).toBe(true);
    expect(
      answers(fullSetOffer("hard", cash)).every((a) => a.type !== "respond-trade" || !a.accept),
    ).toBe(true);
  });

  it("a hard bot still accepts when the price covers the full colour set it hands over", () => {
    const cash = Math.ceil(priceOf(tileDef(LAST)) * 1.6 + GROUP_PRICE);
    expect(
      answers(fullSetOffer("hard", cash)).every((a) => a.type === "respond-trade" && a.accept),
    ).toBe(true);
  });

  it("a hard bot counters a cheap full-set offer with a valid, clearly higher price", () => {
    const price = priceOf(tileDef(LAST));
    const cash = Math.ceil((price * 1.6) / 10) * 10;
    const counters = answers(fullSetOffer("hard", cash)).filter((a) => a.type === "counter-trade");
    expect(counters.length).toBeGreaterThan(0);
    for (const a of counters) {
      if (a.type !== "counter-trade") {
        continue;
      }
      expect(a.offer.giveTiles).toEqual([LAST]);
      expect(a.offer.wantCash).toBeGreaterThan(cash + GROUP_PRICE * 0.3);
      const s = fullSetOffer("hard", cash);
      const done = applyAction(s, s.players[1]?.id ?? "", a, 9000);
      expect(done.state.trades.map((t) => t.status)).toEqual(["countered", "pending"]);
    }
  });

  it("a normal bot does not use the full-set premium when it counters", () => {
    const price = priceOf(tileDef(LAST));
    for (const a of answers(fullSetOffer("normal", Math.floor(price * 0.8)))) {
      if (a.type === "counter-trade") {
        expect(a.offer.wantCash).toBeLessThan(price * 1.6);
      }
    }
  });

  it("stops at the chain limit: no further counter for a full-set offer", () => {
    const base = fullSetOffer("hard", 100);
    const trade = base.trades[0];
    if (!trade) {
      throw new Error("no trade");
    }
    trade.counterDepth = MAX_COUNTERS;
    trade.counterOf = "t0";
    expect(answers(base).every((a) => a.type === "respond-trade" && !a.accept)).toBe(true);
  });

  it("does not touch trades that complete no group for the rival", () => {
    let state: GameState | null = null;
    const price = priceOf(tileDef(LAST));
    given()
      .players("Anna", "Bot Ben")
      .player("Anna")
      .cash(2000)
      .player("Bot Ben")
      .owns(LAST)
      .when("Anna")
      .proposesTrade("Bot Ben", { giveCash: Math.ceil(price * 1.3), wantTiles: [LAST] })
      .then()
      .that((st) => {
        state = structuredClone(st);
        const ben = state.players[1];
        if (ben) {
          ben.botLevel = "hard";
        }
      });
    if (!state) {
      throw new Error("no state");
    }
    expect(answers(state).every((a) => a.type === "respond-trade" && a.accept)).toBe(true);
  });
});
