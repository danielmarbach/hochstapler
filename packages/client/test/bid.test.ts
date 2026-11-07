// Auction bid amount: the pre-filled bid and the - / + steppers keep every amount inside what the engine accepts.
import { describe, expect, it } from "vitest";
import { defaultBid, stepBid } from "../src/ui/bid.ts";

describe("defaultBid", () => {
  it("starts at the minimum raise of 10 when nobody has bid", () => {
    expect(defaultBid(0)).toBe(10);
  });

  it("raises small bids by 10 and large bids by 10 percent", () => {
    expect(defaultBid(40)).toBe(50);
    expect(defaultBid(100)).toBe(110);
    expect(defaultBid(500)).toBe(550);
  });
});

describe("stepBid", () => {
  it("raises and lowers by the step", () => {
    expect(stepBid(60, 10, 0, 2000)).toBe(70);
    expect(stepBid(60, -10, 0, 2000)).toBe(50);
    expect(stepBid(20, 50, 0, 2000)).toBe(70);
  });

  it("never goes below the current highest bid plus one", () => {
    expect(stepBid(10, -10, 0, 2000)).toBe(1);
    expect(stepBid(55, -10, 50, 2000)).toBe(51);
  });

  it("never goes above what the player may bid", () => {
    expect(stepBid(1990, 50, 0, 2000)).toBe(2000);
    expect(stepBid(300, 10, 0, 300)).toBe(300);
  });

  it("pulls a stale amount below the minimum up to it (the highest bid moved while typing)", () => {
    expect(stepBid(30, 10, 80, 2000)).toBe(81);
  });
});
