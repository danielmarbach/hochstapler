import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SERVICE_RESTART,
  closeKind,
  decideReload,
  reconnectDelay,
  whenIdle,
} from "../src/net/update.ts";
import { WS_CLOSE_HANDOVER } from "@poly/engine";

describe("closeKind", () => {
  it("treats 1012 (Service Restart) as a deploy, everything else as a normal close", () => {
    expect(SERVICE_RESTART).toBe(1012);
    expect(closeKind(1012)).toBe("restart");
    for (const code of [1000, 1001, 1005, 1006, 1008, 1013, 4408]) {
      expect(closeKind(code)).toBe("normal");
    }
  });

  it("treats 4503 (writer-lease handover) as a handover: another instance takes over within seconds", () => {
    expect(closeKind(WS_CLOSE_HANDOVER)).toBe("handover");
  });
});

describe("reconnectDelay", () => {
  const seq = (kind: "restart" | "normal", n: number) =>
    Array.from({ length: n }, (_, i) => reconnectDelay(kind, i));

  it("keeps the generic backoff for normal closes and errors (500 ms doubling up to 10 s)", () => {
    expect(seq("normal", 7)).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it("retries fast after a restart: 500 ms, 1 s, 2 s and then every 2 s", () => {
    expect(seq("restart", 7)).toEqual([500, 1000, 2000, 2000, 2000, 2000, 2000]);
  });

  it("after a handover retries fast with jitter, so the reconnects of all players do not arrive at once", () => {
    const low = Array.from({ length: 8 }, (_, i) => reconnectDelay("handover", i, () => 0));
    const high = Array.from({ length: 8 }, (_, i) => reconnectDelay("handover", i, () => 0.999));
    expect(low).toEqual([250, 500, 1000, 1000, 1000, 1000, 1000, 1000]);
    for (const [i, d] of high.entries()) {
      expect(d).toBeGreaterThan(low[i] ?? 0);
      expect(d).toBeLessThan(2 * (low[i] ?? 0));
    }
    expect(reconnectDelay("handover", 10_000, () => 0.5)).toBeLessThan(2000);
  });

  it("never exceeds the cap, even for absurd attempt counts", () => {
    expect(reconnectDelay("restart", 10_000)).toBe(2000);
    expect(reconnectDelay("normal", 10_000)).toBe(10_000);
  });
});

describe("decideReload", () => {
  it("does nothing when the builds match", () => {
    expect(decideReload({ server: "a1", own: "a1", reloadedFor: null })).toBe("none");
  });

  it("never reloads for or from a development build", () => {
    expect(decideReload({ server: "dev", own: "a1", reloadedFor: null })).toBe("none");
    expect(decideReload({ server: "a1", own: "dev", reloadedFor: null })).toBe("none");
    expect(decideReload({ server: "dev", own: "dev", reloadedFor: null })).toBe("none");
  });

  it("reloads once when the server runs another build", () => {
    expect(decideReload({ server: "b2", own: "a1", reloadedFor: null })).toBe("reload");
  });

  it("does not reload again if the page already reloaded for this very build (loop guard)", () => {
    expect(decideReload({ server: "b2", own: "a1", reloadedFor: "b2" })).toBe("warn");
  });

  it("reloads again for a build that is newer than the one it reloaded for", () => {
    expect(decideReload({ server: "c3", own: "a1", reloadedFor: "b2" })).toBe("reload");
  });
});

describe("whenIdle", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves immediately when already idle", async () => {
    vi.useFakeTimers();
    await expect(whenIdle(() => true, 5000, 100)).resolves.toBe("idle");
  });

  it("polls until idle", async () => {
    vi.useFakeTimers();
    let busy = true;
    const done = whenIdle(() => !busy, 5000, 100);
    await vi.advanceTimersByTimeAsync(450);
    busy = false;
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toBe("idle");
  });

  it("gives up after the maximum wait", async () => {
    vi.useFakeTimers();
    const done = whenIdle(() => false, 5000, 100);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(done).resolves.toBe("timeout");
  });
});
