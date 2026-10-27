// Blue/green handover with the writer lease (docs/DESIGN.md #89): two server instances on the same
// database file with the real file lease. At no time do both have the database open, nobody writes without being the
// only open instance, games continue across the handover and no state is lost.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WS_CLOSE_HANDOVER } from "@poly/engine";
import { FileLease } from "../src/lease/file.ts";
import { MemoryLease, MemoryLeaseStore } from "../src/lease/memory.ts";
import { STANDBY_MESSAGE } from "../src/server.ts";
import type { ServerOptions } from "../src/server.ts";
import {
  AutoPlayer,
  TestClient,
  createGame,
  invariantViolations,
  settle,
  sleep,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";

const TIMING = { durationMs: 3000, renewIntervalMs: 200, safetyMarginMs: 1000 };

/** Shared view of both instances: who has the database open, and every write with who did it. */
class Monitor {
  readonly open = new Set<string>();
  readonly violations: string[] = [];
  maxOpen = 0;
  writes = 0;
  probe(name: string): NonNullable<ServerOptions["writerProbe"]> {
    return {
      opened: () => {
        this.open.add(name);
        this.maxOpen = Math.max(this.maxOpen, this.open.size);
        if (this.open.size > 1) this.violations.push(`${name} opened while ${[...this.open]} open`);
      },
      closed: () => {
        this.open.delete(name);
      },
      wrote: () => {
        this.writes++;
        if (!this.open.has(name) || this.open.size !== 1)
          this.violations.push(`${name} wrote while open=${[...this.open].join(",")}`);
      },
    };
  }
}

describe("writer lease handover between two instances (file lease)", () => {
  let dir: string;
  let monitor: Monitor;
  const servers: TestServer[] = [];
  const clients: TestClient[] = [];
  const instance = async (name: string, extra: ServerOptions = {}): Promise<TestServer> => {
    const ts = await startTestServer(
      {
        writerLease: new FileLease(dir, { timing: TIMING, pollMs: 20 }),
        leaseRejoinDelayMs: 1500,
        writerProbe: monitor.probe(name),
        ...extra,
      },
      dir,
    );
    servers.push(ts);
    return ts;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "poly-handover-"));
    monitor = new Monitor();
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    for (const s of servers.splice(0)) await s.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("hands a running game over to the new instance and back, without losing state or ever writing twice", async () => {
    const a = await instance("A");
    const t = await startedTable(a, { bots: ["normal"] });
    clients.push(t.a, t.b);
    const pa = new AutoPlayer(t.a, t.host.playerId, 1, { maxVersion: 60 });
    const pb = new AutoPlayer(t.b, t.friend.playerId, 2, { maxVersion: 60 });
    await t.a.untilState((s) => s.version >= 15, 10_000);

    // the new instance starts while the game is being played: it asks A to hand over
    const b = await instance("B", { waitUntilActive: false });
    expect((await fetch(`${b.base}/api/themes`)).status).toBe(200); // liveness in standby
    await b.srv.whenActive();
    expect(await t.a.untilClosed(5000)).toBe(WS_CLOSE_HANDOVER);
    expect(await t.b.untilClosed(5000)).toBe(WS_CLOSE_HANDOVER);
    pa.paused = pb.paused = true;
    const lastSeen = Math.max(t.a.state?.version ?? 0, t.b.state?.version ?? 0);

    // A is a standby candidate now: health yes, readiness and API no, with Retry-After
    expect((await fetch(`${a.base}/api/themes`)).status).toBe(200);
    expect((await fetch(`${a.base}/api/ready`)).status).toBe(503);
    const refused = await fetch(`${a.base}/api/games/${t.host.gameId}`);
    expect(refused.status).toBe(503);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({ error: STANDBY_MESSAGE, standby: true });
    const late = await TestClient.open(a.wsUrl);
    expect(await late.untilClosed(3000)).toBe(WS_CLOSE_HANDOVER);
    expect((await fetch(`${b.base}/api/ready`)).status).toBe(200);

    // the players reconnect to B: same game, nothing lost, and play goes on
    const a2 = await TestClient.join(b, t.host);
    const b2 = await TestClient.join(b, t.friend);
    clients.push(a2, b2);
    // nothing lost: B continues from at least what the players last saw on A (B's bot may already have moved on)
    expect(a2.state?.version ?? 0).toBeGreaterThanOrEqual(lastSeen);
    new AutoPlayer(a2, t.host.playerId, 3, { maxVersion: lastSeen + 25 });
    new AutoPlayer(b2, t.friend.playerId, 4, { maxVersion: lastSeen + 25 });
    await a2.untilState((s) => s.version >= lastSeen + 10, 10_000);
    await settle([a2, b2]);
    const onB = a2.state?.version ?? 0;
    expect(invariantViolations(a2.state ?? (null as never))).toEqual([]);

    // B goes away (graceful stop releases the lease): the candidate A takes over again
    await b.stop();
    await a.srv.whenActive();
    const a3 = await TestClient.join(a, t.host);
    clients.push(a3);
    expect(a3.state?.version ?? 0).toBeGreaterThanOrEqual(onB);

    expect(monitor.violations).toEqual([]);
    expect(monitor.maxOpen).toBe(1);
    expect(monitor.writes).toBeGreaterThan(20);
  }, 30_000);

  it("on-traffic (DESIGN #91): the new instance waits ready-for-the-platform in standby and takes over on its first real request; the former holder never breaks", async () => {
    // a fresh instance takes a free lease without any request
    const a = await instance("A", { leaseHandover: "on-traffic" });
    expect(a.srv.writerState()).toBe("active");
    const t = await startedTable(a, { bots: ["normal"] });
    clients.push(t.a, t.b);
    const pa = new AutoPlayer(t.a, t.host.playerId, 1, { maxVersion: 40 });
    const pb = new AutoPlayer(t.b, t.friend.playerId, 2, { maxVersion: 40 });
    await t.a.untilState((s) => s.version >= 10, 10_000);

    const b = await instance("B", { waitUntilActive: false, leaseHandover: "on-traffic" });
    // platform probes and the deploy script's checks: B is up (standby), never asks A to hand over
    const probe = { headers: { "user-agent": "kube-probe/1.31" } };
    for (let i = 0; i < 5; i++) {
      expect((await fetch(`${b.base}/api/themes`, probe)).status).toBe(200);
      const live = await fetch(`${b.base}/api/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ state: "acquiring" });
      expect((await fetch(`${b.base}/api/ready`)).status).toBe(503);
      expect((await fetch(`${b.base}/api/ready`, { method: "HEAD" })).status).toBe(503);
      await sleep(200); // a few renewal intervals (200 ms) of A
    }
    expect(b.srv.writerState()).toBe("acquiring");
    expect(a.srv.writerState()).toBe("active");
    expect(t.a.closeCode).toBeNull();

    // the first real request (the deploy script's GET / after the traffic shift) starts the handover
    const first = await fetch(`${b.base}/`);
    expect([200, 404]).toContain(first.status);
    await b.srv.whenActive();
    expect(await t.a.untilClosed(5000)).toBe(WS_CLOSE_HANDOVER);
    pa.paused = pb.paused = true;
    expect((await fetch(`${b.base}/api/ready`)).status).toBe(200);
    expect((await fetch(`${a.base}/api/live`)).status).toBe(200); // the former holder: up, in standby

    // A keeps getting requests (stale clients) long past its rejoin delay (1.5 s): it must never take the lease back
    for (let i = 0; i < 10; i++) {
      expect((await fetch(`${a.base}/api/games/${t.host.gameId}`)).status).toBe(503);
      const late = await TestClient.open(a.wsUrl);
      expect(await late.untilClosed(3000)).toBe(WS_CLOSE_HANDOVER);
      await sleep(250);
    }
    expect(b.srv.writerState()).toBe("active");
    expect(a.srv.writerState()).toBe("acquiring");
    const again = await TestClient.join(b, t.host);
    clients.push(again);
    expect(monitor.violations).toEqual([]);
    expect(monitor.maxOpen).toBe(1);
  }, 30_000);

  it("a new instance that cannot write (DESIGN #94) never becomes ready: the former holder takes the lease back and keeps serving, nothing lost", async () => {
    const a = await instance("A");
    const t = await startedTable(a, { bots: ["normal"] });
    clients.push(t.a, t.b);
    const pa = new AutoPlayer(t.a, t.host.playerId, 1, { maxVersion: 40 });
    const pb = new AutoPlayer(t.b, t.friend.playerId, 2, { maxVersion: 40 });
    await t.a.untilState((s) => s.version >= 10, 10_000);

    // B's mount reads but refuses every write (seen live with the managed-identity mount)
    const b = await instance("B", {
      waitUntilActive: false,
      dbWriteFault: () => {
        throw Object.assign(new Error("attempt to write a readonly database"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1544,
        });
      },
    });
    expect(await t.a.untilClosed(5000)).toBe(WS_CLOSE_HANDOVER); // A handed over to B
    pa.paused = pb.paused = true;
    const lastSeen = Math.max(t.a.state?.version ?? 0, t.b.state?.version ?? 0);
    // B fails its self-test, gives the lease back and steps aside (2 x 1.5 s); A rejoins after 1.5 s
    const back = a.srv.whenActive();
    let aBack = false;
    void back.then(() => (aBack = true));
    while (!aBack) {
      expect((await fetch(`${b.base}/api/ready`)).status).toBe(503);
      await sleep(50);
    }
    expect((await fetch(`${a.base}/api/ready`)).status).toBe(200);

    // the players come back to A: same game, nothing lost, and play goes on
    const a2 = await TestClient.join(a, t.host);
    const b2 = await TestClient.join(a, t.friend);
    clients.push(a2, b2);
    expect(a2.state?.version ?? 0).toBeGreaterThanOrEqual(lastSeen);
    new AutoPlayer(a2, t.host.playerId, 3, { maxVersion: lastSeen + 20 });
    new AutoPlayer(b2, t.friend.playerId, 4, { maxVersion: lastSeen + 20 });
    await a2.untilState((s) => s.version >= lastSeen + 10, 10_000);
    await settle([a2, b2]);
    expect(invariantViolations(a2.state ?? (null as never))).toEqual([]);

    // B stays a candidate that never breaks A's lease again, and never reports ready
    await sleep(3500);
    expect(a.srv.writerState()).toBe("active");
    expect(b.srv.writerState()).toBe("acquiring");
    expect((await fetch(`${b.base}/api/ready`)).status).toBe(503);
    expect(monitor.violations).toEqual([]);
    expect(monitor.maxOpen).toBe(1);
  }, 30_000);

  it("on-traffic: a WebSocket upgrade is a real request, too", async () => {
    const a = await instance("A", { leaseHandover: "on-traffic" });
    const b = await instance("B", { waitUntilActive: false, leaseHandover: "on-traffic" });
    await sleep(600);
    expect(b.srv.writerState()).toBe("acquiring");
    const ws = await TestClient.open(b.wsUrl);
    expect(await ws.untilClosed(3000)).toBe(WS_CLOSE_HANDOVER); // standby answer, but the handover has started
    await b.srv.whenActive();
    expect(a.srv.writerState()).not.toBe("active");
    expect(monitor.violations).toEqual([]);
  }, 15_000);
});

describe("standby and a lost lease (in-memory lease)", () => {
  const servers: TestServer[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await s.dispose();
  });

  it("while another process holds the lease: static/health only, API 503 + Retry-After, WS closed with 4503", async () => {
    const store = new MemoryLeaseStore();
    store.tryAcquire("other-process");
    const ts = await startTestServer({
      writerLease: new MemoryLease(store),
      waitUntilActive: false,
    });
    servers.push(ts);
    expect(ts.srv.writerState()).toBe("acquiring");
    expect((await fetch(`${ts.base}/api/themes`)).status).toBe(200);
    const ready = await fetch(`${ts.base}/api/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ state: "acquiring" });
    const create = await fetch(`${ts.base}/api/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(create.status).toBe(503);
    expect(create.headers.get("retry-after")).toBe("2");
    const ws = await TestClient.open(ts.wsUrl);
    expect(await ws.untilClosed(3000)).toBe(WS_CLOSE_HANDOVER);
  });

  it("a lost lease stops all writes at once, sends clients away with 4503 and comes back when the lease is back", async () => {
    const store = new MemoryLeaseStore();
    const lease = new MemoryLease(
      store,
      { durationMs: 3000, renewIntervalMs: 200, safetyMarginMs: 1000 },
      20,
    );
    const monitor = new Monitor();
    const ts = await startTestServer({
      writerLease: lease,
      writerProbe: monitor.probe("A"),
      leaseRetryDelayMs: 200,
      runWithoutHumans: true,
    });
    servers.push(ts);
    const host = await createGame(ts, { bots: ["easy", "easy"], maxPlayers: 3 });
    const c = await TestClient.join(ts, host);
    expect((await ts.api("POST", `/api/games/${host.gameId}/start`, {}, host.token)).status).toBe(
      200,
    );
    const player = new AutoPlayer(c, host.playerId, 7);
    await c.untilState((s) => s.version >= 5, 10_000);
    lease.renewBehaviour = "fail";
    expect(await c.untilClosed(3000)).toBe(WS_CLOSE_HANDOVER);
    const writesAtLoss = monitor.writes;
    expect(monitor.open.size).toBe(0);
    player.paused = true;
    await sleep(500); // bots would have played on: nothing may be written now
    expect(monitor.writes).toBe(writesAtLoss);
    expect((await fetch(`${ts.base}/api/ready`)).status).toBe(503);
    lease.renewBehaviour = "normal";
    await ts.srv.whenActive();
    expect((await fetch(`${ts.base}/api/ready`)).status).toBe(200);
    const again = await TestClient.join(ts, host);
    expect(again.state?.version).toBeGreaterThanOrEqual(5);
    await again.close();
    expect(monitor.violations).toEqual([]);
  });
});
