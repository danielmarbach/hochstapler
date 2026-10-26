import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.ts";
import { applyAction, redactState, whoMustAct } from "../src/game.ts";
import { maxBid } from "../src/helpers.ts";
import { GameActionSchema } from "../src/schemas.ts";
import { AUTO_BID_STEP } from "../src/types.ts";
import type { GameAction, GameState, PlayerId } from "../src/types.ts";
import { assertInvariants } from "./invariants.ts";
import { given } from "./scenario.ts";

const TILE = 3;
const START_CASH = 2000;

/** Anna rolls onto tile 3 and declines; the bidding order is Ben, Carl, Anna. */
function auction() {
  return given()
    .players("Anna", "Ben", "Carl")
    .when("Anna")
    .rolls(2, 1)
    .when("Anna")
    .declinesToBuy();
}

describe("Automatisch mitbieten", () => {
  it("outbids a manual bid by the step as soon as it is the owner's turn", () => {
    auction()
      .when("Anna")
      .setsAutoBid(200)
      .then()
      .autoBid("Anna")
      .is(200)
      .auction()
      .matches({ highestBid: 0, turn: "Ben" }) // out of turn: nothing happens yet
      .legal("Anna")
      .contains("set-auto-bid")
      .when("Ben")
      .bids(100)
      .when("Carl")
      .passesAuction()
      .then()
      .auction()
      .is({
        highestBid: 100 + AUTO_BID_STEP,
        highestBidder: "Anna",
        turn: "Ben",
        bidders: ["Ben", "Anna"],
      })
      .emitted("auction-bid", { playerId: "Anna", amount: 100 + AUTO_BID_STEP })
      .lastLogKey("log.autoBid");
  });

  it("bids at once when it is set on the owner's own turn", () => {
    auction()
      .when("Ben")
      .passesAuction()
      .when("Carl")
      .passesAuction()
      .then()
      .legal("Anna")
      .contains("set-auto-bid")
      .when("Anna")
      .setsAutoBid(50)
      .then()
      .owner(TILE)
      .is("Anna")
      .cash("Anna")
      .is(START_CASH - AUTO_BID_STEP)
      .phaseType()
      .is("await-end-turn");
  });

  it("bids its own maximum when that is less than a step above the leader", () => {
    auction()
      .when("Anna")
      .setsAutoBid(200)
      .when("Ben")
      .bids(195)
      .when("Carl")
      .passesAuction()
      .then()
      .auction()
      .matches({ highestBid: 200, highestBidder: "Anna", turn: "Ben" });
  });

  it("is exhausted and passes when outbid beyond its maximum, so the other bidder wins", () => {
    auction()
      .when("Anna")
      .setsAutoBid(200)
      .when("Ben")
      .bids(120)
      .when("Carl")
      .passesAuction()
      .then()
      .auction()
      .matches({ highestBid: 130, highestBidder: "Anna", turn: "Ben" })
      .when("Ben")
      .bids(210)
      .then()
      .owner(TILE)
      .is("Ben")
      .cash("Ben")
      .is(START_CASH - 210)
      .cash("Anna")
      .is(START_CASH)
      .phaseType()
      .is("await-end-turn")
      .that((s) => {
        const keys = s.log.map((e) => e.msg?.key);
        expect(keys).toContain("log.autoBidExhausted");
        expect(keys.at(-1)).toBe("log.auctionWon");
      });
  });

  it("lets two auto-bidders converge: the higher maximum wins at the lower one plus the step", () => {
    auction()
      .when("Anna")
      .setsAutoBid(200)
      .when("Ben")
      .setsAutoBid(150)
      .when("Carl")
      .passesAuction()
      .then()
      .owner(TILE)
      .is("Anna")
      .cash("Anna")
      .is(START_CASH - (150 + AUTO_BID_STEP))
      .cash("Ben")
      .is(START_CASH)
      .phaseType()
      .is("await-end-turn");
  });

  it("lets the higher of two auto-bidders win at its own maximum when that is below lower + step", () => {
    auction()
      .when("Anna")
      .setsAutoBid(200)
      .when("Ben")
      .setsAutoBid(195)
      .when("Carl")
      .passesAuction()
      .then()
      .owner(TILE)
      .is("Anna")
      .cash("Anna")
      .is(START_CASH - 200);
  });

  it("lets the earlier bidder win when two auto-bidders have the same maximum", () => {
    auction()
      .when("Anna")
      .setsAutoBid(100)
      .when("Ben")
      .setsAutoBid(100)
      .when("Carl")
      .passesAuction()
      .then()
      .owner(TILE)
      .is("Anna") // reaches 100 first because Ben opened with the step
      .cash("Anna")
      .is(START_CASH - 100);
  });

  it("can be cancelled and re-set, and an exhausted auto-bid lets a later manual bid win", () => {
    auction()
      .when("Anna")
      .setsAutoBid(200)
      .when("Anna")
      .cancelsAutoBid()
      .then()
      .autoBid("Anna")
      .is(undefined)
      .when("Anna")
      .setsAutoBid(80)
      .when("Ben")
      .bids(40)
      .when("Carl")
      .bids(75)
      .then()
      .auction()
      .matches({ highestBid: 80, highestBidder: "Anna" })
      .when("Ben")
      .bids(300)
      .when("Carl")
      .passesAuction()
      .then()
      .owner(TILE)
      .is("Ben");
  });

  it("drops the auto-bid of an exhausted player while the auction goes on", () => {
    given()
      .players("Anna", "Ben", "Carl", "Dora")
      .when("Anna")
      .rolls(2, 1)
      .when("Anna")
      .declinesToBuy()
      .when("Anna")
      .setsAutoBid(50)
      .when("Ben")
      .bids(100)
      .when("Carl")
      .bids(200)
      .when("Dora")
      .passesAuction()
      .then()
      .autoBid("Anna")
      .is(undefined)
      .auction()
      .is({ highestBid: 200, highestBidder: "Carl", turn: "Ben", bidders: ["Ben", "Carl"] })
      .lastLogKey("log.autoBidExhausted");
  });

  it("allows cancelling and replacing the maximum while waiting", () => {
    auction()
      .when("Carl")
      .setsAutoBid(100)
      .when("Carl")
      .setsAutoBid(300)
      .then()
      .autoBid("Carl")
      .is(300)
      .when("Carl")
      .cancelsAutoBid()
      .then()
      .autoBid("Carl")
      .is(undefined);
  });

  it("rejects invalid maximums and players outside the auction", () => {
    auction()
      .when("Ben")
      .bids(100)
      .then()
      .rejects({ type: "set-auto-bid", max: 100 }, /Höchstgebot/, "Carl")
      .rejects({ type: "set-auto-bid", max: 50 }, /Höchstgebot/, "Carl")
      .rejects({ type: "set-auto-bid", max: 100.5 }, /Höchstgebot|Gebot/, "Carl")
      .rejects({ type: "set-auto-bid", max: 5000 }, /nicht auftreiben/, "Carl")
      .when("Carl")
      .passesAuction()
      .then()
      .rejects({ type: "set-auto-bid", max: 500 }, /nicht \(mehr\) in der Versteigerung/, "Carl")
      .legal("Carl")
      .excludes("set-auto-bid");
  });

  it("rejects an auto-bid outside an auction", () => {
    given()
      .players("Anna", "Ben")
      .then()
      .rejects({ type: "set-auto-bid", max: 100 }, /Versteigerung/, "Ben")
      .legal("Ben")
      .excludes("set-auto-bid");
  });

  it("lets the winner of a bid beyond their cash raise the money (debt flow of the auction rule)", () => {
    // Ben has 20 cash and can raise more by mortgaging: his auto-bid leads him past his cash
    given()
      .players("Anna", "Ben", "Carl")
      .player("Ben")
      .cash(20)
      .owns(5)
      .when("Anna")
      .rolls(2, 1)
      .when("Anna")
      .declinesToBuy()
      .then()
      .that((s) => expect(maxBid(s, "p1")).toBe(150))
      .rejects({ type: "set-auto-bid", max: 151 }, /nicht auftreiben/, "Ben")
      .when("Ben")
      .setsAutoBid(150)
      .then()
      .auction()
      .matches({ highestBid: AUTO_BID_STEP, highestBidder: "Ben", turn: "Carl" })
      .when("Carl")
      .bids(100)
      .when("Anna")
      .passesAuction()
      .when("Carl")
      .passesAuction()
      .then()
      .owner(TILE)
      .is("Ben")
      .phase()
      .is({
        type: "debt",
        debtor: "p1",
        creditor: null,
        amount: 100 + AUTO_BID_STEP,
        auctionTile: TILE,
      })
      .cash("Ben")
      .is(20);
  });

  it("keeps the invariants with a bot in the bidding order", () => {
    let scenario = given()
      .players("Anna", "Bot Ben", "Carl")
      .when("Anna")
      .rolls(2, 1)
      .when("Anna")
      .declinesToBuy()
      .when("Anna")
      .setsAutoBid(500)
      .and();
    for (let i = 0; i < 30 && scenario.state.phase.type === "auction"; i++) {
      const pid = whoMustAct(scenario.state)[0] ?? "";
      const name = ({ p0: "Anna", p1: "Bot Ben", p2: "Carl" } as Record<string, string>)[pid] ?? "";
      const action: GameAction =
        pid === "p1"
          ? (chooseBotAction(scenario.state, pid) ?? { type: "pass-auction" })
          : { type: "pass-auction" };
      scenario = scenario.when(name).does(action);
    }
    expect(scenario.state.phase.type).not.toBe("auction");
  });

  it("is part of the action contract", () => {
    expect(GameActionSchema.safeParse({ type: "set-auto-bid", max: 120 }).success).toBe(true);
    expect(GameActionSchema.safeParse({ type: "set-auto-bid", max: null }).success).toBe(true);
    expect(GameActionSchema.safeParse({ type: "set-auto-bid", max: -1 }).success).toBe(false);
    expect(GameActionSchema.safeParse({ type: "set-auto-bid", max: 1.5 }).success).toBe(false);
    expect(GameActionSchema.safeParse({ type: "set-auto-bid" }).success).toBe(false);
  });
});

describe("Auto-bidding (privacy)", () => {
  const withBothAutoBids = () =>
    auction().when("Anna").setsAutoBid(321).when("Carl").setsAutoBid(222).state;

  it("shows a viewer only their own maximum", () => {
    const s = withBothAutoBids();
    const view = (viewer: string | null): Record<string, number> | undefined => {
      const ph = redactState(s, viewer).phase;
      return ph.type === "auction" ? ph.auction.autoBids : undefined;
    };
    expect(view("p0")).toEqual({ p0: 321 });
    expect(view("p2")).toEqual({ p2: 222 });
    expect(view("p1")).toBeUndefined(); // Ben has none
    expect(view(null)).toBeUndefined(); // spectators see none
  });

  it("never leaks another player's maximum anywhere in the serialized state", () => {
    const s = withBothAutoBids();
    expect(JSON.stringify(redactState(s, "p1"))).not.toMatch(/321|222|autoBids/);
    expect(JSON.stringify(redactState(s, null))).not.toMatch(/321|222|autoBids/);
    expect(JSON.stringify(redactState(s, "p0"))).not.toContain("222");
    expect(JSON.stringify(redactState(s, "p2"))).not.toContain("321");
  });

  it("does not put the maximum into events or the log", () => {
    const r = auction()
      .when("Anna")
      .setsAutoBid(321)
      .when("Ben")
      .bids(100)
      .when("Carl")
      .passesAuction();
    const text = JSON.stringify(r.state.log) + JSON.stringify([...r.state.log.map((e) => e.msg)]);
    expect(text).not.toContain("321");
  });

  it("does not change the state it redacts", () => {
    const s = withBothAutoBids();
    const snapshot = structuredClone(s);
    redactState(s, "p1");
    expect(s).toEqual(snapshot);
  });
});

// ------------------------------------------------------------------ properties

type AuctionOp =
  { kind: "bid"; extra: number } | { kind: "pass" } | { kind: "auto"; max: number | null };

const opArb: fc.Arbitrary<{ who: number; op: AuctionOp }> = fc.record({
  who: fc.nat(7),
  op: fc.oneof(
    fc.record({ kind: fc.constant<"bid">("bid"), extra: fc.integer({ min: 1, max: 80 }) }),
    fc.record({ kind: fc.constant<"pass">("pass") }),
    fc.record({
      kind: fc.constant<"auto">("auto"),
      max: fc.option(fc.integer({ min: 1, max: 700 }), { nil: null }),
    }),
  ),
});

describe("Automatisch mitbieten (Eigenschaften)", () => {
  it("always terminates and never bids above the owner's maximum", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.integer({ min: 20, max: 1500 }), { minLength: 6, maxLength: 6 }),
        fc.array(opArb, { maxLength: 60 }),
        (n, cashes, ops) => {
          const names = Array.from({ length: n }, (_, i) => `P${i}`);
          const scenario = given()
            .players(...names)
            .tweak((s) => {
              s.players.forEach((p, i) => (p.cash = cashes[i] ?? 1500));
            })
            .when("P0")
            .rolls(2, 1)
            .when("P0")
            .declinesToBuy();
          let state: GameState = scenario.state;
          // the maximum most recently set per player (cleared on cancel / pass)
          const limits = new Map<PlayerId, number>();
          const apply = (pid: PlayerId, action: GameAction): void => {
            const before = state;
            let next: GameState;
            try {
              next = applyAction(state, pid, action, 1000).state;
            } catch {
              return; // illegal at this moment
            }
            assertInvariants(next, { lastNow: 1000, prevVersion: before.version });
            if (action.type === "set-auto-bid") {
              if (action.max === null) {
                limits.delete(pid);
              } else {
                limits.set(pid, action.max);
              }
            }
            if (action.type === "pass-auction") {
              limits.delete(pid);
            }
            for (const e of next.log.slice(before.log.length)) {
              if (e.msg?.key === "log.autoBid") {
                const player = String(e.msg.params["player"]);
                const amount = Number(e.msg.params["amount"]);
                expect(amount, `auto-bid of ${player}`).toBeLessThanOrEqual(
                  limits.get(player) ?? -1,
                );
              }
              if (e.msg?.key === "log.autoBidExhausted") {
                limits.delete(String(e.msg.params["player"]));
              }
            }
            state = next;
          };
          for (const { who, op } of ops) {
            if (state.phase.type !== "auction") {
              break;
            }
            const pid = `p${who % n}`;
            if (op.kind === "bid") {
              const hb = state.phase.auction.highestBid;
              apply(pid, { type: "bid", amount: hb + op.extra });
            } else if (op.kind === "pass") {
              apply(pid, { type: "pass-auction" });
            } else {
              apply(pid, { type: "set-auto-bid", max: op.max });
            }
          }
          // everybody who is still asked passes (or, as the leader, cannot): must end quickly
          for (let guard = 0; guard < 100 && state.phase.type === "auction"; guard++) {
            const pid = whoMustAct(state)[0] ?? "";
            const a: GameAction =
              state.phase.auction.highestBidder === pid
                ? { type: "bid", amount: state.phase.auction.highestBid + 1 }
                : { type: "pass-auction" };
            const before = state;
            apply(pid, a);
            if (state === before) {
              apply(pid, { type: "pass-auction" });
            }
          }
          expect(state.phase.type).not.toBe("auction");
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("pays at most its own maximum and at most the step above the loser when an auto-bidder wins", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 600 }),
        fc.integer({ min: 11, max: 600 }),
        fc.boolean(),
        (maxA, maxB, annaFirst) => {
          const s = given()
            .players("Anna", "Ben", "Carl")
            .when("Anna")
            .rolls(2, 1)
            .when("Anna")
            .declinesToBuy()
            .when(annaFirst ? "Anna" : "Ben")
            .setsAutoBid(annaFirst ? maxA : maxB)
            .when(annaFirst ? "Ben" : "Anna")
            .setsAutoBid(annaFirst ? maxB : maxA)
            .when("Carl")
            .passesAuction().state;
          expect(s.phase.type).not.toBe("auction");
          const winner = s.properties[TILE]?.owner;
          const paid = START_CASH - (s.players.find((p) => p.id === winner)?.cash ?? 0);
          const max = winner === "p0" ? maxA : maxB;
          const other = winner === "p0" ? maxB : maxA;
          expect(paid).toBeLessThanOrEqual(max);
          expect(max).toBeGreaterThanOrEqual(other);
          // the loser stops once the leader reached its maximum, the winner never overshoots by more than a step
          expect(paid).toBeGreaterThanOrEqual(Math.min(max, other));
          expect(paid).toBeLessThanOrEqual(other + AUTO_BID_STEP);
        },
      ),
      { numRuns: 300 },
    );
  });
});
