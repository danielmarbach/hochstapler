// Bots in the show-off mode (docs/DESIGN.md #93): who borrows, for what, and when they repay.
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.ts";
import { applyBotAction, createGame, whoMustAct } from "../src/game.ts";
import { loanDebt } from "../src/loans.ts";
import { GameActionSchema } from "../src/schemas.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { BotLevel, GameState, PlayerState } from "../src/types.ts";
import { assertInvariants } from "./invariants.ts";
import { give, groupOf } from "./util.ts";
import { seatPlayers } from "./sim.ts";

function botGame(level: BotLevel, n = 3): GameState {
  const players = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    color: "#fff",
    tokenId: `t${i}`,
    controller: "bot" as const,
    botLevel: i === 0 ? level : ("normal" as const),
  }));
  return createGame("b", players, { ...DEFAULT_SETTINGS, loans: true, turnTimeoutSec: 0 }, 7, 0)
    .state;
}

function me(s: GameState): PlayerState {
  const p = s.players[0];
  if (!p) {
    throw new Error("no p0");
  }
  return p;
}

/** p0 stands on the last free tile of group 5 (owns the others) and has `cash`. */
function onCompletingTile(level: BotLevel, cash: number): GameState {
  const s = botGame(level);
  const [first, ...rest] = groupOf(5);
  give(s, "p0", rest);
  me(s).cash = cash;
  me(s).position = first ?? 0;
  s.phase = { type: "await-buy", tile: first ?? 0 };
  return s;
}

/** p0 owns group 7 (three streets, price 350) at `level` and has `cash`, after rolling. */
function onFullSet(level: BotLevel, buildings: 0 | 1 | 2 | 3, cash: number): GameState {
  const s = botGame(level);
  give(s, "p0", groupOf(7));
  for (const t of groupOf(7)) {
    const pr = s.properties[t];
    if (pr) {
      pr.level = buildings;
    }
  }
  s.bank.houses -= buildings * groupOf(7).length;
  me(s).cash = cash;
  s.phase = { type: "await-end-turn", canRollAgain: false };
  return s;
}

describe("bots and bank loans", () => {
  it("easy bots never borrow, not even for the tile that completes a group", () => {
    const s = onCompletingTile("easy", 100);
    expect(chooseBotAction(s, "p0")).toEqual({ type: "decline-buy" });
    const m = onFullSet("easy", 2, 100);
    expect(chooseBotAction(m, "p0")).toEqual({ type: "end-turn" });
  });

  it("normal and hard bots borrow just enough for the completing tile, then buy it", () => {
    for (const level of ["normal", "hard"] as const) {
      let s = onCompletingTile(level, 100);
      const a = chooseBotAction(s, "p0");
      expect(a).toEqual({ type: "take-loan", amount: 200 }); // price 240 - 100 cash -> 200
      s = applyBotAction(s, "p0", a ?? { type: "decline-buy" }, 1).state;
      expect(chooseBotAction(s, "p0")).toEqual({ type: "buy" });
    }
  });

  it("does not borrow for a tile that completes nothing", () => {
    const s = onCompletingTile("normal", 100);
    const [, second] = groupOf(5);
    if (second !== undefined) {
      const pr = s.properties[second];
      if (pr) {
        pr.owner = "p1";
      }
    }
    expect(chooseBotAction(s, "p0")).toEqual({ type: "decline-buy" });
  });

  it("a normal bot borrows for the third house on a full colour set and builds right away", () => {
    let s = onFullSet("normal", 2, 300);
    const a = chooseBotAction(s, "p0");
    expect(a?.type).toBe("take-loan");
    s = applyBotAction(s, "p0", a ?? { type: "end-turn" }, 1).state;
    expect(chooseBotAction(s, "p0")?.type).toBe("build");
    // one loan at a time: after building the bot does not borrow again
    for (let i = 0; i < 20; i++) {
      const next = chooseBotAction(s, "p0");
      if (!next || next.type === "end-turn") {
        break;
      }
      expect(next.type).not.toBe("take-loan");
      s = applyBotAction(s, "p0", next, 2 + i).state;
      assertInvariants(s);
    }
    expect(loanDebt(me(s))).toBeGreaterThan(0);
  });

  it("a normal bot does not borrow for the first houses (they do not pay the interest)", () => {
    const s = onFullSet("normal", 0, 200);
    expect(chooseBotAction(s, "p0")).toEqual({ type: "end-turn" });
  });

  it("a hard bot borrows only when the extra rent beats the interest at its own rate", () => {
    // the others are far richer, so p0 borrows at the bottom rate (4 %)
    const poor = (s: GameState): GameState => {
      for (const p of s.players.slice(1)) {
        p.cash = 8000;
      }
      return s;
    };
    const cheap = poor(onFullSet("hard", 0, 200));
    expect(chooseBotAction(cheap, "p0")).toEqual({ type: "end-turn" });
    const steep = poor(onFullSet("hard", 2, 200));
    expect(chooseBotAction(steep, "p0")?.type).toBe("take-loan");
    // as the leader it pays 25 %: the third house does not earn that back
    const leader = onFullSet("hard", 2, 200);
    expect(chooseBotAction(leader, "p0")).toEqual({ type: "end-turn" });
  });

  it("repays before rolling once the cash comfortably allows, keeping a cushion", () => {
    const s = botGame("normal");
    me(s).loans = [{ amount: 500, ratePct: 8 }];
    me(s).cash = 300; // normal reserve 150 + cushion 100
    expect(chooseBotAction(s, "p0")).toEqual({ type: "roll" });
    me(s).cash = 700;
    expect(chooseBotAction(s, "p0")).toEqual({ type: "repay-loan", amount: 400 });
    me(s).cash = 5000;
    expect(chooseBotAction(s, "p0")).toEqual({ type: "repay-loan", amount: 500 });
  });

  it("a hard bot repays more greedily when its rate is high", () => {
    const s = botGame("hard");
    me(s).loans = [{ amount: 500, ratePct: 20 }];
    me(s).cash = 400;
    // hard reserve 100: keeps only the bare reserve at a high rate
    expect(chooseBotAction(s, "p0")).toEqual({ type: "repay-loan", amount: 300 });
    me(s).loans = [{ amount: 500, ratePct: 6 }];
    expect(chooseBotAction(s, "p0")).toEqual({ type: "repay-loan", amount: 200 });
  });

  it("all-bot games with loans finish without loops, deterministically, with valid actions", () => {
    let borrowed = 0;
    const play = (seed: number): GameState => {
      let s = createGame(
        "d",
        seatPlayers(["bot", "bot", "bot", "bot"], seed),
        { ...DEFAULT_SETTINGS, loans: true, turnTimeoutSec: 0 },
        seed,
        0,
      ).state;
      for (let i = 0; i < 20_000 && s.status === "running" && s.round <= 150; i++) {
        const pid = whoMustAct(s)[0] ?? "p0";
        const a = chooseBotAction(s, pid);
        if (!a) {
          throw new Error("bot without action");
        }
        expect(GameActionSchema.safeParse(a).success).toBe(true);
        if (a.type === "take-loan") {
          borrowed++;
        }
        s = applyBotAction(s, pid, a, i).state;
      }
      return s;
    };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = play(seed);
      expect(a.status === "finished" || a.round > 150).toBe(true);
      expect(play(seed)).toStrictEqual(a);
      assertInvariants(a);
    }
    expect(borrowed).toBeGreaterThan(0);
  });
});
