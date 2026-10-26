import { describe, expect, it } from "vitest";
import { BOARD } from "../src/board.ts";
import { chooseBotAction } from "../src/bot.ts";
import { applyAction, legalActions, whoMustAct } from "../src/game.ts";
import { buildBlocker, maxBid, netWorth, sellBlocker } from "../src/helpers.ts";
import type { GameAction } from "../src/types.ts";
import { given, group, rentOf } from "./scenario.ts";

const TAX_TILE = 4;
const LAST_GROUP = 9;
/** Rolling 2 + 1 from tile 47 lands on tile 50, the first street of the last group. */
const RENT_TILE = 50;
const BOTH_STREETS_RENT = rentOf(RENT_TILE) * 2;

describe("Debts and bankruptcy", () => {
  it("hands mortgaged properties and jail cards to the creditor and keeps decks consistent", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .player("Ben")
      .owns(group(LAST_GROUP))
      .player("Anna")
      .cash(5)
      .at(47)
      .owns(1)
      .mortgaged()
      .owns(5)
      .jailCard("ch-jail-card")
      .jailCard("cc-jail-card")
      .when("Anna")
      .rolls(2, 1)
      .then()
      .phaseType()
      .is("debt")
      .when("Anna")
      .declaresBankruptcy()
      .then()
      .owner(1)
      .is("Ben")
      .isMortgaged(1)
      .is(true)
      .level(1)
      .is(0)
      .owner(5)
      .is("Ben")
      .isMortgaged(5)
      .is(false)
      .jailCards("Ben")
      .is(["cc-jail-card", "ch-jail-card"])
      .jailCards("Anna")
      .is([])
      .that((s) => expect(s.current).toBe(1));
  });

  it("returns jail cards to the decks and clears mortgages when going bankrupt to the bank", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .player("Anna")
      .owns(1)
      .owns(3)
      .mortgaged()
      .jailCard("ch-jail-card")
      .cash(5)
      .at(1)
      .when("Anna")
      .rolls(1, 2) // tile 4: income tax
      .then()
      .phase()
      .matches({ type: "debt", creditor: null })
      .when("Anna")
      .declaresBankruptcy()
      .then()
      .that((s) => expect(s.decks.chance).toContain("ch-jail-card"))
      .owner(3)
      .is(null)
      .level(3)
      .is(0)
      .isMortgaged(3)
      .is(false)
      .phaseType()
      .is("await-roll")
      .that((s) => expect(whoMustAct(s)).toEqual(["p1"]));
  });

  it("declares the last survivor winner when two players go bankrupt one after another", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .player("Carl")
      .owns(group(LAST_GROUP))
      .player("Anna")
      .cash(1)
      .at(47)
      .when("Anna")
      .rolls(2, 1)
      .when("Anna")
      .declaresBankruptcy()
      .then()
      .status()
      .is("running")
      .and()
      .meanwhile((s) => {
        const ben = s.players[1]!;
        ben.cash = 1;
        ben.position = 47;
      })
      .when("Ben")
      .rolls(2, 1)
      .then()
      .phase()
      .matches({ type: "debt", debtor: "p1", creditor: "p2" })
      .when("Ben")
      .declaresBankruptcy()
      .then()
      .status()
      .is("finished")
      .phase()
      .matches({ type: "game-over", winner: "p2", reason: "last-player" })
      .winner()
      .is("Carl")
      .deadline()
      .is(null);
  });

  it("lets a timed-out human debtor be handled by the bot (mortgage or bankruptcy) without breaking invariants", () => {
    given()
      .players("Anna", "Ben")
      .settings({ turnTimeoutSec: 30 })
      .player("Ben")
      .owns(group(LAST_GROUP))
      .player("Anna")
      .owns(1)
      .owns(3)
      .cash(5)
      .at(47)
      .when("Anna")
      .rolls(2, 1)
      .then()
      .phaseType()
      .is("debt")
      .deadline()
      .is(32_000)
      .and()
      .timesOut(40_000)
      .then()
      .missedTurns("Anna")
      .is(1)
      .that((s) => expect(s.phase.type).not.toBe("debt"));
  });

  it("leaves only bankruptcy to a debtor who cannot sell a hotel because the bank has no houses", () => {
    given()
      .players("Anna", "Ben")
      .settings({ buildingLimits: { houses: 0, hotels: 16, skyscrapers: 8 } })
      .player("Ben")
      .owns(group(LAST_GROUP))
      .player("Anna")
      .owns(group(0))
      .withLevel(5)
      .cash(0)
      .at(47)
      .when("Anna")
      .rolls(2, 1)
      .then()
      .phaseType()
      .is("debt")
      .legal("Anna")
      .contains("declare-bankruptcy")
      .legal("Anna")
      .excludes("sell-building", "mortgage")
      .when("Anna")
      .declaresBankruptcy()
      .then()
      .bank()
      .is({ houses: 0, hotels: 16, skyscrapers: 8 });
  });
});

describe("Miete", () => {
  it("pays no rent on own or mortgaged property", () => {
    given()
      .players("Anna", "Ben")
      .player("Anna")
      .owns(3)
      .at(1)
      .when("Anna")
      .rolls(1, 1) // doubles -> tile 3, own property
      .then()
      .cash("Anna")
      .is(2000)
      .phase()
      .is({ type: "await-end-turn", canRollAgain: true });
    given()
      .players("Anna", "Ben")
      .player("Ben")
      .owns(3)
      .mortgaged()
      .player("Anna")
      .at(1)
      .when("Anna")
      .rolls(1, 1)
      .then()
      .cash("Anna")
      .is(2000)
      .cash("Ben")
      .is(2000);
  });

  it("allows the doubles re-roll after a debt is settled and still sends the third double to jail", () => {
    given()
      .players("Anna", "Ben")
      .player("Ben")
      .owns(3)
      .player("Anna")
      .owns(1)
      .cash(0)
      .at(1)
      .turnState(1, [2, 2], { type: "await-end-turn", canRollAgain: true })
      .when("Anna")
      .rolls(1, 1) // 2nd double -> tile 3 owned by Ben
      .then()
      .phaseType()
      .is("debt")
      .legal("Anna")
      .excludes("roll")
      .when("Anna")
      .does({ type: "mortgage", tile: 1 })
      .then()
      .phase()
      .is({ type: "await-end-turn", canRollAgain: true })
      .when("Anna")
      .rolls(3, 3)
      .then()
      .inJail("Anna")
      .is(true)
      .phase()
      .is({ type: "await-end-turn", canRollAgain: false });
  });

  it("charges 10x the dice for the nearest utility whatever the number of utilities owned", () => {
    for (const owned of [[35], [15, 35], [15, 35, 42]]) {
      given()
        .players("Anna", "Ben")
        .player("Ben")
        .owns(owned)
        .nextCard("chance", "ch-nearest-utility")
        .player("Anna")
        .at(20) // + 4 = 24 (chance), nearest utility is 35
        .when("Anna")
        .rolls(3, 1)
        .then()
        .position("Anna")
        .is(35)
        .pays("Anna", "Ben", 10 * 4);
    }
  });

  it("pays doubled station rent after a wrap-around nearest-station card", () => {
    given()
      .players("Anna", "Ben")
      .player("Ben")
      .owns(5)
      .nextCard("chance", "ch-nearest-station")
      .player("Anna")
      .at(41)
      .when("Anna")
      .rolls(3, 1)
      .then()
      .cash("Anna")
      .is(2000 + 200 - 50)
      .cash("Ben")
      .is(2000 + 50);
  });
});

describe("Karten", () => {
  it("collects GO when the nearest station is behind the player (wrap-around)", () => {
    given()
      .players("Anna", "Ben")
      .nextCard("chance", "ch-nearest-station")
      .player("Anna")
      .at(41) // + 4 = 45 (chance)
      .when("Anna")
      .rolls(3, 1)
      .then()
      .position("Anna")
      .is(5)
      .cash("Anna")
      .is(2000 + 200)
      .phase()
      .is({ type: "await-buy", tile: 5 });
  });

  it("draws a second card when moving back 3 lands on a community card", () => {
    given()
      .players("Anna", "Ben")
      .nextCard("chance", "ch-back-3")
      .nextCard("community", "cc-bank-error")
      .player("Anna")
      .at(20)
      .when("Anna")
      .rolls(3, 1) // 24 = chance
      .then()
      .position("Anna")
      .is(21)
      .cash("Anna")
      .is(2200);
  });

  it("moving back 3 from chance tile 7 lands on income tax", () => {
    given()
      .players("Anna", "Ben")
      .nextCard("chance", "ch-back-3")
      .player("Anna")
      .at(3)
      .when("Anna")
      .rolls(3, 1) // 7
      .then()
      .position("Anna")
      .is(TAX_TILE)
      .cash("Anna")
      .is(2000 - (BOARD[TAX_TILE]?.taxAmount ?? NaN));
  });

  it("card cash-to-each pays every opponent when affordable", () => {
    given()
      .players("Anna", "Ben", "Carl", "Dora")
      .nextCard("chance", "ch-chairman")
      .player("Anna")
      .at(20)
      .when("Anna")
      .rolls(3, 1)
      .then()
      .cash("Anna")
      .is(2000 - 150)
      .cash("Ben")
      .is(2050)
      .cash("Carl")
      .is(2050)
      .cash("Dora")
      .is(2050);
  });

  it("card cash-to-each skips bankrupt opponents and enters debt when short", () => {
    given()
      .players("Anna", "Ben", "Carl", "Dora")
      .player("Dora")
      .bankrupt()
      .nextCard("chance", "ch-chairman")
      .player("Anna")
      .at(20)
      .cash(60)
      .owns(1)
      .when("Anna")
      .rolls(3, 1)
      .then()
      .phase()
      .matches({ type: "debt", debtor: "p0", amount: 100 });
  });
});

describe("Building and skyscrapers", () => {
  it("blocks selling a hotel with fewer than 4 houses in the bank and a skyscraper without a hotel in the bank", () => {
    const [a, b] = group(0) as [number, number];
    const hotelsOnGroup = (houses: number) =>
      given()
        .players("Anna", "Ben")
        .settings({ buildingLimits: { houses, hotels: 16, skyscrapers: 8 } })
        .player("Anna")
        .owns(group(0))
        .withLevel(5)
        .then();
    hotelsOnGroup(3).that((s) => expect(sellBlocker(s, "p0", a)).not.toBeNull());
    hotelsOnGroup(4).that((s) => expect(sellBlocker(s, "p0", a)).toBeNull());

    const skyscrapersOnGroup = (hotels: number) =>
      given()
        .players("Anna", "Ben")
        .settings({ buildingLimits: { houses: 48, hotels, skyscrapers: 8 } })
        .player("Anna")
        .owns(group(0))
        .withLevel(6)
        .then();
    skyscrapersOnGroup(0).that((s) => expect(sellBlocker(s, "p0", a)).not.toBeNull());
    skyscrapersOnGroup(1).that((s) => {
      expect(sellBlocker(s, "p0", a)).toBeNull();
      expect(buildBlocker(s, "p0", a)).not.toBeNull();
      expect(buildBlocker(s, "p0", b)).not.toBeNull();
    });
  });
});

describe("Handel", () => {
  it("marks a trade invalid when the offered property changed owner meanwhile", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .player("Anna")
      .owns(1)
      .when("Anna")
      .proposesTrade("Ben", { giveTiles: [1], wantCash: 50 })
      .when("Anna")
      .proposesTrade("Carl", { giveTiles: [1], wantCash: 10 })
      .when("Carl")
      .acceptsTrade()
      .then()
      .owner(1)
      .is("Carl")
      .trades()
      .is(["invalid", "accepted"])
      .rejectsTradeResponse("Ben", 0, /nicht mehr offen/);
  });

  it("marks a trade invalid when the group got buildings or cash vanished before accepting", () => {
    const [first] = group(0) as [number];
    given()
      .players("Anna", "Ben")
      .player("Anna")
      .owns(group(0))
      .player("Ben")
      .owns(5)
      .when("Ben")
      .proposesTrade("Anna", { wantTiles: [first], giveCash: 100 })
      .and()
      .meanwhile((s) => {
        const pr = s.properties[first];
        if (pr) {
          pr.level = 1;
        }
      })
      .atTime(3000)
      .when("Anna")
      .acceptsTrade()
      .then()
      .trades()
      .is(["invalid"])
      .owner(first)
      .is("Anna");

    given()
      .players("Anna", "Ben")
      .player("Anna")
      .owns(1)
      .when("Ben")
      .proposesTrade("Anna", { wantTiles: [1], giveCash: 1500 })
      .and()
      .meanwhile((s) => {
        const ben = s.players[1];
        if (ben) {
          ben.cash = 100;
        }
      })
      .atTime(3000)
      .when("Anna")
      .acceptsTrade()
      .then()
      .trades()
      .is(["invalid"])
      .cash("Ben")
      .is(100);
  });

  it("lets a debtor settle the debt by accepting a cash trade", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .player("Ben")
      .owns(group(LAST_GROUP))
      .player("Anna")
      .cash(5)
      .at(47)
      .when("Anna")
      .rolls(2, 1)
      .then()
      .phase()
      .matches({ type: "debt", amount: BOTH_STREETS_RENT })
      .when("Carl")
      .proposesTrade("Anna", { giveCash: BOTH_STREETS_RENT + 10 })
      .when("Anna")
      .acceptsTrade()
      .then()
      .phaseType()
      .is("await-end-turn");
  });
});

describe("Auktion", () => {
  it("ends with the bank keeping the tile when everyone passes, with 3 and with 6 players", () => {
    for (const names of [
      ["Anna", "Ben", "Carl"],
      ["Anna", "Ben", "Carl", "Dora", "Eva", "Finn"],
    ]) {
      let scenario = given()
        .players(...names)
        .when("Anna")
        .rolls(2, 1)
        .when("Anna")
        .declinesToBuy();
      for (const name of names.slice(1)) {
        scenario.then().phaseType().is("auction");
        scenario = scenario.when(name).passesAuction();
      }
      scenario
        .then()
        .phaseType()
        .is("auction") // the decliner is asked last
        .when("Anna")
        .passesAuction()
        .then()
        .owner(3)
        .is(null)
        .phase()
        .is({ type: "await-end-turn", canRollAgain: false });
    }
  });

  it("lets a player bid above their cash up to what they can raise (maxBid) and win", () => {
    const scenario = auctionWithPoorBen();
    scenario.then().legal("Ben").contains("bid");
    expect(maxBid(scenario.state, "p1")).toBe(150); // 20 cash + 30 + 100 mortgages + 30 for the tile
    scenario
      .when("Ben")
      .bids(150)
      .when("Carl")
      .passesAuction()
      .when("Anna")
      .passesAuction()
      .then()
      .owner(3)
      .is("Ben")
      .phase()
      .is({ type: "debt", debtor: "p1", creditor: null, amount: 150, auctionTile: 3 })
      .cash("Ben")
      .is(20);
  });

  it("lets the winner raise the money by mortgaging, pays the bank and resumes the turn", () => {
    auctionWithPoorBen()
      .when("Ben")
      .bids(150)
      .when("Carl")
      .passesAuction()
      .when("Anna")
      .passesAuction()
      .then()
      .legal("Ben")
      .contains("mortgage", "declare-bankruptcy")
      .when("Ben")
      .does({ type: "mortgage", tile: 3 }) // the just-won tile
      .then()
      .phaseType()
      .is("debt")
      .when("Ben")
      .does({ type: "mortgage", tile: 5 })
      .then()
      .cash("Ben")
      .is(0)
      .owner(3)
      .is("Ben")
      .isMortgaged(3)
      .is(true)
      .phase()
      .is({ type: "await-end-turn", canRollAgain: false })
      .when("Anna")
      .endsTurn()
      .then()
      .phaseType()
      .is("await-roll");
  });

  it("rejects a bid above what the bidder could ever raise", () => {
    const scenario = auctionWithPoorBen();
    expect(() => applyAction(scenario.state, "p1", { type: "bid", amount: 151 }, 0)).toThrow(
      /nicht auftreiben/,
    );
    scenario.then().phaseType().is("auction");
  });

  it("returns the properties to the bank when the winner cannot or will not raise the money and goes bankrupt, and the turn continues", () => {
    auctionWithPoorBen()
      .when("Ben")
      .bids(150)
      .when("Carl")
      .passesAuction()
      .when("Anna")
      .passesAuction()
      .when("Ben")
      .declaresBankruptcy()
      .then()
      .bankrupt("Ben")
      .is(true)
      .owner(3)
      .is(null)
      .owner(5)
      .is(null)
      .phase()
      .is({ type: "await-end-turn", canRollAgain: false })
      .when("Anna")
      .endsTurn()
      .then()
      .phaseType()
      .is("await-roll");
  });

  it("keeps bot bids within their cash", () => {
    const scenario = given()
      .players("Anna", "Bot Ben", "Carl")
      .player("Bot Ben")
      .cash(70)
      .owns(group(LAST_GROUP))
      .when("Anna")
      .rolls(2, 1)
      .when("Anna")
      .declinesToBuy();
    const action = chooseBotAction(scenario.state, "p1");
    if (action?.type === "bid") {
      expect(action.amount).toBeLessThanOrEqual(70);
    }
    expect(() =>
      applyAction(scenario.state, "p1", action ?? { type: "pass-auction" }, 0),
    ).not.toThrow();
  });
});

/** Anna rolls onto tile 3 and declines; Ben (cash 20, tiles 5 and 3-worth of mortgages) bids first. */
function auctionWithPoorBen() {
  return given()
    .players("Anna", "Ben", "Carl")
    .player("Ben")
    .cash(20)
    .owns(5)
    .when("Anna")
    .rolls(2, 1)
    .when("Anna")
    .declinesToBuy();
}

describe("Spielende", () => {
  it("decides maxRounds by net worth (properties and buildings count), ignoring bankrupt players", () => {
    let scenario = given()
      .players("Anna", "Ben", "Carl")
      .settings({ maxRounds: 1 })
      .player("Anna")
      .cash(100)
      .owns(group(LAST_GROUP))
      .player("Ben")
      .cash(600)
      .player("Carl")
      .bankrupt()
      .build();
    expect(netWorth(scenario.state, "p0")).toBeGreaterThan(netWorth(scenario.state, "p1"));
    const nameOf = (id: string): string => ({ p0: "Anna", p1: "Ben", p2: "Carl" })[id] ?? id;
    // play out one full round
    for (let i = 0; i < 100 && scenario.state.status === "running"; i++) {
      const pid = whoMustAct(scenario.state)[0] ?? "";
      const types = legalActions(scenario.state, pid);
      const action: GameAction = types.includes("end-turn")
        ? { type: "end-turn" }
        : types.includes("roll")
          ? { type: "roll" }
          : types.includes("decline-buy")
            ? { type: "decline-buy" }
            : types.includes("pass-auction")
              ? { type: "pass-auction" }
              : { type: "declare-bankruptcy" };
      scenario = scenario.when(nameOf(pid)).does(action);
    }
    const s = scenario.state;
    const best = s.players
      .filter((p) => !p.bankrupt)
      .sort((a, b) => netWorth(s, b.id) - netWorth(s, a.id))[0];
    scenario
      .then()
      .status()
      .is("finished")
      .phase()
      .matches({ type: "game-over" })
      .winner()
      .is(nameOf(best?.id ?? ""));
    expect(best?.id).not.toBe("p2");
  });
});
