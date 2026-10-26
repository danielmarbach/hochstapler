import { describe, expect, it } from "vitest";
import { RenderScheduler, ACTIVE_FRAME_MS, IDLE_FRAME_MS } from "../src/three/schedule.ts";

const sched = () => new RenderScheduler({ activeMs: ACTIVE_FRAME_MS, idleMs: IDLE_FRAME_MS });

describe("RenderScheduler", () => {
  it("renders the very first frame", () => {
    expect(sched().decide(0)).toBe("active");
  });

  it("skips frames in between while idle and renders water at the idle rate", () => {
    const s = sched();
    s.rendered(0);
    expect(s.decide(8)).toBe("skip");
    expect(s.decide(16.7)).toBe("skip");
    expect(s.decide(33.4)).toBe("skip");
    expect(s.decide(41.7)).toBe("idle");
  });

  it("renders on demand after invalidate, capped at the active rate (60 fps on 120 Hz)", () => {
    const s = sched();
    s.rendered(0);
    s.invalidate();
    expect(s.decide(8.3)).toBe("skip");
    expect(s.decide(16.7)).toBe("active");
  });

  it("keeps the request while throttled and clears it once rendered", () => {
    const s = sched();
    s.rendered(100);
    s.invalidate();
    s.decide(104);
    expect(s.decide(116.7)).toBe("active");
    s.rendered(116.7);
    expect(s.decide(125)).toBe("skip");
  });

  it("collects shadow requests until the next render", () => {
    const s = sched();
    expect(s.takeShadowDirty()).toBe(true); // the first frame always draws shadows
    s.rendered(0);
    s.invalidate(false);
    expect(s.takeShadowDirty()).toBe(false);
    s.invalidate(true);
    expect(s.takeShadowDirty()).toBe(true);
    expect(s.takeShadowDirty()).toBe(false);
  });

  it("reports pending work and the time until the next idle frame", () => {
    const s = sched();
    expect(s.pending).toBe(true);
    s.rendered(100);
    expect(s.pending).toBe(false);
    expect(s.idleDelay(110)).toBe(IDLE_FRAME_MS - 10);
    expect(s.idleDelay(500)).toBe(0);
  });

  it("slow mode (lite) uses one interval for everything", () => {
    const s = new RenderScheduler({ activeMs: 250, idleMs: 250 });
    s.rendered(0);
    s.invalidate();
    expect(s.decide(100)).toBe("skip");
    expect(s.decide(250)).toBe("active");
  });
});
