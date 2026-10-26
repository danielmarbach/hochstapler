import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOARD } from "../src/board.ts";
import { chooseBotAction } from "../src/bot.ts";
import { applyAction, createGame, handleTimeout, legalActions, whoMustAct } from "../src/game.ts";
import { netWorth, netWorthBreakdown } from "../src/helpers.ts";
import { DEFAULT_SETTINGS, END_VOTE_COOLDOWN_ROUNDS, GameError } from "../src/types.ts";
import type { GameAction, GameState } from "../src/types.ts";
import { assertInvariants } from "./invariants.ts";
import { seatPlayers } from "./sim.ts";
import { given, group } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";

const LAST_GROUP = 9;
const PRICE_TILE_1 = BOARD[1]?.price ?? 0;
const TIMEOUT_SEC = 60;
const START = 2000;
const MAX_STEPS = 200;

/** Plays the simplest legal moves until the game is over. */
function playToEnd(start: Scenario, names: Record<string, string>): Scenario {
  let scenario = start;
  for (let i = 0; i < MAX_STEPS && scenario.state.status === "running"; i++) {
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
    scenario = scenario.when(names[pid] ?? pid).does(action);
  }
  return scenario;
}

describe("Ending the game by vote", () => {
  describe("Zustimmung aller", () => {
    it("ends the game once every non-bankrupt player agreed; richest by net worth wins", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .player("Anna")
        .cash(900)
        .player("Ben")
        .cash(300)
        .owns(group(LAST_GROUP))
        .withLevel(2)
        .player("Carl")
        .cash(1200)
        .when("Anna")
        .proposesEndGame()
        .then()
        .status()
        .is("running")
        .endVote()
        .matches({ by: "Anna", votes: { Anna: true } })
        .legal("Ben")
        .contains("vote-end-game")
        .legal("Ben")
        .excludes("propose-end-game")
        .legal("Anna")
        .excludes("vote-end-game", "propose-end-game")
        .when("Ben")
        .agreesToEndGame()
        .then()
        .status()
        .is("running")
        .when("Carl")
        .agreesToEndGame()
        .then()
        .status()
        .is("finished")
        .winner()
        .is("Ben")
        .ranking()
        .is(["Ben", "Carl", "Anna"])
        .that((s) => {
          expect(s.endVote).toBeUndefined();
          expect(s.deadline).toBeNull();
        })
        .emitted("game-over", { winner: "Ben" })
        .lastLogKey("log.gameOverWinner");
    });

    it("stores a ranking with the net worth breakdown of every player", () => {
      const scenario = given()
        .players("Anna", "Ben")
        .player("Anna")
        .cash(400)
        .owns(1)
        .mortgaged()
        .owns(group(LAST_GROUP))
        .withLevel(1)
        .player("Ben")
        .cash(100)
        .when("Anna")
        .proposesEndGame()
        .when("Ben")
        .agreesToEndGame();
      const ph = scenario.state.phase;
      if (ph.type !== "game-over") {
        throw new Error("expected game over");
      }
      expect(ph.reason).toBe("vote");
      expect(ph.results?.[0]).toEqual({
        playerId: "p0",
        rank: 1,
        bankrupt: false,
        ...netWorthBreakdown(scenario.state, "p0"),
      });
      expect(ph.results?.[0]?.total).toBe(netWorth(scenario.state, "p0"));
      expect(ph.results?.[1]).toMatchObject({ playerId: "p1", rank: 2, total: 100 });
    });

    it("ends immediately when everybody else is a bot", () => {
      given()
        .players("Anna", "Bot Heidi", "Bot Ueli")
        .player("Anna")
        .cash(10)
        .when("Anna")
        .proposesEndGame()
        .then()
        .status()
        .is("finished")
        .winner()
        .is("Bot Heidi");
    });

    it("counts away players as agreeing and waits for the remaining humans", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .player("Ben")
        .away()
        .when("Anna")
        .proposesEndGame()
        .then()
        .status()
        .is("running")
        .endVote()
        .matches({ votes: { Anna: true, Ben: true } })
        .legal("Ben")
        .excludes("vote-end-game")
        .when("Carl")
        .agreesToEndGame()
        .then()
        .status()
        .is("finished");
    });

    it("counts a player who goes away during the vote as agreeing", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .when("Anna")
        .proposesEndGame()
        .when("Carl")
        .agreesToEndGame()
        .and()
        .setsController("Ben", "away")
        .then()
        .status()
        .is("finished");
    });

    it("ignores bankrupt players: they neither vote nor block", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .player("Carl")
        .bankrupt()
        .when("Anna")
        .proposesEndGame()
        .then()
        .endVote()
        .matches({ votes: { Anna: true } })
        .legal("Carl")
        .is([])
        .rejects({ type: "vote-end-game", accept: true }, /nicht aktiv/, "Carl")
        .rejects({ type: "propose-end-game" }, /nicht aktiv/, "Carl")
        .when("Ben")
        .agreesToEndGame()
        .then()
        .status()
        .is("finished")
        .ranking()
        .is(["Anna", "Ben", "Carl"]);
    });

    it("finishes the vote when the last undecided player goes bankrupt", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .player("Anna")
        .cash(5)
        .at(47)
        .player("Ben")
        .owns(group(LAST_GROUP))
        .when("Anna")
        .rolls(2, 1)
        .then()
        .phaseType()
        .is("debt")
        .when("Ben")
        .proposesEndGame()
        .when("Carl")
        .agreesToEndGame()
        .then()
        .status()
        .is("running")
        .when("Anna")
        .declaresBankruptcy()
        .then()
        .status()
        .is("finished")
        .winner()
        .is("Ben");
    });

    it("does not block normal play while a vote is pending", () => {
      given()
        .players("Anna", "Ben")
        .when("Anna")
        .proposesEndGame()
        .when("Anna")
        .rolls(1, 2)
        .then()
        .position("Anna")
        .is(3)
        .endVote()
        .matches({ by: "Anna" });
    });
  });

  describe("Ablehnung", () => {
    it("cancels the vote on the first no and the game continues", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .when("Anna")
        .proposesEndGame()
        .when("Ben")
        .refusesToEndGame()
        .then()
        .status()
        .is("running")
        .endVote()
        .is(undefined)
        .lastLogKey("log.endVoteDeclined")
        .legal("Carl")
        .excludes("vote-end-game");
    });

    it("lets the proposer ask again only after a full round", () => {
      expect(END_VOTE_COOLDOWN_ROUNDS).toBe(1);
      given()
        .players("Anna", "Ben")
        .when("Anna")
        .proposesEndGame()
        .when("Ben")
        .refusesToEndGame()
        .then()
        .legal("Anna")
        .excludes("propose-end-game")
        .rejects({ type: "propose-end-game" }, /Runde/, "Anna")
        .legal("Ben")
        .contains("propose-end-game")
        .and()
        .meanwhile((s) => {
          s.round += END_VOTE_COOLDOWN_ROUNDS;
        })
        .then()
        .legal("Anna")
        .contains("propose-end-game")
        .when("Anna")
        .proposesEndGame()
        .then()
        .endVote()
        .matches({ by: "Anna" });
    });

    it("rejects invalid votes and proposals", () => {
      given()
        .players("Anna", "Ben")
        .then()
        .rejects({ type: "vote-end-game", accept: true }, /keine Abstimmung/, "Ben")
        .when("Anna")
        .proposesEndGame()
        .then()
        .rejects({ type: "propose-end-game" }, /schon eine Abstimmung/, "Ben")
        .rejects({ type: "vote-end-game", accept: true }, /schon abgestimmt/, "Anna")
        .when("Ben")
        .agreesToEndGame()
        .then()
        .rejects({ type: "propose-end-game" }, /beendet/, "Ben");
    });
  });

  describe("Ablauf per Zeitlimit", () => {
    it("counts missing votes as no: the vote expires and the game continues", () => {
      const expiresAt = START + TIMEOUT_SEC * 1000;
      given()
        .players("Anna", "Ben", "Carl")
        .settings({ turnTimeoutSec: TIMEOUT_SEC })
        .clock(START)
        .when("Anna")
        .proposesEndGame()
        .when("Ben")
        .agreesToEndGame()
        .then()
        .endVote()
        .matches({ expiresAt })
        .and()
        .timesOut(expiresAt)
        .then()
        .status()
        .is("running")
        .endVote()
        .is(undefined)
        .that((s) => {
          expect(s.log.some((l) => l.msg?.key === "log.endVoteExpired")).toBe(true);
        })
        .legal("Anna")
        .excludes("propose-end-game");
    });

    it("keeps the vote before the expiry time and never expires without a timeout", () => {
      given()
        .players("Anna", "Ben")
        .settings({ turnTimeoutSec: TIMEOUT_SEC })
        .clock(START)
        .when("Anna")
        .proposesEndGame()
        .then()
        .that((s) => {
          expect(handleTimeout(s, START + TIMEOUT_SEC * 1000 - 1).state.endVote).toBeDefined();
        });
      given()
        .players("Anna", "Ben")
        .settings({ turnTimeoutSec: 0 })
        .when("Anna")
        .proposesEndGame()
        .then()
        .endVote()
        .matches({ expiresAt: null })
        .that((s) => {
          expect(handleTimeout(s, Number.MAX_SAFE_INTEGER).state.endVote).toBeDefined();
        });
    });
  });

  describe("Rangfolge", () => {
    it("breaks net worth ties by cash, then by seat order", () => {
      given()
        .players("Anna", "Ben", "Carl")
        .player("Anna")
        .cash(1000 - PRICE_TILE_1)
        .owns(1)
        .player("Ben")
        .cash(1000)
        .player("Carl")
        .cash(1000)
        .when("Anna")
        .proposesEndGame()
        .when("Ben")
        .agreesToEndGame()
        .when("Carl")
        .agreesToEndGame()
        .then()
        .ranking()
        .is(["Ben", "Carl", "Anna"])
        .winner()
        .is("Ben");
    });

    it("values mortgaged properties at their mortgage debt and buildings at build cost", () => {
      const scenario = given()
        .players("Anna", "Ben")
        .player("Anna")
        .cash(10)
        .owns(1)
        .mortgaged()
        .owns(group(LAST_GROUP))
        .withLevel(2)
        .build();
      const groupPrices = group(LAST_GROUP).reduce((n, t) => n + (BOARD[t]?.price ?? 0), 0);
      const build = group(LAST_GROUP).reduce((n, t) => n + 2 * (BOARD[t]?.buildCost ?? 0), 0);
      const b = netWorthBreakdown(scenario.state, "p0");
      expect(b).toEqual({
        cash: 10,
        properties: PRICE_TILE_1 + groupPrices,
        buildings: build,
        mortgages: -PRICE_TILE_1 / 2,
        total: 10 + PRICE_TILE_1 / 2 + groupPrices + build,
      });
      expect(b.total).toBe(netWorth(scenario.state, "p0"));
    });

    it("uses the same ranking and a reason for the round limit and the last player standing", () => {
      const limit = playToEnd(
        given().players("Anna", "Ben").settings({ maxRounds: 1 }).player("Ben").cash(3000).build(),
        { p0: "Anna", p1: "Ben" },
      );
      expect(limit.state.phase).toMatchObject({
        type: "game-over",
        winner: "p1",
        reason: "round-limit",
      });
      limit.then().ranking().is(["Ben", "Anna"]);

      const last = given()
        .players("Anna", "Ben")
        .player("Anna")
        .cash(5)
        .at(47)
        .player("Ben")
        .owns(group(LAST_GROUP))
        .when("Anna")
        .rolls(2, 1)
        .when("Anna")
        .declaresBankruptcy();
      expect(last.state.phase).toMatchObject({
        type: "game-over",
        winner: "p1",
        reason: "last-player",
      });
      last.then().ranking().is(["Ben", "Anna"]);
    });
  });

  describe("Bots", () => {
    it("never propose to end the game", () => {
      const s = given().players("Bot Heidi", "Anna").build().state;
      expect(legalActions(s, "p0")).toContain("propose-end-game");
      expect(chooseBotAction(s, "p0")?.type).not.toBe("propose-end-game");
    });
  });
});

// ------------------------------------------------------------------ property

type VoteOp =
  | { kind: "propose"; who: number }
  | { kind: "vote"; who: number; accept: boolean }
  | { kind: "next-round" };

const opArb: fc.Arbitrary<VoteOp> = fc.oneof(
  fc.record({ kind: fc.constant("propose" as const), who: fc.nat(7) }),
  fc.record({ kind: fc.constant("vote" as const), who: fc.nat(7), accept: fc.boolean() }),
  fc.record({ kind: fc.constant("next-round" as const) }),
);

describe("property: random vote sequences", () => {
  it("only end the game when every non-bankrupt player has said yes", () => {
    let ended = 0;
    let cancelled = 0;
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<"human" | "bot">("human", "human", "bot"), {
          minLength: 2,
          maxLength: 6,
        }),
        fc.array(opArb, { minLength: 1, maxLength: 60 }),
        (seats, ops) => {
          let s: GameState = createGame(
            "vote",
            seatPlayers(seats, 7),
            { ...DEFAULT_SETTINGS, turnTimeoutSec: 0 },
            7,
            1000,
          ).state;
          let now = 2000;
          for (const op of ops) {
            if (s.status !== "running") {
              break;
            }
            now += 10;
            if (op.kind === "next-round") {
              s = { ...structuredClone(s), round: s.round + 1 };
              continue;
            }
            const player = s.players[op.who % s.players.length];
            if (!player) {
              continue;
            }
            const action: GameAction =
              op.kind === "propose"
                ? { type: "propose-end-game" }
                : { type: "vote-end-game", accept: op.accept };
            const before = s;
            let next: GameState;
            try {
              next = applyAction(before, player.id, action, now).state;
            } catch (e) {
              expect(e).toBeInstanceOf(GameError);
              continue;
            }
            assertInvariants(next);
            if (next.status === "finished") {
              ended++;
              const agreed = (id: string): boolean =>
                before.endVote?.votes[id] === true ||
                (id === player.id && (op.kind === "propose" || op.accept));
              for (const p of before.players.filter((x) => !x.bankrupt)) {
                const auto = p.controller !== "human";
                expect(auto || agreed(p.id), `${p.id} must have agreed`).toBe(true);
              }
              expect(Object.values(before.endVote?.votes ?? {})).not.toContain(false);
            } else if (op.kind === "vote" && !op.accept) {
              expect(next.endVote).toBeUndefined();
              cancelled++;
            }
            s = next;
          }
        },
      ),
      { numRuns: 300 },
    );
    expect(ended).toBeGreaterThan(0);
    expect(cancelled).toBeGreaterThan(0);
  });
});
