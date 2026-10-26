import gsap from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clock, onMotionPreference, setReducedMotion, sleep, tween } from "../src/three/tween.ts";

afterEach(() => {
  setReducedMotion(false);
  clock.speed = 1;
});

describe("reduced motion (UI review F06)", () => {
  it("jumps tweens to their final state in a single call instead of speeding them up", async () => {
    setReducedMotion(true);
    const seen: number[] = [];
    await tween(5, (k) => seen.push(k));
    expect(seen).toEqual([1]);
    // no x30 boost any more: the global timeline keeps its normal speed
    expect(gsap.globalTimeline.timeScale()).toBe(1);
    clock.speed = 2;
    expect(gsap.globalTimeline.timeScale()).toBe(2);
  });

  it("does not wait for sleeps", async () => {
    setReducedMotion(true);
    const start = Date.now();
    await sleep(5);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("plays animations normally again when the preference is switched off", async () => {
    setReducedMotion(true);
    setReducedMotion(false);
    const seen: number[] = [];
    await tween(0.05, (k) => seen.push(k), "none");
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
  });

  it("finishes running animations when the preference is switched on and tells the scene", async () => {
    const seen: number[] = [];
    const running = tween(30, (k) => seen.push(k), "none");
    const changes: boolean[] = [];
    const off = onMotionPreference((reduced) => changes.push(reduced));
    setReducedMotion(true);
    await running;
    expect(seen.at(-1)).toBe(1);
    expect(changes).toEqual([true]);
    setReducedMotion(true); // unchanged: no second notification
    setReducedMotion(false);
    expect(changes).toEqual([true, false]);
    off();
  });

  it("keeps a unit of work intact: the callback still runs for a zero duration", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    await tween(0, (k) => seen.push(k));
    vi.useRealTimers();
    expect(seen).toEqual([1]);
  });
});
