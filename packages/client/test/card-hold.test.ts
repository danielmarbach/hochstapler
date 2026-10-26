import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARD_MAX_HOLD_MS,
  CARD_MAX_READING_MS,
  CARD_READING_MS,
  CARD_RELEASE_MS,
  CardHold,
  readingTime,
} from "../src/game/card-hold.ts";

describe("readingTime", () => {
  it("never drops below the minimum and grows with the text, up to a cap", () => {
    expect(readingTime(10)).toBe(CARD_READING_MS);
    expect(readingTime(90)).toBeGreaterThan(CARD_READING_MS);
    expect(readingTime(10_000)).toBe(CARD_MAX_READING_MS);
  });

  it("shortens only when the event backlog speeds the game up", () => {
    expect(readingTime(90, 3)).toBeCloseTo(readingTime(90) / 3);
    expect(readingTime(90, 0.5)).toBe(readingTime(90));
  });
});

describe("CardHold", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("expires after the reading time", () => {
    const expire = vi.fn();
    const hold = new CardHold(expire);
    hold.show(1000);
    vi.advanceTimersByTime(999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(hold.active).toBe(false);
  });

  it("holding extends the time, but only up to the maximum", () => {
    const expire = vi.fn();
    const hold = new CardHold(expire);
    hold.show(1000);
    hold.hold();
    vi.advanceTimersByTime(CARD_MAX_HOLD_MS - 1);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("releasing leaves a short grace period", () => {
    const expire = vi.fn();
    const hold = new CardHold(expire);
    hold.show(5000);
    hold.hold();
    hold.release();
    vi.advanceTimersByTime(CARD_RELEASE_MS);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("holds and releases without a card do nothing; clear cancels the timer", () => {
    const expire = vi.fn();
    const hold = new CardHold(expire);
    hold.hold();
    hold.release();
    expect(hold.active).toBe(false);
    hold.show(1000);
    hold.clear();
    vi.advanceTimersByTime(60_000);
    expect(expire).not.toHaveBeenCalled();
  });
});
