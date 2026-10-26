import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";
import type { RunningServer } from "../src/server.ts";
import { Db } from "../src/db.ts";
import { solvedPowHeaders } from "./harness.ts";
import { safeEqualHex, sha256 } from "../src/rooms.ts";
import type { JoinResponse } from "@poly/engine";

const JSON_HEADERS = { "content-type": "application/json" };
let srv: RunningServer;
let base: string;
let dir: string;
let staticDir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "poly-sec-"));
  staticDir = join(dir, "public");
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<h1>index</h1>");
  writeFileSync(join(dir, "secret.txt"), "TOP-SECRET");
  symlinkSync(join(dir, "secret.txt"), join(staticDir, "assets", "link.txt"));
  srv = await startServer({
    pow: { difficulty: 16 },
    port: 0,
    dataDir: join(dir, "data"),
    botDelayMs: 0,
    host: "127.0.0.1",
    staticDir,
    idleMs: 50,
    sweepMs: 1_000_000,
    wsRate: { burst: 5, perSec: 0.001 },
  });
  base = `http://127.0.0.1:${srv.port}`;
});
afterAll(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

/** raw request so that the client does not normalise `..` segments away */
function raw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const r = request({ host: "127.0.0.1", port: srv.port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    r.on("error", fail);
    r.end();
  });
}

describe("static file serving", () => {
  it("serves files and falls back to index.html", async () => {
    expect((await raw("/")).body).toContain("index");
    expect((await raw("/some/spa/route")).body).toContain("index");
  });
  it.each([
    "/../secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e/secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e%2f%2e%2e%2fetc/passwd",
    "/a%00b",
  ])("does not leak files outside the root (%s)", async (p) => {
    const r = await raw(p);
    expect(r.body).not.toContain("TOP-SECRET");
    expect(r.body).not.toContain("root:");
  });
  it("does not follow symlinks that leave the root", async () => {
    const r = await raw("/assets/link.txt");
    expect(r.body).not.toContain("TOP-SECRET");
  });
});

async function createGame(): Promise<JoinResponse> {
  const r = await fetch(`${base}/api/games`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await solvedPowHeaders(base)) },
    body: JSON.stringify({ hostName: "Host", settings: {}, bots: [], maxPlayers: 4 }),
  });
  return (await r.json()) as JoinResponse;
}
const open = (ws: WebSocket) => new Promise<void>((ok) => ws.once("open", () => ok()));
const closed = (ws: WebSocket) => new Promise<number>((ok) => ws.once("close", (code) => ok(code)));

describe("websocket limits", () => {
  it("closes the socket on oversized messages (1009)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await open(ws);
    const c = closed(ws);
    ws.send("x".repeat(100 * 1024));
    expect(await c).toBe(1009);
  });
  it("rate-limits messages per socket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const msgs: string[] = [];
    ws.on("message", (d) => msgs.push(d.toString()));
    await open(ws);
    for (let i = 0; i < 12; i++) ws.send('{"t":"ping"}');
    await new Promise((r) => setTimeout(r, 200));
    expect(msgs.filter((m) => m.includes("pong")).length).toBe(5);
    expect(msgs.some((m) => m.includes("Zu viele Nachrichten"))).toBe(true);
    ws.close();
  });
  it("rejects malformed REST ids and bodies", async () => {
    expect((await fetch(`${base}/api/games/${"a".repeat(100)}`)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/games`, { method: "POST", headers: JSON_HEADERS, body: "{nope" }))
        .status,
    ).toBe(400);
    expect((await fetch(`${base}/api/games`, { method: "POST", body: "{}" })).status).toBe(415);
    expect(
      (
        await fetch(`${base}/api/games`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: "x".repeat(70 * 1024),
        })
      ).status,
    ).toBe(413);
  });
});

describe("invite code throttling", () => {
  it("returns 429 after repeated wrong codes", async () => {
    const g = await createGame();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${base}/api/games/${g.gameId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Eve", inviteCode: "WRONG1" }),
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe("room unloading", () => {
  it("unloads idle rooms without sockets and reloads them from the DB", async () => {
    const g = await createGame();
    expect(srv.hub.size).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 80));
    srv.hub.sweep(50);
    expect(srv.hub.get(g.gameId)).not.toBeNull(); // reloaded transparently
    const info = await (await fetch(`${base}/api/games/${g.gameId}`)).json();
    expect(info.seats).toHaveLength(1);
  });
});

describe("room unloading vs in-flight requests", () => {
  it("does not dispose a room that an HTTP handler is still using (idle sweep race)", async () => {
    const g = await createGame();
    const payload = JSON.stringify({ name: "Slow", inviteCode: g.inviteCode });
    const before = srv.hub.get(g.gameId);
    // headers first, body later: the handler already holds the room while it awaits the body
    const done = new Promise<number>((ok, fail) => {
      const r = request(
        {
          host: "127.0.0.1",
          port: srv.port,
          path: `/api/games/${g.gameId}/join`,
          method: "POST",
          headers: { "content-type": "application/json", "content-length": payload.length },
        },
        (res) => {
          res.resume();
          res.on("end", () => ok(res.statusCode ?? 0));
        },
      );
      r.on("error", fail);
      r.write(payload.slice(0, 5));
      setTimeout(() => {
        // sweep with a zero idle threshold while the request is mid-flight
        srv.hub.sweep(0);
        r.end(payload.slice(5));
      }, 100);
    });
    expect(await done).toBe(201);
    const room = srv.hub.get(g.gameId);
    expect(room).toBe(before); // same instance: it was not disposed and reloaded mid-request
    expect(room?.lobby.seats.map((s) => s.name)).toContain("Slow");
    // once the request is finished the room is sweepable again
    await new Promise((r) => setTimeout(r, 5));
    expect(srv.hub.sweep(0)).toBeGreaterThan(0);
  });
});

describe("token comparison and db validation", () => {
  it("safeEqualHex compares digests", () => {
    expect(safeEqualHex(sha256("a"), sha256("a"))).toBe(true);
    expect(safeEqualHex(sha256("a"), sha256("b"))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
    expect(safeEqualHex(sha256("a"), "abcd")).toBe(false);
  });
  it("treats corrupt rows as missing instead of returning unvalidated data", () => {
    const db = new Db(":memory:");
    // @ts-expect-error reach into the private handle to plant a bad row
    db.db
      .prepare(
        "INSERT INTO games (id, invite_code, lobby_json, state_json, status, updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run("bad", "X", '{"gameId":1}', null, "lobby", 0);
    expect(db.load("bad")).toBeNull();
    expect(db.load("missing")).toBeNull();
    db.close();
  });
});
