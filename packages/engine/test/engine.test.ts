import { describe, expect, it } from "vitest";
import { BOARD } from "../src/board.ts";
import { CARDS } from "../src/cards.ts";
import {
  applyAction,
  handleTimeout,
  legalActions,
  redactState,
  restartClocks,
  setController,
  whoMustAct,
} from "../src/game.ts";
import {
  buildBlocker,
  canBuild,
  formatMoney,
  groupTiles,
  netWorth,
  rentFor,
} from "../src/helpers.ts";
import { chooseBotAction } from "../src/bot.ts";
import { GameError } from "../src/types.ts";
import { act, give, groupOf, mk, rig } from "./util.ts";

describe("board", () => {
  it("has 52 tiles with the documented layout", () => {
    expect(BOARD).toHaveLength(52);
    const sizes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => groupTiles(g).length);
    expect(sizes).toEqual([2, 3, 3, 4, 4, 4, 4, 3, 3, 2]);
    expect(BOARD.filter((t) => t.kind === "station").map((t) => t.index)).toEqual([5, 19, 32, 44]);
    expect(BOARD.filter((t) => t.kind === "utility").map((t) => t.index)).toEqual([15, 35, 42]);
    expect(BOARD.filter((t) => t.kind === "chance").map((t) => t.index)).toEqual([7, 24, 28, 45]);
    expect(BOARD[4]!.taxAmount).toBe(200);
    expect(BOARD[49]!.taxAmount).toBe(100);
    for (const t of BOARD.filter((x) => x.kind === "street")) {
      expect(t.rent).toHaveLength(7);
      expect(t.mortgage).toBe(t.price! / 2);
      const ratio = t.rent![6]! / t.rent![5]!;
      expect(ratio).toBeGreaterThan(1.55);
      expect(ratio).toBeLessThan(1.85);
    }
    expect(BOARD[1]!.price).toBe(60);
    expect(BOARD[51]!.price).toBeGreaterThanOrEqual(400);
  });
  it("card effects only reference valid tiles", () => {
    for (const c of CARDS) {
      if (c.effect.kind === "move-to") {
        expect(BOARD[c.effect.tile]).toBeDefined();
      }
    }
  });
});

describe("rent", () => {
  it("street base, double on full group, houses", () => {
    const s = mk();
    give(s, "p1", [1]);
    expect(rentFor(s, 1, 7)).toBe(BOARD[1]!.rent![0]);
    give(s, "p1", [3]);
    expect(rentFor(s, 1, 7)).toBe(BOARD[1]!.rent![0]! * 2);
    s.properties[1]!.level = 3;
    expect(rentFor(s, 1, 7)).toBe(BOARD[1]!.rent![3]);
    s.properties[1]!.level = 6;
    expect(rentFor(s, 1, 7)).toBe(BOARD[1]!.rent![6]);
    s.properties[1]!.mortgaged = true;
    expect(rentFor(s, 1, 7)).toBe(0);
  });
  it("stations and utilities", () => {
    const s = mk();
    give(s, "p1", [5]);
    expect(rentFor(s, 5, 7)).toBe(25);
    give(s, "p1", [19, 32]);
    expect(rentFor(s, 5, 7)).toBe(100);
    expect(rentFor(s, 5, 7, { stationMultiplier: 2 })).toBe(200);
    give(s, "p1", [15]);
    expect(rentFor(s, 15, 8)).toBe(32);
    give(s, "p1", [35]);
    expect(rentFor(s, 15, 8)).toBe(80);
    expect(rentFor(s, 15, 8, { utilityMultiplier: 10 })).toBe(80);
  });
  it("landing pays rent to owner", () => {
    let s = mk();
    give(s, "p1", [1]);
    s = rig(s, 1, 0 + 1); // total 2 -> tile 2? use position trick
    s.players[0]!.position = 51; // 51+2 -> tile 1, passes GO
    const r = applyAction(s, "p0", { type: "roll" }, 5);
    const rent = BOARD[1]!.rent![0]!;
    expect(r.state.players[0]!.cash).toBe(2000 + 200 - rent);
    expect(r.state.players[1]!.cash).toBe(2000 + rent);
    expect(r.events.some((e) => e.type === "rent")).toBe(true);
    expect(r.state.phase.type).toBe("await-end-turn");
  });
});

describe("purchase and auction", () => {
  it("buy then end turn", () => {
    let s = mk();
    s = rig(s, 2, 1); // tile 3
    s = act(s, "p0", { type: "roll" });
    expect(s.phase).toEqual({ type: "await-buy", tile: 3 });
    s = act(s, "p0", { type: "buy" });
    expect(s.properties[3]!.owner).toBe("p0");
    expect(s.players[0]!.cash).toBe(2000 - 60);
    s = act(s, "p0", { type: "end-turn" });
    expect(s.current).toBe(1);
  });
  it("declining starts an auction; highest bidder wins; rotation and passing", () => {
    let s = mk(3);
    s = rig(s, 2, 1);
    s = act(s, "p0", { type: "roll" });
    s = act(s, "p0", { type: "decline-buy" });
    expect(s.phase.type).toBe("auction");
    expect(whoMustAct(s)).toEqual(["p1"]);
    s = act(s, "p1", { type: "bid", amount: 10 });
    expect(whoMustAct(s)).toEqual(["p2"]);
    expect(() => act(s, "p2", { type: "bid", amount: 10 })).toThrow(GameError);
    s = act(s, "p2", { type: "bid", amount: 20 });
    expect(whoMustAct(s)).toEqual(["p0"]);
    s = act(s, "p0", { type: "pass-auction" });
    expect(whoMustAct(s)).toEqual(["p1"]);
    s = act(s, "p1", { type: "pass-auction" });
    expect(s.properties[3]!.owner).toBe("p2");
    expect(s.players[2]!.cash).toBe(1980);
    expect(s.phase).toEqual({ type: "await-end-turn", canRollAgain: false });
  });
  it("nobody bids -> stays with the bank", () => {
    let s = mk(2);
    s = rig(s, 2, 1);
    s = act(s, "p0", { type: "roll" });
    s = act(s, "p0", { type: "decline-buy" });
    s = act(s, "p1", { type: "pass-auction" });
    expect(s.phase.type).toBe("auction");
    s = act(s, "p0", { type: "pass-auction" });
    expect(s.properties[3]!.owner).toBeNull();
    expect(s.phase.type).toBe("await-end-turn");
  });
  it("no auction when disabled", () => {
    let s = mk(2, { auctions: false });
    s = rig(s, 2, 1);
    s = act(s, "p0", { type: "roll" });
    s = act(s, "p0", { type: "decline-buy" });
    expect(s.phase.type).toBe("await-end-turn");
  });
});

describe("jail and doubles", () => {
  it("three doubles go to jail", () => {
    let s = mk();
    s.players[0]!.position = 1;
    s = rig(s, 1, 1);
    s = act(s, "p0", { type: "roll" });
    expect(s.phase).toMatchObject({ type: "await-buy" });
    s = act(s, "p0", { type: "decline-buy" });
    s = act(s, "p1", { type: "pass-auction" });
    s = act(s, "p2", { type: "pass-auction" });
    s = act(s, "p0", { type: "pass-auction" });
    expect(s.phase).toEqual({ type: "await-end-turn", canRollAgain: true });
    expect(() => act(s, "p0", { type: "end-turn" })).toThrow(GameError);
    s.players[0]!.position = 0;
    s.doublesCount = 2;
    s = rig(s, 3, 3);
    s = act(s, "p0", { type: "roll" });
    expect(s.players[0]!.inJail).toBe(true);
    expect(s.players[0]!.position).toBe(13);
    expect(s.phase).toEqual({ type: "await-end-turn", canRollAgain: false });
  });
  it("go to jail tile", () => {
    let s = mk();
    s.players[0]!.position = 36;
    s = rig(s, 2, 1);
    s = act(s, "p0", { type: "roll" });
    expect(s.players[0]!.inJail).toBe(true);
    expect(s.players[0]!.position).toBe(13);
  });
  it("fine, card, doubles and forced fine after 3 failures", () => {
    const s = mk();
    s.players[0]!.inJail = true;
    s.players[0]!.position = 13;
    expect(legalActions(s, "p0")).toContain("pay-jail-fine");
    const paid = act(s, "p0", { type: "pay-jail-fine" });
    expect(paid.players[0]!.inJail).toBe(false);
    expect(paid.players[0]!.cash).toBe(1950);
    expect(paid.phase.type).toBe("await-roll");
    // card
    const c = structuredClone(s);
    c.players[0]!.jailCards = ["cc-jail-card"];
    const used = act(c, "p0", { type: "use-jail-card" });
    expect(used.players[0]!.inJail).toBe(false);
    expect(used.decks.community).toContain("cc-jail-card");
    // doubles escape: moves but no extra roll
    let d = rig(s, 2, 2);
    d = act(d, "p0", { type: "roll" });
    expect(d.players[0]!.inJail).toBe(false);
    expect(d.players[0]!.position).toBe(17);
    expect(d.phase.type).not.toBe("await-roll");
    // three failures
    let f = structuredClone(s);
    for (let i = 0; i < 3; i++) {
      f = rig(f, 1, 2);
      f.dice = null;
      f = act(f, "p0", { type: "roll" });
      if (i < 2) {
        expect(f.players[0]!.inJail).toBe(true);
        expect(f.phase).toEqual({ type: "await-end-turn", canRollAgain: false });
        f.phase = { type: "await-roll" };
      }
    }
    expect(f.players[0]!.inJail).toBe(false);
    expect(f.players[0]!.cash).toBe(1950);
    expect(f.players[0]!.position).toBe(16);
  });
});

describe("building", () => {
  it("requires full group, builds evenly, skyscraper only after hotels", () => {
    let s = mk(2);
    const g = groupOf(0); // 1, 3
    give(s, "p0", [g[0]!]);
    expect(canBuild(s, "p0", g[0]!)).toBe(false);
    give(s, "p0", [g[1]!]);
    s.players[0]!.cash = 5000;
    expect(canBuild(s, "p0", g[0]!)).toBe(true);
    s = act(s, "p0", { type: "build", tile: g[0]! });
    expect(() => act(s, "p0", { type: "build", tile: g[0]! })).toThrow(GameError); // uneven
    expect(buildBlocker(s, "p0", g[0]!)).toBe("Gleichmässig bauen");
    s = act(s, "p0", { type: "build", tile: g[1]! });
    for (let i = 0; i < 4; i++) {
      s = act(s, "p0", { type: "build", tile: g[0]! });
      s = act(s, "p0", { type: "build", tile: g[1]! });
    }
    expect(s.properties[g[0]!]!.level).toBe(5);
    expect(s.bank.houses).toBe(48);
    expect(s.bank.hotels).toBe(14);
    // skyscraper: needs both hotels (yes) and costs 2x
    const before = s.players[0]!.cash;
    s = act(s, "p0", { type: "build", tile: g[0]! });
    expect(s.properties[g[0]!]!.level).toBe(6);
    expect(before - s.players[0]!.cash).toBe(BOARD[g[0]!]!.buildCost! * 2);
    expect(s.bank.skyscrapers).toBe(7);
    expect(s.bank.hotels).toBe(15);
    // sell skyscraper for 50% of 2x
    const b2 = s.players[0]!.cash;
    s = act(s, "p0", { type: "sell-building", tile: g[0]! });
    expect(s.players[0]!.cash - b2).toBe(BOARD[g[0]!]!.buildCost!);
    expect(s.properties[g[0]!]!.level).toBe(5);
    expect(s.bank.skyscrapers).toBe(8);
  });
  it("skyscraper blocked while a street is below hotel; shortages respected; mortgages block", () => {
    const s = mk(2);
    const g = groupOf(0);
    give(s, "p0", g);
    s.players[0]!.cash = 5000;
    s.properties[g[0]!]!.level = 5;
    s.properties[g[1]!]!.level = 4;
    expect(buildBlocker(s, "p0", g[0]!)).toBe("Alle Strassen brauchen ein Hotel");
    s.bank.hotels = 0;
    expect(buildBlocker(s, "p0", g[1]!)).toBe("Keine Hotels mehr");
    s.bank.houses = 0;
    s.properties[g[1]!]!.level = 2;
    s.properties[g[0]!]!.level = 2;
    expect(buildBlocker(s, "p0", g[1]!)).toBe("Keine Häuser mehr");
    s.bank.houses = 5;
    s.properties[g[0]!]!.mortgaged = true;
    expect(buildBlocker(s, "p0", g[1]!)).toBe("Hypothek in der Gruppe");
  });
  it("mortgage / unmortgage with 10% interest; no mortgage with buildings", () => {
    let s = mk(2);
    const g = groupOf(0);
    give(s, "p0", g);
    s = act(s, "p0", { type: "build", tile: g[0]! });
    expect(() => act(s, "p0", { type: "mortgage", tile: g[1]! })).toThrow(GameError);
    s = act(s, "p0", { type: "sell-building", tile: g[0]! });
    const cash = s.players[0]!.cash;
    s = act(s, "p0", { type: "mortgage", tile: g[0]! });
    expect(s.players[0]!.cash - cash).toBe(30);
    s = act(s, "p0", { type: "unmortgage", tile: g[0]! });
    expect(s.players[0]!.cash).toBe(cash - 3);
  });
});

describe("cards", () => {
  it("card go-to-jail, cash and jail-card effects via forced deck", () => {
    let s = mk(2);
    s.decks.chance = ["ch-jail-card", "ch-speeding"];
    s.players[0]!.position = 5;
    s = rig(s, 1, 1); // 7 = chance
    s = act(s, "p0", { type: "roll" });
    expect(s.players[0]!.jailCards).toEqual(["ch-jail-card"]);
    expect(s.decks.chance).toEqual(["ch-speeding"]);
  });
  it("nearest utility pays 10x dice", () => {
    let s = mk(2);
    s.decks.chance = ["ch-nearest-utility"];
    give(s, "p1", [15]);
    s.players[0]!.position = 5;
    s = rig(s, 1, 1);
    s = act(s, "p0", { type: "roll" });
    expect(s.players[0]!.position).toBe(15);
    expect(s.players[0]!.cash).toBe(2000 - 20);
  });
  it("nearest station pays double rent", () => {
    let s = mk(2);
    s.decks.chance = ["ch-nearest-station"];
    give(s, "p1", [19]);
    s.players[0]!.position = 5;
    s = rig(s, 1, 1);
    s = act(s, "p0", { type: "roll" });
    expect(s.players[0]!.position).toBe(19);
    expect(s.players[0]!.cash).toBe(2000 - 50);
  });
  it("jackpot tax goes to pot, collected on the rest stop", () => {
    let s = mk(2, { freeParkingJackpot: true });
    s.players[0]!.position = 1;
    s = rig(s, 2, 1); // 4 income tax
    s = act(s, "p0", { type: "roll" });
    expect(s.freeParkingPot).toBe(200);
    s = act(s, "p0", { type: "end-turn" });
    s.players[1]!.position = 23;
    s = rig(s, 2, 1);
    s = act(s, "p1", { type: "roll" });
    expect(s.players[1]!.cash).toBe(2200);
    expect(s.freeParkingPot).toBe(0);
  });
});

describe("trades", () => {
  const offer = (to: string, extra: object = {}) => ({
    to,
    giveCash: 0,
    giveTiles: [] as number[],
    giveJailCards: 0,
    wantCash: 0,
    wantTiles: [] as number[],
    wantJailCards: 0,
    ...extra,
  });
  it("propose, accept, swaps assets", () => {
    let s = mk(3);
    give(s, "p0", [1]);
    give(s, "p1", [3]);
    s = act(s, "p2", {
      type: "propose-trade",
      offer: offer("p0", { giveCash: 100, wantTiles: [1] }),
    }); // anyone, any time
    expect(s.trades[0]!.expiresAt).toBe(2000 + 120_000);
    const id = s.trades[0]!.id;
    expect(() => act(s, "p1", { type: "respond-trade", tradeId: id, accept: true })).toThrow(
      GameError,
    );
    s = act(s, "p0", { type: "respond-trade", tradeId: id, accept: true });
    expect(s.trades[0]!.status).toBe("accepted");
    expect(s.properties[1]!.owner).toBe("p2");
    expect(s.players[0]!.cash).toBe(2100);
    expect(s.players[2]!.cash).toBe(1900);
  });
  it("rejects invalid proposals and revalidates on accept", () => {
    let s = mk(3);
    give(s, "p0", groupOf(0));
    s.properties[1]!.level = 1;
    expect(() =>
      act(s, "p0", { type: "propose-trade", offer: offer("p1", { giveTiles: [1] }) }),
    ).toThrow(GameError);
    s.properties[1]!.level = 0;
    expect(() =>
      act(s, "p0", { type: "propose-trade", offer: offer("p1", { giveTiles: [6] }) }),
    ).toThrow(GameError);
    s = act(s, "p0", { type: "propose-trade", offer: offer("p1", { giveTiles: [1] }) });
    const id = s.trades[0]!.id;
    s.properties[1]!.owner = "p2"; // changes before accept
    const after = act(s, "p1", { type: "respond-trade", tradeId: id, accept: true });
    expect(after.trades[0]!.status).toBe("invalid");
    expect(after.properties[1]!.owner).toBe("p2");
  });
  it("mortgaged tile costs receiver 10% interest; cancel; reject", () => {
    let s = mk(2);
    give(s, "p0", [1]);
    s.properties[1]!.mortgaged = true;
    s = act(s, "p0", { type: "propose-trade", offer: offer("p1", { giveTiles: [1] }) });
    s = act(s, "p1", { type: "respond-trade", tradeId: s.trades[0]!.id, accept: true });
    expect(s.players[1]!.cash).toBe(2000 - 3);
    s = act(s, "p1", { type: "propose-trade", offer: offer("p0", { giveCash: 10 }) });
    const id = s.trades[1]!.id;
    s = act(s, "p1", { type: "cancel-trade", tradeId: id });
    expect(s.trades[1]!.status).toBe("cancelled");
  });
  it("no expiry for bot targets, expires for humans on timeout", () => {
    let s = mk(2);
    s.players[1]!.controller = "bot";
    s = act(s, "p0", { type: "propose-trade", offer: offer("p1", { giveCash: 10 }) });
    expect(s.trades[0]!.expiresAt).toBeNull();
    let h = mk(2);
    h = act(h, "p1", { type: "propose-trade", offer: offer("p0", { giveCash: 10 }) }, 5000);
    const r = handleTimeout(h, 5000 + 120_001);
    expect(r.state.trades[0]!.status).toBe("expired");
  });
});

describe("debt and bankruptcy", () => {
  it("debt phase resolves automatically after raising money by mortgage", () => {
    let s = mk(2);
    give(s, "p1", groupOf(9)); // 50, 51
    give(s, "p0", [1, 6, 8]);
    s.players[0]!.cash = 20;
    s.players[0]!.position = 47;
    s = rig(s, 2, 1); // 47+3 = 50
    s = act(s, "p0", { type: "roll" });
    expect(s.phase.type).toBe("debt");
    const owed = (s.phase as { amount: number }).amount;
    expect(whoMustAct(s)).toEqual(["p0"]);
    expect(legalActions(s, "p0")).toContain("declare-bankruptcy");
    expect(() => act(s, "p0", { type: "end-turn" })).toThrow(GameError);
    expect(owed).toBeGreaterThan(20);
    expect(owed).toBeLessThanOrEqual(70);
    s = act(s, "p0", { type: "mortgage", tile: 6 }); // +50 -> cash 70 covers it, resumes automatically
    expect(s.phase.type).toBe("await-end-turn");
    expect(s.players[0]!.cash).toBe(70 - owed);
    expect(s.players[1]!.cash).toBe(2000 + owed);
  });
  it("bankruptcy to creditor transfers everything; last player wins", () => {
    let s = mk(2);
    give(s, "p1", groupOf(9));
    give(s, "p0", [1]);
    s.players[0]!.cash = 5;
    s.players[0]!.position = 47;
    s = rig(s, 2, 1);
    s = act(s, "p0", { type: "roll" });
    expect(s.phase.type).toBe("debt");
    const r = applyAction(s, "p0", { type: "declare-bankruptcy" }, 3000);
    expect(r.state.players[0]!.bankrupt).toBe(true);
    expect(r.state.properties[1]!.owner).toBe("p1");
    expect(r.state.players[1]!.cash).toBe(2005);
    expect(r.state.status).toBe("finished");
    expect(r.state.phase).toMatchObject({ type: "game-over", winner: "p1" });
    expect(r.events.at(-1)).toMatchObject({ type: "game-over", winner: "p1" });
    expect(() => act(r.state, "p1", { type: "roll" })).toThrow(GameError);
  });
  it("bankruptcy to the bank releases properties; game continues with 3 players", () => {
    let s = mk(3);
    give(s, "p0", [1, 3]);
    s.properties[1]!.level = 2;
    s.bank.houses = 40;
    s.players[0]!.cash = 5;
    s.players[0]!.position = 1;
    s = rig(s, 1, 2); // 4 = income tax 200
    s = act(s, "p0", { type: "roll" });
    expect(s.phase.type).toBe("debt");
    s = act(s, "p0", { type: "declare-bankruptcy" });
    expect(s.properties[1]).toEqual({ owner: null, level: 0, mortgaged: false });
    expect(s.bank.houses).toBe(42);
    expect(s.current).toBe(1);
    expect(s.status).toBe("running");
  });
});

describe("turn limits and rounds", () => {
  it("rounds count and maxRounds ends the game with richest winning", () => {
    let s = mk(2, { maxRounds: 1 });
    s.players[1]!.cash = 5000;
    s = act(s, "p0", { type: "roll" }); // whatever lands
    // resolve whatever phase
    for (let i = 0; i < 10 && s.phase.type !== "game-over"; i++) {
      const a = chooseBotAction(s, whoMustAct(s)[0]!)!;
      s = act(s, whoMustAct(s)[0]!, a);
    }
    expect(s.status).toBe("finished");
    expect(s.phase).toMatchObject({ type: "game-over", winner: "p1" });
  });
});

describe("timeouts and away", () => {
  it("bot acts for timed-out human; away after missed turns; human action returns", () => {
    let s = mk(3, { turnTimeoutSec: 10, awayAfterMissedTurns: 2 });
    expect(s.deadline).toBe(1000 + 10_000);
    // before deadline nothing happens
    expect(handleTimeout(s, 5000).state).toBe(s);
    let r = handleTimeout(s, 12_000);
    s = r.state;
    expect(s.current).toBe(1); // p0's whole turn played by the bot
    expect(s.players[0]!.missedTurns).toBe(1);
    expect(s.players[0]!.controller).toBe("human");
    expect(s.deadline).toBe(12_000 + 10_000);
    // p1 + p2 time out too (each once), then p0's second miss
    r = handleTimeout(s, 30_000);
    s = r.state;
    expect(s.players[1]!.missedTurns).toBe(1);
    expect(s.current).toBe(2);
    r = handleTimeout(s, 60_000);
    s = r.state;
    expect(s.current).toBe(0);
    r = handleTimeout(s, 100_000);
    s = r.state;
    expect(s.players[0]!.missedTurns).toBe(2);
    expect(s.players[0]!.controller).toBe("away");
    expect(r.events.some((e) => e.type === "controller" && e.controller === "away")).toBe(true);
    // away players are played immediately by handleTimeout when they are to act
    let a = setController(s, "p0", "away").state;
    a = { ...a, current: 0, phase: { type: "await-roll" }, deadline: null, dice: null };
    const r2 = handleTimeout(a, 100_001);
    expect(r2.state.current).not.toBe(0);
    // returning
    const b = structuredClone(s);
    b.players[0]!.controller = "away";
    b.current = 0;
    b.phase = { type: "await-roll" };
    const back = applyAction(b, "p0", { type: "roll" }, 200_000);
    expect(back.state.players[0]!.controller).toBe("human");
    expect(back.state.players[0]!.missedTurns).toBe(0);
    expect(back.events.some((e) => e.type === "controller" && e.controller === "human")).toBe(true);
  });
  it("does not mutate input, redacts rng and decks", () => {
    const s = mk();
    const snap = JSON.stringify(s);
    applyAction(s, "p0", { type: "roll" }, 5);
    expect(JSON.stringify(s)).toBe(snap);
    const pub = redactState(s) as unknown as Record<string, unknown>;
    expect(pub.rng).toBeUndefined();
    expect(pub.decks).toEqual({ chance: 16, community: 16 });
  });
  it("rejects actions by the wrong player", () => {
    const s = mk();
    expect(() => act(s, "p1", { type: "roll" })).toThrow(GameError);
    expect(legalActions(s, "p1")).not.toContain("roll");
    expect(legalActions(s, "p0")).toContain("roll");
  });
});

describe("helpers", () => {
  it("formatMoney and netWorth", () => {
    expect(formatMoney({ currency: { symbol: "CHF", position: "before" } }, 12345)).toBe(
      "CHF 12'345",
    );
    expect(formatMoney({ currency: { symbol: "€", position: "after" } }, 200)).toBe("200 €");
    const s = mk();
    expect(netWorth(s, "p0")).toBe(2000);
    give(s, "p0", [1]);
    expect(netWorth(s, "p0")).toBe(2060);
  });
});

describe("restartClocks (a game that waited for its players)", () => {
  it("gives the current human a full new turn time, and pending trades/votes a full new window", () => {
    const s = mk(3, { turnTimeoutSec: 10, awayAfterMissedTurns: 2 });
    expect(s.deadline).toBe(1000 + 10_000);
    const r = restartClocks(s, 500_000);
    expect(r.state.deadline).toBe(510_000);
    expect(r.state.version).toBe(s.version + 1);
    expect(r.state.players.map((p) => p.missedTurns)).toEqual(s.players.map((p) => p.missedTurns));
    // the input is not mutated
    expect(s.deadline).toBe(11_000);
  });

  it("leaves games without clocks alone", () => {
    const s = mk(3, { turnTimeoutSec: 0 });
    expect(s.deadline).toBeNull();
    expect(restartClocks(s, 500_000).state).toBe(s);
  });

  it("moves the expiry of open trades and of an end vote", () => {
    let s = mk(3, { turnTimeoutSec: 10 });
    s = {
      ...s,
      trades: [
        {
          id: "t1",
          from: s.players[0]!.id,
          to: s.players[1]!.id,
          status: "pending",
          createdAt: 1000,
          expiresAt: 11_000,
          giveCash: 1,
          wantCash: 0,
          giveTiles: [],
          wantTiles: [],
          giveJailCards: 0,
          wantJailCards: 0,
        },
      ],
      endVote: {
        by: s.players[0]!.id,
        votes: { [s.players[0]!.id]: true },
        createdAt: 1000,
        expiresAt: 11_000,
      },
    };
    const r = restartClocks(s, 500_000).state;
    expect(r.trades[0]?.expiresAt).toBe(510_000);
    expect(r.endVote?.expiresAt).toBe(510_000);
  });
});
