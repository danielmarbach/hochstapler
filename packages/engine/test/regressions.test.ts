import { describe, expect, it } from "vitest";
import { BOARD } from "../src/board.ts";
import { sellBlocker, unmortgageCost } from "../src/helpers.ts";
import { given, group } from "./scenario.ts";

describe("Regressionen aus Simulationen", () => {
  describe("Handel", () => {
    it("does not offer propose-trade when the player already has the maximum of open offers", () => {
      given()
        .players("Anna", "Ben")
        .tweak((s) => {
          for (let i = 0; i < 5; i++) {
            s.trades.push({
              id: `t${i}`,
              from: "p0",
              to: "p1",
              status: "pending",
              createdAt: 0,
              expiresAt: null,
              giveCash: 1,
              giveTiles: [],
              giveJailCards: 0,
              wantCash: 0,
              wantTiles: [],
              wantJailCards: 0,
            });
          }
        })
        .then()
        .legal("Anna")
        .excludes("propose-trade")
        .legal("Ben")
        .contains("propose-trade");
    });

    it("charges the same exact 10% interest when a mortgaged tile changes hands in a trade", () => {
      // tile 10 (mortgage value 70): 10% is exactly 7, not 8
      const tile = BOARD.find((x) => x.mortgage === 70)?.index ?? -1;
      given()
        .players("Anna", "Ben")
        .player("Anna")
        .owns(tile)
        .mortgaged()
        .when("Anna")
        .proposesTrade("Ben", { giveTiles: [tile] })
        .when("Ben")
        .acceptsTrade()
        .then()
        .cash("Ben")
        .is(2000 - 7)
        .isMortgaged(tile)
        .is(true);
    });
  });

  describe("Timeout/Away", () => {
    it("keeps the log capped at 200 entries when the controller changes", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .settings({ turnTimeoutSec: 30 })
        .tweak((s) => {
          for (let i = 0; i < 200; i++) {
            s.log.push({
              at: 1000,
              text: `Anna spielt ein Alibi aus.`,
              msg: { key: "log.usesJailCard", params: { player: "p0" } },
            });
          }
        })
        .build()
        .setsController("Ben", "away")
        .then()
        .that((s) => expect(s.log.length).toBeLessThanOrEqual(200))
        .and()
        .setsController("Ben", "human")
        .then()
        .that((s) => expect(s.log.length).toBeLessThanOrEqual(200));
    });

    it("starts the turn timer from the real clock when a player returns from away", () => {
      given()
        .players("Anna", "Ben")
        .settings({ turnTimeoutSec: 30 })
        .player("Anna")
        .away()
        .tweak((s) => {
          s.deadline = null;
        })
        .then()
        .and()
        .setsController("Anna", "human", 500_000)
        .then()
        .deadline()
        .is(530_000);
    });
  });

  describe("Jail", () => {
    it("moves a jailed player after a forced fine that first had to be raised through debt", () => {
      given()
        .players("Anna", "Ben")
        .player("Anna")
        .owns(1)
        .inJail(2)
        .cash(20)
        .when("Anna")
        .rolls(1, 2) // no doubles, total 3
        .then()
        .phase()
        .matches({ type: "debt", amount: 50 })
        .when("Anna")
        .does({ type: "mortgage", tile: 1 }) // +30 -> 50, pays the fine
        .then()
        .inJail("Anna")
        .is(false)
        .position("Anna")
        .is(16);
    });
  });

  describe("Debts and bankruptcy", () => {
    it("charges exactly 10% interest to unmortgage (no floating point round-up)", () => {
      for (const tile of BOARD) {
        if (tile.mortgage === undefined) {
          continue;
        }
        expect(unmortgageCost(tile), `tile ${tile.index}`).toBe(
          tile.mortgage + Math.ceil(tile.mortgage / 10),
        );
      }
    });
  });

  describe("Bauen/Wolkenkratzer", () => {
    it("does not let a hotel be sold below an existing skyscraper when even build is off", () => {
      const [a, b] = group(1) as [number, number, number];
      given()
        .players("Anna", "Ben")
        .settings({ evenBuild: false })
        .player("Anna")
        .owns(group(1))
        .withLevels(6, 5, 5)
        .then()
        .that((s) => {
          expect(sellBlocker(s, "p0", b)).not.toBeNull();
          // selling the skyscraper first is fine
          expect(sellBlocker(s, "p0", a)).toBeNull();
        })
        .rejects({ type: "sell-building", tile: b }, /Wolkenkratzer/, "Anna");
    });
  });
});
