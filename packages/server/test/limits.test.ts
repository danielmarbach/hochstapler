import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionCounter, KeyedLimiter, loadLimits } from "../src/limits.ts";

describe("KeyedLimiter (rate-limiter-flexible)", () => {
  afterEach(() => vi.useRealTimers());
  const make = (maxKeys = 100) => {
    vi.useFakeTimers({ now: 1_000_000 });
    // burst 3 at 3600/h -> 3 points per 3 s window
    const limiter = new KeyedLimiter({ burst: 3, perHour: 3600, maxKeys });
    return { limiter, advance: (ms: number) => vi.advanceTimersByTime(ms) };
  };

  it("allows a burst, then refuses with a Retry-After", async () => {
    const { limiter, advance } = make();
    const first = [await limiter.take("a"), await limiter.take("a"), await limiter.take("a")];
    expect(first.map((t) => t.ok)).toEqual([true, true, true]);
    expect(await limiter.take("a")).toEqual({ ok: false, retryAfterSec: 3 });
    advance(3000);
    expect((await limiter.take("a")).ok).toBe(true);
  });

  it("derives the window from burst and perHour (sustained rate = perHour)", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    // burst 5 at 10 per hour -> 5 points per 30 minutes
    const limiter = new KeyedLimiter({ burst: 5, perHour: 10 });
    for (let i = 0; i < 5; i++) await limiter.take("a");
    const refused = await limiter.take("a");
    expect(refused).toEqual({ ok: false, retryAfterSec: 1800 });
    vi.advanceTimersByTime(1_800_000);
    expect((await limiter.take("a")).ok).toBe(true);
  });

  it("keeps clients apart", async () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i++) await limiter.take("a");
    expect((await limiter.take("a")).ok).toBe(false);
    expect((await limiter.take("b")).ok).toBe(true);
  });

  it("refuses everything with burst 0 and never refills with perHour 0", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    expect((await new KeyedLimiter({ burst: 0, perHour: 5 }).take("a")).ok).toBe(false);
    const never = new KeyedLimiter({ burst: 1, perHour: 0 });
    expect((await never.take("a")).ok).toBe(true);
    const refused = await never.take("a");
    expect(refused.ok).toBe(false);
    vi.advanceTimersByTime(3_600_000);
    expect((await never.take("a")).ok).toBe(false);
  });

  it("drops expired clients and never tracks more than maxKeys", async () => {
    const { limiter, advance } = make(5);
    for (let i = 0; i < 50; i++) await limiter.take(`ip${i}`);
    expect(limiter.size).toBeLessThanOrEqual(5);
    advance(10_000);
    limiter.prune();
    expect(limiter.size).toBe(0);
  });

  it("an evicted client starts fresh (the oldest key is dropped, not a random one)", async () => {
    const { limiter } = make(2);
    for (let i = 0; i < 3; i++) await limiter.take("a");
    await limiter.take("b");
    await limiter.take("c"); // evicts "a"
    expect((await limiter.take("a")).ok).toBe(true);
  });
});

describe("ConnectionCounter", () => {
  it("counts per key, refuses above the cap and forgets keys at zero", () => {
    const c = new ConnectionCounter(2);
    expect(c.acquire("a")).toBe(true);
    expect(c.acquire("a")).toBe(true);
    expect(c.acquire("a")).toBe(false);
    expect(c.acquire("b")).toBe(true);
    c.release("a");
    expect(c.acquire("a")).toBe(true);
    c.release("a");
    c.release("a");
    c.release("b");
    expect(c.size).toBe(0);
  });
});

describe("loadLimits", () => {
  it("has sane defaults and validates env overrides", () => {
    const d = loadLimits({});
    expect(d).toMatchObject({
      createPerHour: 10,
      joinPerHour: 30,
      maxRunningGames: 50,
      maxOpenLobbies: 200,
      wsPerIp: 20,
    });
    expect(loadLimits({ MAX_RUNNING_GAMES: "7" }).maxRunningGames).toBe(7);
    expect(() => loadLimits({ MAX_RUNNING_GAMES: "-1" })).toThrow();
    expect(loadLimits({}, { wsPerIp: 3 }).wsPerIp).toBe(3);
  });
});
