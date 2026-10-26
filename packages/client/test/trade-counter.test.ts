import { describe, expect, it } from "vitest";
import { MAX_COUNTERS, type Trade } from "@poly/engine";
import { canCounter, counterDraft, counterNote } from "../src/ui/trade-counter.ts";

const base: Trade = {
  id: "t1",
  from: "anna",
  to: "ben",
  giveCash: 200,
  giveTiles: [],
  giveJailCards: 0,
  wantCash: 0,
  wantTiles: [1],
  wantJailCards: 0,
  status: "pending",
  createdAt: 0,
  expiresAt: null,
};

describe("counter draft (prefill)", () => {
  it("swaps the terms to the answering player's perspective and targets the proposer", () => {
    expect(counterDraft(base)).toEqual({
      to: "anna",
      giveCash: 0,
      giveTiles: [1],
      giveJailCards: 0,
      wantCash: 200,
      wantTiles: [],
      wantJailCards: 0,
    });
  });

  it("swaps tiles, cash and free cards on both sides and copies the arrays", () => {
    const t: Trade = {
      ...base,
      giveCash: 50,
      giveTiles: [3, 5],
      giveJailCards: 1,
      wantCash: 10,
      wantTiles: [1],
      wantJailCards: 2,
    };
    const d = counterDraft(t);
    expect(d).toEqual({
      to: "anna",
      giveCash: 10,
      giveTiles: [1],
      giveJailCards: 2,
      wantCash: 50,
      wantTiles: [3, 5],
      wantJailCards: 1,
    });
    expect(d.giveTiles).not.toBe(t.wantTiles);
    expect(d.wantTiles).not.toBe(t.giveTiles);
  });
});

describe("canCounter", () => {
  it("allows counters on open offers until the chain limit", () => {
    expect(canCounter(base)).toBe(true);
    expect(canCounter({ ...base, counterDepth: MAX_COUNTERS - 1, counterOf: "t0" })).toBe(true);
    expect(canCounter({ ...base, counterDepth: MAX_COUNTERS, counterOf: "t0" })).toBe(false);
  });

  it("never counters closed offers", () => {
    expect(canCounter({ ...base, status: "countered" })).toBe(false);
    expect(canCounter({ ...base, status: "accepted" })).toBe(false);
  });
});

describe("counter note (history)", () => {
  const counter: Trade = {
    ...base,
    id: "t2",
    from: "ben",
    to: "anna",
    giveCash: 0,
    giveTiles: [1],
    wantCash: 260,
    wantTiles: [],
    counterOf: "t1",
    counterDepth: 1,
  };

  it("names the new and the old price when only the cash differs", () => {
    expect(counterNote(counter, base)).toEqual({ kind: "cash", by: "ben", now: 260, was: 200 });
  });

  it("falls back to a generic note when items changed or the original is gone", () => {
    expect(counterNote({ ...counter, giveTiles: [1, 3] }, base)).toEqual({
      kind: "changed",
      by: "ben",
    });
    expect(counterNote(counter, undefined)).toEqual({ kind: "changed", by: "ben" });
  });

  it("has no note for an original offer", () => {
    expect(counterNote(base, undefined)).toBeNull();
  });

  it("names the amounts when the countering player pays in both offers", () => {
    const prev: Trade = {
      ...base,
      from: "ben",
      to: "anna",
      giveCash: 0,
      giveTiles: [1],
      wantCash: 260,
      wantTiles: [],
    };
    const cur: Trade = {
      ...base,
      id: "t3",
      from: "anna",
      to: "ben",
      giveCash: 230,
      giveTiles: [],
      wantCash: 0,
      wantTiles: [1],
      counterOf: "t2",
      counterDepth: 2,
    };
    expect(counterNote(cur, prev)).toEqual({ kind: "cash", by: "anna", now: 230, was: 260 });
  });

  it("says the terms changed when the money would flip direction", () => {
    const flipped: Trade = { ...counter, giveCash: 300, wantCash: 0 };
    expect(counterNote(flipped, base)).toEqual({ kind: "changed", by: "ben" });
  });

  it("reads the price as what the counterer receives, also across mixed cash on both sides", () => {
    const prev: Trade = { ...base, giveCash: 300, wantCash: 100 }; // net 200 to ben
    const cur: Trade = { ...counter, giveCash: 0, wantCash: 280 };
    expect(counterNote(cur, prev)).toEqual({ kind: "cash", by: "ben", now: 280, was: 200 });
  });
});
