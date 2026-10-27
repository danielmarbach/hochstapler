// Ready means "can write" (docs/DESIGN.md #94): a writer whose write self-test fails never reports ready and gives the
// lease back; while active, a few failed writes in a row turn readiness off (the lease stays, the error is logged).
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryLease, MemoryLeaseStore } from "../src/lease/memory.ts";
import { createGame, sleep, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

const TIMING = { durationMs: 3000, renewIntervalMs: 200, safetyMarginMs: 1000 };
const readonlyError = (): Error =>
  Object.assign(new Error("attempt to write a readonly database"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 1544,
    errstr: "attempt to write a readonly database",
  });

describe("write self-test and write health", () => {
  const servers: TestServer[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await s.dispose();
    vi.restoreAllMocks();
  });

  it("a writer that cannot write never becomes ready, gives the lease back, and serves once writes work", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new MemoryLeaseStore();
    let failing = true;
    let opened = 0;
    let closed = 0;
    const ts = await startTestServer({
      writerLease: new MemoryLease(store, TIMING, 20),
      waitUntilActive: false,
      leaseRejoinDelayMs: 150, // steps aside for 2 x 150 ms, then 600 ms, ...
      dbWriteFault: () => {
        if (failing) throw readonlyError();
      },
      writerProbe: { opened: () => opened++, closed: () => closed++, wrote: () => undefined },
    });
    servers.push(ts);
    let sawFree = false;
    const end = Date.now() + 1200;
    while (Date.now() < end) {
      const ready = await fetch(`${ts.base}/api/ready`);
      expect(ready.status).toBe(503);
      if (store.current() === null) sawFree = true;
      await sleep(20);
    }
    expect(sawFree).toBe(true); // the lease was given back between the attempts
    expect(opened).toBeGreaterThanOrEqual(2); // it retried
    expect(closed).toBe(opened); // and closed the database every time
    expect(() => ts.srv.hub).toThrow(/standby/);
    // the file system recovers: the next attempt passes the self-test and serves
    failing = false;
    await ts.srv.whenActive();
    expect((await fetch(`${ts.base}/api/ready`)).status).toBe(200);
    const host = await createGame(ts, { bots: [] });
    expect(ts.srv.hub.db.exists(host.gameId)).toBe(true);
  });

  it("while active: three failed writes in a row turn /api/ready 503 (lease kept), a good write turns it back", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let failing = false;
    const ts = await startTestServer({
      writerLease: new MemoryLease(new MemoryLeaseStore(), TIMING, 20),
      dbWriteFault: () => {
        if (failing) throw readonlyError();
      },
    });
    servers.push(ts);
    const host = await createGame(ts, { bots: [] });
    expect((await fetch(`${ts.base}/api/ready`)).status).toBe(200);
    failing = true;
    const db = ts.srv.hub.db;
    for (let i = 0; i < 2; i++) expect(() => db.touchActivity(host.gameId, 1)).toThrow();
    expect((await fetch(`${ts.base}/api/ready`)).status).toBe(200);
    expect(() => db.touchActivity(host.gameId, 1)).toThrow();
    const ready = await fetch(`${ts.base}/api/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ state: "active", writes: "failing" });
    expect(ts.srv.writerState()).toBe("active");
    expect(errors.mock.calls.flat().join(" ")).toMatch(/database writes failing/);
    failing = false;
    db.touchActivity(host.gameId, 2);
    expect((await fetch(`${ts.base}/api/ready`)).status).toBe(200);
  });
});
