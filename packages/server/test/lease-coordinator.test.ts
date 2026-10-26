// The writer state machine (standby -> acquiring -> active -> draining -> standby) against the in-memory lease with
// fake timers: handover, holder death, a new holder dying after the break, a lost lease and the renewal margins.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WriterCoordinator, validateTiming } from "../src/lease/coordinator.ts";
import type { LeaseEvent, WriterHooks, WriterState } from "../src/lease/coordinator.ts";
import { MemoryLease, MemoryLeaseStore } from "../src/lease/memory.ts";

/** Records what the hooks did and how many instances had the "database" open at once. */
class Probe {
  static open = 0;
  static maxOpen = 0;
  readonly calls: string[] = [];
  isOpen = false;
  drainMs = 0;
  readonly events: LeaseEvent[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  hooks(): WriterHooks {
    return {
      activate: () => {
        this.calls.push("activate");
        this.isOpen = true;
        Probe.open++;
        Probe.maxOpen = Math.max(Probe.maxOpen, Probe.open);
        return Promise.resolve();
      },
      drain: async () => {
        this.calls.push("drain");
        if (this.drainMs > 0) await new Promise((ok) => setTimeout(ok, this.drainMs));
        this.close();
      },
      fence: () => {
        this.calls.push("fence");
        this.close();
      },
      disconnect: (reason) => {
        this.calls.push(`disconnect:${reason}`);
      },
    };
  }
  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    Probe.open--;
  }
}

function instance(store: MemoryLeaseStore, name: string) {
  const probe = new Probe(name);
  const lease = new MemoryLease(store);
  const coordinator = new WriterCoordinator(lease, probe.hooks(), {
    clock: () => Date.now(),
    onEvent: (e) => probe.events.push(e),
  });
  return { probe, lease, coordinator };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("WriterCoordinator", () => {
  let store: MemoryLeaseStore;
  beforeEach(() => {
    vi.useFakeTimers();
    Probe.open = 0;
    Probe.maxOpen = 0;
    store = new MemoryLeaseStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquires a free lease, activates and keeps renewing", async () => {
    const a = instance(store, "a");
    expect(a.coordinator.state).toBe<WriterState>("standby");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    expect(a.coordinator.state).toBe("active");
    expect(a.probe.calls).toEqual(["activate"]);
    expect(a.coordinator.canWrite()).toBe(true);
    // renewals keep it valid far beyond one lease duration
    await advance(60_000);
    expect(a.coordinator.canWrite()).toBe(true);
    expect(store.current()).toBe(a.lease.id);
    expect(a.probe.events.map((e) => e.type)).toContain("acquired");
    await a.coordinator.stop();
  });

  it("hands over: the holder drains, closes, releases, then disconnects; the newcomer activates after it", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    a.probe.drainMs = 500;
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: true });
    await advance(10);
    expect(b.coordinator.state).toBe("acquiring");
    expect(a.coordinator.state).toBe("active");
    // A notices at its next renewal (<= 3 s), drains for 0.5 s, releases; B polls every 100 ms
    await advance(3000);
    expect(a.coordinator.state).toBe("draining");
    expect(a.coordinator.canWrite()).toBe(true); // persisting during the drain is still allowed
    await advance(800);
    expect(a.probe.calls).toEqual(["activate", "drain", "disconnect:handover"]);
    expect(a.coordinator.state).toBe("standby");
    expect(a.coordinator.canWrite()).toBe(false);
    expect(b.coordinator.state).toBe("active");
    expect(b.coordinator.canWrite()).toBe(true);
    expect(Probe.maxOpen).toBe(1);
    const order = store.log.filter((l) => !l.startsWith("acquire:") || l.endsWith(b.lease.id));
    expect(order.indexOf(`release:${a.lease.id}`)).toBeLessThan(
      order.indexOf(`acquire:${b.lease.id}`),
    );
    expect(a.probe.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["handover-requested", "handover-completed"]),
    );
    // the former holder stays a candidate but does not steal the lease back while B is alive
    await advance(120_000);
    expect(a.coordinator.state).toBe("acquiring");
    expect(b.coordinator.state).toBe("active");
    expect(Probe.maxOpen).toBe(1);
    await b.coordinator.stop();
    await a.coordinator.stop();
  });

  it("takes over from a dead holder once the break period has passed", async () => {
    store.tryAcquire("dead-holder"); // never renews, never answers
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: true });
    await advance(14_000);
    expect(b.coordinator.state).toBe("acquiring");
    await advance(1200);
    expect(b.coordinator.state).toBe("active");
    await b.coordinator.stop();
  });

  it("the former holder takes the lease back when the new holder dies after the handover", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: true });
    await advance(4000);
    expect(b.coordinator.state).toBe("active");
    // B dies: its process is gone, nothing renews any more (no hooks run)
    b.lease.renewBehaviour = "hang";
    b.coordinator.abandon();
    await advance(60_000);
    expect(a.coordinator.state).toBe("active");
    expect(store.current()).toBe(a.lease.id);
    await a.coordinator.stop();
  });

  it("a lost lease stops writes at once: fence, no drain, then it tries again", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    a.lease.renewBehaviour = "fail";
    await advance(3000);
    expect(a.probe.calls).toEqual(["activate", "fence", "disconnect:lost"]);
    expect(a.coordinator.canWrite()).toBe(false);
    expect(a.probe.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["renew-failed", "lost"]),
    );
    a.lease.renewBehaviour = "normal";
    await advance(5000);
    expect(a.coordinator.state).toBe("active");
    expect(a.probe.calls.at(-1)).toBe("activate");
    await a.coordinator.stop();
  });

  it("refuses writes before the lease could expire when a renewal hangs (safety margin)", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    const lastRenewAt = Date.now();
    a.lease.renewBehaviour = "hang";
    // the next renewal is sent at +3 s and never answers; the last good one was sent at about lastRenewAt
    await advance(9_000);
    expect(a.coordinator.canWrite()).toBe(true);
    await advance(1_500); // past lastRenew + 15 s - 5 s margin
    expect(a.coordinator.canWrite()).toBe(false);
    expect(a.probe.calls).toContain("fence");
    // the lease in the store would still be valid for a few seconds: the margin keeps us clear of it
    expect(store.expiresAt).toBeGreaterThan(Date.now());
    expect(Date.now() - lastRenewAt).toBeLessThan(15_000);
    a.lease.renewBehaviour = "normal";
    await a.coordinator.stop();
  });

  it("stop() drains and releases the lease (graceful shutdown) and never disconnects itself", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    await a.coordinator.stop();
    expect(a.probe.calls).toEqual(["activate", "drain"]);
    expect(store.current()).toBeNull();
    expect(a.coordinator.state).toBe("standby");
  });

  it("stop() while waiting for the lease just stops waiting", async () => {
    store.tryAcquire("someone");
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: false });
    await advance(1000);
    expect(a.coordinator.state).toBe("acquiring");
    await a.coordinator.stop();
    expect(a.probe.calls).toEqual([]);
    expect(store.current()).toBe("someone");
  });

  it("an activation that fails gives the lease back and retries later", async () => {
    const a = instance(store, "a");
    const hooks = a.probe.hooks();
    let fail = true;
    const c = new WriterCoordinator(
      a.lease,
      {
        ...hooks,
        activate: () => (fail ? Promise.reject(new Error("disk full")) : hooks.activate()),
      },
      { clock: () => Date.now(), retryDelayMs: 1000 },
    );
    c.start({ requestHandover: true });
    await advance(10);
    expect(c.state).not.toBe("active");
    expect(store.current()).toBeNull();
    fail = false;
    await advance(1500);
    expect(c.state).toBe("active");
    await c.stop();
  });
});

describe("WriterCoordinator, handover on traffic (DESIGN #91)", () => {
  let store: MemoryLeaseStore;
  beforeEach(() => {
    vi.useFakeTimers();
    Probe.open = 0;
    Probe.maxOpen = 0;
    store = new MemoryLeaseStore();
  });
  afterEach(() => vi.useRealTimers());
  const breaks = () => store.log.filter((l) => l === "break").length;

  it("a fresh process takes a free lease without any traffic", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: "on-traffic" });
    await advance(10);
    expect(a.coordinator.state).toBe("active");
    expect(breaks()).toBe(0);
    await a.coordinator.stop();
  });

  it("takes over from a dead holder without traffic once the lease has expired", async () => {
    store.tryAcquire("dead-holder");
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: "on-traffic" });
    await advance(14_000);
    expect(b.coordinator.state).toBe("acquiring");
    await advance(1200);
    expect(b.coordinator.state).toBe("active");
    expect(breaks()).toBe(0);
    await b.coordinator.stop();
  });

  it("does not break a live holder before its first real request, and asks it to hand over right after", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: "on-traffic" });
    await advance(60_000);
    expect(b.coordinator.state).toBe("acquiring");
    expect(a.coordinator.state).toBe("active");
    expect(breaks()).toBe(0);
    expect(b.probe.events.map((e) => e.type)).not.toContain("handover-triggered");

    b.coordinator.noteTraffic();
    b.coordinator.noteTraffic(); // only the first one counts
    await advance(10);
    expect(breaks()).toBe(1);
    expect(b.probe.events.filter((e) => e.type === "handover-triggered")).toHaveLength(1);
    await advance(3500);
    expect(a.coordinator.state).toBe("standby");
    expect(b.coordinator.state).toBe("active");
    expect(Probe.maxOpen).toBe(1);
    expect(breaks()).toBe(1);
    await b.coordinator.stop();
    await a.coordinator.stop();
  });

  it("traffic that arrived before start() breaks in the first round", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    const b = instance(store, "b");
    b.coordinator.noteTraffic();
    b.coordinator.start({ requestHandover: "on-traffic" });
    await advance(3500);
    expect(b.coordinator.state).toBe("active");
    expect(breaks()).toBe(1);
    await b.coordinator.stop();
    await a.coordinator.stop();
  });

  it("a former holder in standby never breaks the lease, however much traffic it gets (no ping-pong)", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: "on-traffic" });
    await advance(10);
    expect(a.coordinator.state).toBe("active");
    a.coordinator.noteTraffic(); // traffic while holding: nothing to break
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: "on-traffic" });
    b.coordinator.noteTraffic();
    await advance(3500);
    expect(b.coordinator.state).toBe("active");
    expect(breaks()).toBe(1);
    // A is a candidate again (after its rejoin delay) and still gets requests: it must wait, never break
    a.coordinator.noteTraffic();
    await advance(120_000);
    a.coordinator.noteTraffic();
    await advance(120_000);
    expect(a.coordinator.state).toBe("acquiring");
    expect(b.coordinator.state).toBe("active");
    expect(breaks()).toBe(1);
    expect(a.probe.events.map((e) => e.type)).not.toContain("handover-triggered");
    await b.coordinator.stop();
    await a.coordinator.stop();
  });

  it("a process that held the lease before its first request never breaks after losing it", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: "on-traffic" });
    await advance(10);
    a.lease.renewBehaviour = "fail";
    await advance(3000);
    expect(a.probe.calls).toContain("fence");
    store.tryAcquire("someone-else");
    a.lease.renewBehaviour = "normal";
    a.coordinator.noteTraffic();
    await advance(5000);
    expect(a.coordinator.state).toBe("acquiring");
    expect(breaks()).toBe(0);
    await a.coordinator.stop();
  });

  it("the immediate mode ignores traffic: it asked once at start and never again", async () => {
    const a = instance(store, "a");
    a.coordinator.start({ requestHandover: true });
    await advance(10);
    const b = instance(store, "b");
    b.coordinator.start({ requestHandover: true });
    await advance(3500);
    expect(breaks()).toBe(1);
    a.coordinator.noteTraffic();
    await advance(120_000);
    expect(breaks()).toBe(1);
    expect(b.coordinator.state).toBe("active");
    await b.coordinator.stop();
    await a.coordinator.stop();
  });
});

describe("WriterCoordinator.whenActive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves once activated and rejects for a fatal activation error (no retry)", async () => {
    const store = new MemoryLeaseStore();
    const ok = instance(store, "ok");
    const active = ok.coordinator.whenActive();
    ok.coordinator.start({ requestHandover: true });
    await advance(10);
    await expect(active).resolves.toBeUndefined();
    await expect(ok.coordinator.whenActive()).resolves.toBeUndefined();
    await ok.coordinator.stop();

    const fatal = new Error("migration failed");
    const c = new WriterCoordinator(
      new MemoryLease(store),
      { ...ok.probe.hooks(), activate: () => Promise.reject(fatal) },
      { clock: () => Date.now(), isFatal: (e) => e === fatal },
    );
    const waiting = c.whenActive();
    c.start({ requestHandover: true });
    await expect(waiting).rejects.toBe(fatal);
    await advance(10_000);
    expect(c.state).toBe("standby");
    expect(store.current()).toBeNull();
  });
});

describe("validateTiming", () => {
  it("accepts the Azure defaults and refuses timings without room for a renewal", () => {
    expect(() =>
      validateTiming({ durationMs: 15_000, renewIntervalMs: 3000, safetyMarginMs: 5000 }),
    ).not.toThrow();
    expect(() =>
      validateTiming({ durationMs: 15_000, renewIntervalMs: 6000, safetyMarginMs: 5000 }),
    ).toThrow(/renew/);
    expect(() =>
      validateTiming({ durationMs: 15_000, renewIntervalMs: 3000, safetyMarginMs: 0 }),
    ).toThrow(/margin/);
  });
});
