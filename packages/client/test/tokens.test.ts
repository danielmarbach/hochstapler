import { describe, expect, it } from "vitest";
import { effectiveToken, takenTokens } from "../src/ui/tokens.ts";

const seats = [
  { playerId: "p1", name: "Anna", tokenId: "cow" },
  { playerId: "p2", name: "Ben", tokenId: "cheese" },
];

describe("takenTokens", () => {
  it("maps every token to its holder", () => {
    expect([...takenTokens(seats)]).toEqual([
      ["cow", "Anna"],
      ["cheese", "Ben"],
    ]);
  });
  it("leaves out the viewer's own seat", () => {
    expect([...takenTokens(seats, "p1")]).toEqual([["cheese", "Ben"]]);
  });
});

describe("effectiveToken", () => {
  const ids = ["cow", "swiss-knife", "cheese", "watch"];
  const taken = takenTokens(seats);
  it("keeps a free wish", () => {
    expect(effectiveToken(ids, taken, "watch")).toBe("watch");
  });
  it("falls back to the first free piece for a taken wish, an unknown wish or no wish", () => {
    expect(effectiveToken(ids, taken, "cow")).toBe("swiss-knife");
    expect(effectiveToken(ids, taken, "pretzel")).toBe("swiss-knife");
    expect(effectiveToken(ids, taken, null)).toBe("swiss-knife");
  });
  it("is null when nothing is free", () => {
    expect(effectiveToken(["cow"], taken, null)).toBeNull();
  });
});
