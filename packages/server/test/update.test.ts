import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBuildId } from "../src/build.ts";
import { TestClient, createGame, joinGame, sleep, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await ts?.dispose();
  ts = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake client dist with the given version.json content (null = no version.json). */
function distWith(versionJson: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "poly-dist-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  if (versionJson !== null) writeFileSync(join(dir, "version.json"), versionJson);
  return dir;
}

function welcomeBuild(c: TestClient): string | undefined {
  const w = c.msgs.find((m) => m.t === "welcome");
  return w?.t === "welcome" ? w.build : undefined;
}

describe("build id", () => {
  it("is read from dist/version.json", () => {
    expect(readBuildId(distWith('{"build":"abc123-1700000000"}'))).toBe("abc123-1700000000");
  });

  it("falls back to 'dev' without a static dir, without version.json or with garbage", () => {
    expect(readBuildId(null)).toBe("dev");
    expect(readBuildId(distWith(null))).toBe("dev");
    expect(readBuildId(distWith("not json"))).toBe("dev");
    expect(readBuildId(distWith('{"build":""}'))).toBe("dev");
    expect(readBuildId(distWith('{"build":42}'))).toBe("dev");
  });

  it("is part of every welcome (default 'dev')", async () => {
    ts = await startTestServer();
    const c = await TestClient.join(ts, await createGame(ts));
    expect(welcomeBuild(c)).toBe("dev");
    await c.close();
  });

  it("is the id of the served client build and changes with a new deploy", async () => {
    ts = await startTestServer({ staticDir: distWith('{"build":"v1"}') });
    const host = await createGame(ts);
    const a = await TestClient.join(ts, host);
    expect(welcomeBuild(a)).toBe("v1");
    await ts.stop();
    await ts.restart({ staticDir: distWith('{"build":"v2"}') });
    const b = await TestClient.join(ts, host);
    expect(welcomeBuild(b)).toBe("v2");
    await b.close();
  });

  it("an explicit option beats version.json (test harness)", async () => {
    ts = await startTestServer({ staticDir: distWith('{"build":"v1"}'), buildId: "forced" });
    const c = await TestClient.join(ts, await createGame(ts));
    expect(welcomeBuild(c)).toBe("forced");
    await c.close();
  });
});

describe("graceful shutdown for a deploy", () => {
  it("persists first, then closes every socket with 1012 'Service Restart'", async () => {
    ts = await startTestServer();
    const host = await createGame(ts);
    const friend = await joinGame(ts, host, "Friend");
    await startGame(ts, host);
    const a = await TestClient.join(ts, host);
    const b = await TestClient.join(ts, friend);
    const spectator = await TestClient.join(ts, { gameId: host.gameId, token: null });

    const log: string[] = [];
    const db = ts.srv.hub.db;
    const save = db.save.bind(db);
    db.save = (...args) => {
      log.push("save");
      save(...args);
    };
    for (const c of [a, b, spectator]) c.ws.on("close", () => log.push("close"));

    await ts.srv.close();
    await Promise.all([a, b, spectator].map((c) => c.untilClosed()));

    for (const c of [a, b, spectator]) {
      expect(c.closeCode).toBe(1012);
      expect(c.closeReason).toBe("Service Restart");
    }
    expect(log.indexOf("save")).toBeGreaterThanOrEqual(0);
    expect(log.lastIndexOf("save")).toBeLessThan(log.indexOf("close"));
    expect(log.filter((e) => e === "close")).toHaveLength(3);
  });

  it("finishes in-flight work first and refuses new actions instead of half-applying them", async () => {
    ts = await startTestServer();
    const host = await createGame(ts, { bots: [], maxPlayers: 2 });
    await joinGame(ts, host, "Friend");
    await startGame(ts, host);
    const a = await TestClient.join(ts, host);
    const room = ts.srv.hub.get(host.gameId)!;
    const versionBefore = room.state!.version;

    let finished = false;
    const inFlight = room.enqueue(async () => {
      await sleep(150);
      finished = true;
    });
    const closing = ts.srv.close();
    await sleep(30); // shutdown has begun, the queue is still busy
    const mark = a.mark();
    a.act({ type: "roll" });
    await a.until((m) => m.t === "error", 2000, mark);

    await closing;
    await inFlight;
    expect(finished).toBe(true);
    expect(await a.untilClosed()).toBe(1012);
    expect(room.state!.version).toBe(versionBefore);
  });

  it("a restart on the same data dir keeps the running game, its deadline and its seats", async () => {
    ts = await startTestServer();
    const host = await createGame(ts, { bots: ["normal"], settings: { turnTimeoutSec: 600 } });
    await startGame(ts, host);
    const a = await TestClient.join(ts, host);
    const before = a.state!;
    expect(before.deadline).not.toBeNull();
    await ts.restart();
    expect(await a.untilClosed()).toBe(1012);
    const b = await TestClient.join(ts, host);
    expect(b.you).toBe(host.playerId);
    expect(b.state!.version).toBeGreaterThanOrEqual(before.version);
    expect(b.state!.deadline).not.toBeNull();
    await b.close();
  });
});
