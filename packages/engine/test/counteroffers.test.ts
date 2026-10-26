import { describe, expect, it } from "vitest";
import { applyAction, handleTimeout, legalActions, redactState } from "../src/game.ts";
import { MAX_COUNTERS } from "../src/types.ts";
import type { GameAction, GameState, TradeOffer } from "../src/types.ts";
import { GameActionSchema } from "../src/schemas.ts";
import { GameStateSchema } from "../src/state-schema.ts";
import { emptyOffer, given, group } from "./scenario.ts";

/** Anna offers Ben 200 for tile 1 (Ben owns it). Both start with 2000. */
const negotiation = () =>
  given()
    .players("Anna", "Ben", "Carl")
    .player("Ben")
    .owns(1)
    .when("Anna")
    .proposesTrade("Ben", { giveCash: 200, wantTiles: [1] });

function counterAction(tradeId: string, to: string, over: Partial<TradeOffer>): GameAction {
  return { type: "counter-trade", tradeId, offer: { ...emptyOffer(to), ...over } };
}

function pendingTrade(s: GameState) {
  const t = s.trades.find((x) => x.status === "pending");
  if (!t) {
    throw new Error("no pending trade");
  }
  return t;
}

describe("counteroffers", () => {
  it("lets Ben counter with 260, closes the original and links the new offer", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .then()
      .trades()
      .is(["countered", "pending"])
      .tradeChain()
      .is(["countered@0", "pending@1"])
      .that((s) => {
        const [first, second] = s.trades;
        expect(second?.counterOf).toBe(first?.id);
        expect(second?.from).toBe(first?.to);
        expect(second?.to).toBe(first?.from);
      })
      .lastLogKey("log.tradeCounteredCash")
      .emitted("trade", { trade: expect.objectContaining({ status: "countered" }) });
  });

  it("logs a plain message when the counter changes more than the cash", () => {
    given()
      .players("Anna", "Ben")
      .player("Ben")
      .owns([1, 3])
      .when("Anna")
      .proposesTrade("Ben", { giveCash: 200, wantTiles: [1] })
      .when("Ben")
      .countersTrade({ giveTiles: [1, 3], wantCash: 260 })
      .then()
      .lastLogKey("log.tradeCountered");
  });

  it("settles the counteroffer on accept: property and cash change owners once", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .when("Anna")
      .acceptsTrade()
      .then()
      .owner(1)
      .is("Anna")
      .cash("Anna")
      .is(1740)
      .cash("Ben")
      .is(2260)
      .trades()
      .is(["countered", "accepted"]);
  });

  it("cannot accept, decline or counter the countered original any more", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .then()
      .rejectsTradeResponse("Ben", 0, /nicht mehr offen/)
      .that((s) => {
        const [orig] = s.trades;
        const ben = s.players[1]?.id ?? "";
        const anna = s.players[0]?.id ?? "";
        expect(() =>
          applyAction(
            s,
            ben,
            counterAction(orig?.id ?? "", anna, { giveTiles: [1], wantCash: 300 }),
            9000,
          ),
        ).toThrow(/nicht mehr offen/);
        expect(() =>
          applyAction(
            s,
            ben,
            { type: "respond-trade", tradeId: orig?.id ?? "", accept: false },
            9000,
          ),
        ).toThrow(/nicht mehr offen/);
      });
  });

  it("lets Anna decline the counteroffer, or counter again", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .when("Anna")
      .declinesTrade()
      .then()
      .trades()
      .is(["countered", "rejected"])
      .owner(1)
      .is("Ben");

    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .when("Anna")
      .countersTrade({ giveCash: 230, wantTiles: [1] })
      .then()
      .tradeChain()
      .is(["countered@0", "countered@1", "pending@2"]);
  });

  it("limits a negotiation to three counteroffers, then only accept or decline remain", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .when("Anna")
      .countersTrade({ giveCash: 230, wantTiles: [1] })
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 250 })
      .then()
      .tradeChain()
      .is(["countered@0", "countered@1", "countered@2", "pending@3"])
      .legal("Anna")
      .contains("respond-trade")
      .legal("Anna")
      .excludes("counter-trade")
      .that((s) => {
        const last = pendingTrade(s);
        expect(() =>
          applyAction(
            s,
            last.to,
            counterAction(last.id, last.from, { giveCash: 240, wantTiles: [1] }),
            9000,
          ),
        ).toThrow(/Gegenangebot/);
        // the last offer can still be accepted
        const done = applyAction(
          s,
          last.to,
          { type: "respond-trade", tradeId: last.id, accept: true },
          9000,
        );
        expect(done.state.properties[1]?.owner).toBe(last.to);
      });
  });

  it("only the addressee can counter, and only to the proposer", () => {
    negotiation()
      .then()
      .that((s) => {
        const t = pendingTrade(s);
        const anna = s.players[0]?.id ?? "";
        const ben = s.players[1]?.id ?? "";
        const carl = s.players[2]?.id ?? "";
        const counter = (to: string) => counterAction(t.id, to, { giveTiles: [1], wantCash: 260 });
        expect(() => applyAction(s, carl, counter(anna), 9000)).toThrow(/nicht an dich/);
        expect(() => applyAction(s, anna, counter(ben), 9000)).toThrow(/nicht an dich/);
        expect(() => applyAction(s, ben, counter(carl), 9000)).toThrow(/Gegenangebot/);
        expect(legalActions(s, ben)).toContain("counter-trade");
        expect(legalActions(s, anna)).not.toContain("counter-trade");
        expect(legalActions(s, carl)).not.toContain("counter-trade");
      });
  });

  it("validates a counteroffer like a normal offer and leaves the state untouched when refused", () => {
    const refused = (over: Partial<TradeOffer>, message: RegExp) =>
      negotiation()
        .then()
        .that((s) => {
          const t = pendingTrade(s);
          const before = structuredClone(s);
          expect(() => applyAction(s, t.to, counterAction(t.id, t.from, over), 9000)).toThrow(
            message,
          );
          expect(s).toEqual(before);
        });
    refused({}, /Leeres Angebot/);
    refused({ giveTiles: [3], wantCash: 10 }, /Feld gehört nicht/); // not Ben's tile
    refused({ giveTiles: [1, 1] }, /doppelt|Doppelt|Duplicate|Feld/);
    refused({ giveTiles: [0] }, /Ungültig/); // GO is not tradable
    refused({ giveJailCards: 1 }, /Alibi/);
    refused({ giveCash: -5 }, /Ungültiger Betrag/);
    refused({ giveCash: 2500, wantTiles: [] }, /Zu wenig Geld \(Anbieter\)/); // Ben cannot pay
    refused({ giveTiles: [1], wantCash: 5000 }, /Zu wenig Geld \(Empfänger\)/); // Anna cannot pay
  });

  it("keeps the mortgage interest rule: the receiver of a mortgaged tile pays 10% extra", () => {
    const base = () =>
      given()
        .players("Anna", "Ben")
        .player("Ben")
        .owns(1)
        .mortgaged()
        .player("Anna")
        .cash(263)
        .when("Anna")
        .proposesTrade("Ben", { giveCash: 100, wantTiles: [1] });
    base()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 }) // 260 + 3 interest = Anna's last franc
      .then()
      .trades()
      .is(["countered", "pending"]);
    base()
      .then()
      .that((s) => {
        const t = pendingTrade(s);
        expect(() =>
          applyAction(
            s,
            t.to,
            counterAction(t.id, t.from, { giveTiles: [1], wantCash: 261 }),
            9000,
          ),
        ).toThrow(/Zu wenig Geld \(Empfänger\)/);
      });
  });

  it("refuses a counteroffer that hands over a group with buildings", () => {
    given()
      .players("Anna", "Ben")
      .player("Ben")
      .owns([...group(0), 5])
      .when("Anna")
      .proposesTrade("Ben", { giveCash: 200, wantTiles: [5] })
      .and()
      .meanwhile((s) => {
        const pr = s.properties[group(0)[0] ?? 1];
        if (pr) {
          pr.level = 1;
        }
      })
      .then()
      .that((s) => {
        const t = pendingTrade(s);
        expect(() =>
          applyAction(
            s,
            t.to,
            counterAction(t.id, t.from, { giveTiles: [group(0)[1] ?? 3], wantCash: 300 }),
            9000,
          ),
        ).toThrow(/Gruppe hat Gebäude/);
      });
  });

  it("invalidates the original instead of countering when ownership changed meanwhile", () => {
    negotiation()
      .and()
      .meanwhile((s) => {
        const pr = s.properties[1];
        if (pr) {
          pr.owner = s.players[2]?.id ?? null;
        }
      })
      .atTime(3000)
      .when("Ben")
      .countersTrade({ wantCash: 260 })
      .then()
      .trades()
      .is(["invalid"]);
  });

  it("gives the counteroffer its own expiry for humans and none for bots", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .then()
      .that((s) => {
        const counter = s.trades[1];
        expect(counter?.expiresAt).not.toBeNull();
        const r = handleTimeout(s, (counter?.expiresAt ?? 0) + 1);
        expect(r.state.trades.map((t) => t.status)).toEqual(["countered", "expired"]);
      });

    given()
      .players("Anna", "Bot Bert")
      .player("Anna")
      .owns(1)
      .when("Bot Bert")
      .proposesTrade("Anna", { giveCash: 100, wantTiles: [1] })
      .when("Anna")
      .countersTrade({ giveTiles: [1], wantCash: 300 })
      .then()
      .that((s) => {
        expect(s.trades[1]?.expiresAt).toBeNull(); // the bot answers immediately
      });
  });

  it("shows trades to every viewer exactly as before (offers stay public)", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .then()
      .that((s) => {
        const carl = s.players[2]?.id ?? null;
        expect(redactState(s, carl).trades).toEqual(s.trades);
        expect(redactState(s, null).trades).toEqual(s.trades);
      });
  });

  it("persists: a state with a counter chain round-trips through JSON and the stored schema", () => {
    negotiation()
      .when("Ben")
      .countersTrade({ giveTiles: [1], wantCash: 260 })
      .then()
      .that((s) => {
        const back = GameStateSchema.parse(JSON.parse(JSON.stringify(s)));
        expect(back.trades.map((t) => [t.status, t.counterOf, t.counterDepth])).toEqual([
          ["countered", undefined, undefined],
          ["pending", s.trades[0]?.id, 1],
        ]);
      });
  });

  it("still loads stored trades that predate counteroffers (no state version bump needed)", () => {
    negotiation()
      .then()
      .that((s) => {
        const old = JSON.parse(JSON.stringify(s)) as { trades: Record<string, unknown>[] };
        expect(old.trades[0]).not.toHaveProperty("counterOf");
        expect(GameStateSchema.safeParse(old).success).toBe(true);
        old.trades[0] = { ...old.trades[0], counterDepth: MAX_COUNTERS + 1 };
        expect(GameStateSchema.safeParse(old).success).toBe(false);
      });
  });

  it("validates the counter-trade action on the wire", () => {
    const ok = {
      type: "counter-trade",
      tradeId: "t1",
      offer: emptyOffer("p0"),
    };
    expect(GameActionSchema.safeParse(ok).success).toBe(true);
    expect(GameActionSchema.safeParse({ ...ok, offer: undefined }).success).toBe(false);
    expect(GameActionSchema.safeParse({ ...ok, tradeId: "" }).success).toBe(false);
    expect(
      GameActionSchema.safeParse({ ...ok, offer: { ...emptyOffer("p0"), giveCash: -1 } }).success,
    ).toBe(false);
  });
});
