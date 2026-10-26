import { describe, expect, it } from "vitest";
import { applyBotAction, chooseBotAction, whoMustAct } from "../src/index.ts";
import {
  CURRENT_STATE_VERSION,
  GameStateSchema,
  STATE_MIGRATION_CHAIN,
  StateMigrationError,
  migrateState,
} from "../src/index.ts";
import type { StateMigrationChain } from "../src/index.ts";
import { assertInvariants } from "./invariants.ts";
import { mk } from "./util.ts";

/** What the server stores: plain JSON, no prototypes, no undefined. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("GameStateSchema", () => {
  it("accepts a fresh game and returns an equal state", () => {
    const s = mk(3);
    expect(GameStateSchema.parse(asStored(s))).toEqual(s);
  });

  it("accepts states along a bot game (every phase shape) and round-trips them", () => {
    let s = mk(3, { turnTimeoutSec: 0 }, "bot");
    const phases = new Set<string>();
    for (let i = 0; i < 400 && s.status === "running"; i++) {
      const pid = whoMustAct(s)[0];
      if (!pid) break;
      const a = chooseBotAction(s, pid);
      if (!a) break;
      s = applyBotAction(s, pid, a, 2000 + i).state;
      phases.add(s.phase.type);
      expect(GameStateSchema.parse(asStored(s))).toEqual(s);
    }
    expect(phases.size).toBeGreaterThan(2);
  });

  it("rejects a state with a missing required field", () => {
    const { bank: _bank, ...rest } = mk(2);
    expect(GameStateSchema.safeParse(asStored(rest)).success).toBe(false);
  });

  it("rejects an unknown phase and an unknown controller", () => {
    const s = mk(2);
    expect(GameStateSchema.safeParse(asStored({ ...s, phase: { type: "dancing" } })).success).toBe(
      false,
    );
    const bad = { ...s, players: s.players.map((p) => ({ ...p, controller: "ghost" })) };
    expect(GameStateSchema.safeParse(asStored(bad)).success).toBe(false);
  });

  it("accepts the optional additive fields (auction autoBids, debt auctionTile, log msg)", () => {
    const s = mk(2);
    const withAuction = {
      ...s,
      phase: {
        type: "auction",
        auction: {
          tile: 1,
          highestBid: 10,
          highestBidder: "p0",
          bidders: ["p0", "p1"],
          turn: "p1",
          autoBids: { p1: 300 },
        },
      },
    };
    expect(GameStateSchema.safeParse(asStored(withAuction)).success).toBe(true);
    const withDebt = {
      ...s,
      phase: { type: "debt", debtor: "p1", creditor: null, amount: 50, auctionTile: 3 },
    };
    expect(GameStateSchema.safeParse(asStored(withDebt)).success).toBe(true);
    const withMsg = { ...s, log: [{ at: 1, text: "x", msg: { key: "err.generic", params: {} } }] };
    expect(GameStateSchema.safeParse(asStored(withMsg)).success).toBe(true);
    const badMsg = { ...s, log: [{ at: 1, text: "x", msg: { key: "no.such.key", params: {} } }] };
    expect(GameStateSchema.safeParse(asStored(badMsg)).success).toBe(false);
  });

  it("rejects property tiles that are not numbers", () => {
    const s = mk(2);
    const bad = { ...s, properties: { abc: { owner: null, level: 0, mortgaged: false } } };
    expect(GameStateSchema.safeParse(asStored(bad)).success).toBe(false);
  });
});

describe("migrateState", () => {
  it("is at least version 1 and the chain has one step per version bump", () => {
    expect(CURRENT_STATE_VERSION).toBeGreaterThanOrEqual(1);
    expect(STATE_MIGRATION_CHAIN.current).toBe(CURRENT_STATE_VERSION);
    expect(STATE_MIGRATION_CHAIN.steps).toHaveLength(CURRENT_STATE_VERSION - 1);
  });

  it("returns the validated current-version state unchanged", () => {
    const s = mk(3);
    expect(migrateState(asStored(s), CURRENT_STATE_VERSION)).toEqual(s);
  });

  it("applies the steps from the stored version to the current one, in order, purely", () => {
    const log: string[] = [];
    const chain: StateMigrationChain = {
      current: 4,
      steps: [
        (j) => {
          log.push("1->2");
          return { ...(j as object), freeParkingPot: 100 };
        },
        (j) => {
          log.push("2->3");
          return { ...(j as { freeParkingPot: number }), freeParkingPot: 3 * 100 };
        },
        (j) => {
          log.push("3->4");
          return { ...(j as { freeParkingPot: number }), freeParkingPot: 7 };
        },
      ],
    };
    const input = asStored(mk(2));
    const frozen = JSON.stringify(input);
    expect(migrateState(input, 1, chain).freeParkingPot).toBe(7);
    expect(log).toEqual(["1->2", "2->3", "3->4"]);
    log.length = 0;
    expect(migrateState(input, 3, chain).freeParkingPot).toBe(7);
    expect(log).toEqual(["3->4"]);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("refuses versions that are unknown, from the future or not integers", () => {
    const json = asStored(mk(2));
    for (const v of [0, -1, 1.5, CURRENT_STATE_VERSION + 1, Number.NaN]) {
      expect(() => migrateState(json, v)).toThrow(StateMigrationError);
    }
  });

  it("fails loudly when a step produces an invalid state (instead of storing it)", () => {
    const chain: StateMigrationChain = { current: 2, steps: [() => ({ nonsense: true })] };
    expect(() => migrateState(asStored(mk(2)), 1, chain)).toThrow();
  });

  it("migrated states keep playing: bots continue and invariants hold", () => {
    let s = migrateState(asStored(mk(3, { turnTimeoutSec: 0 }, "bot")), CURRENT_STATE_VERSION);
    for (let i = 0; i < 60 && s.status === "running"; i++) {
      const pid = whoMustAct(s)[0];
      if (!pid) break;
      const a = chooseBotAction(s, pid);
      if (!a) break;
      s = applyBotAction(s, pid, a, 3000 + i).state;
      assertInvariants(s);
    }
    expect(s.version).toBeGreaterThan(0);
  });
});
