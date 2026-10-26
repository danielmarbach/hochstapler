// Bots value dividends in the securities mode, depending on their difficulty (docs/DESIGN.md #83).
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.ts";
import type { BotLevel, GameAction, GameState } from "../src/types.ts";
import { dividendFloorRound } from "../src/securities.ts";
import { given } from "./scenario.ts";

const GOTTHARD = "ch-gotthard"; // energy, start 70, highest yield of the Swiss companies
const CAFE = "fr-cafe"; // tech, start 95, never pays

function botTurn(level: BotLevel, dividends: boolean, theme = "ch", cash = 9000): GameState {
  return given()
    .players("Bot Heidi", "Ben")
    .securities(3)
    .settings({ securitiesDividends: dividends, themeId: theme })
    .round(5)
    .player("Bot Heidi")
    .cash(cash)
    .tweak((s) => {
      s.phase = { type: "await-end-turn", canRollAgain: false };
      s.dice = [1, 2];
      const p = s.players[0];
      if (p) {
        p.botLevel = level;
      }
    })
    .build().state;
}

function withLot(s: GameState, secId: string, price: number, buyPrice: number): GameState {
  const c = structuredClone(s);
  if (c.market) {
    c.market.prices[secId] = price;
    c.market.history[secId] = [price];
  }
  c.players[0]?.holdings?.push({ secId, shares: 5, buyPrice, boughtRound: 1 });
  if (c.players[0] && !c.players[0].holdings) {
    c.players[0].holdings = [{ secId, shares: 5, buyPrice, boughtRound: 1 }];
  }
  return c;
}

const bought = (a: GameAction | null): string | null =>
  a?.type === "buy-securities" ? a.secId : null;

describe("Bots: dividends in the securities valuation", () => {
  it("normal and hard bots buy the company with the best yield first (no other criterion differs)", () => {
    expect(bought(chooseBotAction(botTurn("normal", true), "p0"))).toBe(GOTTHARD);
    expect(bought(chooseBotAction(botTurn("hard", true), "p0"))).toBe(GOTTHARD);
  });

  it("an easy bot ignores dividends: same choice with them on and off", () => {
    expect(bought(chooseBotAction(botTurn("easy", true), "p0"))).toBe(
      bought(chooseBotAction(botTurn("easy", false), "p0")),
    );
  });

  it("a normal bot ignores dividends when they are switched off", () => {
    const off = chooseBotAction(botTurn("normal", false), "p0");
    expect(off?.type).toBe("buy-securities");
  });

  it("a hard bot never buys a company that pays no dividend while paying ones are available", () => {
    for (let rng = 1; rng <= 60; rng++) {
      const s = botTurn("hard", true, "fr");
      s.rng = rng;
      expect(bought(chooseBotAction(s, "p0"))).not.toBe(CAFE);
      expect(bought(chooseBotAction(s, "p0"))).not.toBeNull();
    }
  });

  it("takes profit at +10 %, but a hard bot keeps a dividend payer a little longer", () => {
    for (const level of ["easy", "normal"] as const) {
      const a = chooseBotAction(withLot(botTurn(level, true), GOTTHARD, 78, 70), "p0");
      expect(a, level).toEqual({ type: "sell-securities", secId: GOTTHARD, lot: 0 });
    }
    const hard = chooseBotAction(withLot(botTurn("hard", true), GOTTHARD, 78, 70), "p0");
    expect(hard?.type).not.toBe("sell-securities");
    // far above the buy price it sells anyway
    const far = chooseBotAction(withLot(botTurn("hard", true), GOTTHARD, 100, 70), "p0");
    expect(far).toEqual({ type: "sell-securities", secId: GOTTHARD, lot: 0 });
  });

  it("a hard bot sells a non-paying holding at +10 % and keeps nothing for dividends when they are off", () => {
    const tech = chooseBotAction(withLot(botTurn("hard", true, "fr"), CAFE, 107, 95), "p0");
    expect(tech).toEqual({ type: "sell-securities", secId: CAFE, lot: 0 });
    const off = chooseBotAction(withLot(botTurn("hard", false), GOTTHARD, 78, 70), "p0");
    expect(off).toEqual({ type: "sell-securities", secId: GOTTHARD, lot: 0 });
  });

  it("a hard bot anticipates the decay: it no longer waits for dividends that are about to end", () => {
    const early = chooseBotAction(withLot(botTurn("hard", true), GOTTHARD, 78, 70), "p0");
    expect(early?.type).not.toBe("sell-securities");
    const s = withLot(botTurn("hard", true), GOTTHARD, 78, 70);
    s.round = dividendFloorRound() - 1;
    expect(chooseBotAction(s, "p0")).toEqual({ type: "sell-securities", secId: GOTTHARD, lot: 0 });
    s.round = dividendFloorRound() + 20;
    expect(chooseBotAction(s, "p0")).toEqual({ type: "sell-securities", secId: GOTTHARD, lot: 0 });
  });
});
