// File writer lease (local disks only): exclusive create, heartbeat, break file as the handover signal, stale takeover.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLease, LEASE_FILE, BREAK_FILE } from "../src/lease/file.ts";
import type { FileLeaseOptions } from "../src/lease/file.ts";

const timing = { durationMs: 15_000, renewIntervalMs: 3000, safetyMarginMs: 5000 };

describe("FileLease", () => {
  let dir: string;
  const make = (o: Partial<FileLeaseOptions> = {}) =>
    new FileLease(dir, { timing, pollMs: 100, now: () => Date.now(), ...o });
  const settled = async (p: Promise<unknown>): Promise<boolean> => {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(0);
    return done;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "poly-lease-"));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the first instance gets the lease; a second one waits while it is renewed", async () => {
    const a = make();
    await a.acquire(new AbortController().signal);
    expect(existsSync(join(dir, LEASE_FILE))).toBe(true);
    const b = make();
    const abort = new AbortController();
    const waiting = b.acquire(abort.signal);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(3000);
      expect(await a.renew()).toBe("held");
    }
    expect(await settled(waiting)).toBe(false);
    abort.abort();
    await expect(waiting).rejects.toThrow(/abort/);
    // the lease id never ends up in a place that is printed: the file only carries it for the owner check
    expect(readFileSync(join(dir, LEASE_FILE), "utf8")).toContain(a.id);
  });

  it("a handover request is answered at the next renewal; the newcomer gets the lease after the release", async () => {
    const a = make();
    await a.acquire(new AbortController().signal);
    const b = make();
    await b.requestHandover();
    expect(existsSync(join(dir, BREAK_FILE))).toBe(true);
    const waiting = b.acquire(new AbortController().signal);
    expect(await a.renew()).toBe("handover-requested");
    expect(await settled(waiting)).toBe(false);
    await a.release();
    await vi.advanceTimersByTimeAsync(150);
    expect(await settled(waiting)).toBe(true);
    expect(existsSync(join(dir, BREAK_FILE))).toBe(false);
    expect(await b.renew()).toBe("held");
    // the former holder has lost it for good
    expect(await a.renew()).toBe("lost");
  });

  it("takes over from a holder that stopped renewing once the break period is over", async () => {
    const a = make({ breakPeriodMs: 8000 });
    await a.acquire(new AbortController().signal);
    const b = make({ breakPeriodMs: 8000 });
    await b.requestHandover();
    const waiting = b.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await settled(waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await settled(waiting)).toBe(true);
    expect(await a.renew()).toBe("lost");
  });

  it("without a handover request a silent holder is taken over after the lease duration", async () => {
    const a = make();
    await a.acquire(new AbortController().signal);
    const b = make();
    const waiting = b.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(await settled(waiting)).toBe(false);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await settled(waiting)).toBe(true);
  });

  it("a renewal after its own lease has run out is lost (somebody may have taken it)", async () => {
    const a = make();
    await a.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await a.renew()).toBe("lost");
  });

  it("a crashed earlier process on this host is detected at once (dead pid / restarted container)", async () => {
    const dead = make({ boot: "old-boot", pid: 999_999, isAlive: () => false });
    await dead.acquire(new AbortController().signal);
    const b = make({ boot: "new-boot", pid: 4242, isAlive: (pid) => pid === 4242 });
    const waiting = b.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);
    expect(await settled(waiting)).toBe(true);
  });

  it("the same pid in a new container (pid 1 again) is an earlier incarnation, not a live holder", async () => {
    const before = make({ boot: "container-1", pid: 1, isAlive: () => true });
    await before.acquire(new AbortController().signal);
    const after = make({ boot: "container-2", pid: 1, isAlive: () => true });
    const waiting = after.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);
    expect(await settled(waiting)).toBe(true);
  });

  it("two leases inside one process never declare each other dead", async () => {
    const a = make();
    await a.acquire(new AbortController().signal);
    const b = make();
    const waiting = b.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await a.renew()).toBe("held");
    expect(await settled(waiting)).toBe(false);
    await a.release();
    await vi.advanceTimersByTimeAsync(200);
    expect(await settled(waiting)).toBe(true);
  });

  it("an unreadable lease file counts as held until it is older than the lease duration", async () => {
    writeFileSync(join(dir, LEASE_FILE), "{half");
    const b = make();
    const waiting = b.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await settled(waiting)).toBe(false);
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, LEASE_FILE), old, old);
    await vi.advanceTimersByTimeAsync(200);
    expect(await settled(waiting)).toBe(true);
  });

  it("release by somebody who does not hold the lease changes nothing", async () => {
    const a = make();
    await a.acquire(new AbortController().signal);
    await make().release();
    expect(await a.renew()).toBe("held");
  });
});
