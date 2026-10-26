// Data retention (docs/DESIGN.md #57): expiry by status measured from the last HUMAN activity, action log trimming,
// the sweep (one transaction, optional VACUUM) and what the room/socket layer does when a game is deleted.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, WS_CLOSE_GAME_EXPIRED } from "@poly/engine";
import type { StoredLobby } from "@poly/engine";
import { Db } from "../src/db.ts";
import { DAY_MS, DEFAULT_RETENTION, loadRetention } from "../src/retention.ts";
import {
  TestClient,
  createGame,
  joinGame,
  sleep,
  startGame,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const policy = {
  lobbyMs: 2 * DAY_MS,
  finishedMs: 30 * DAY_MS,
  runningMs: 60 * DAY_MS,
};

const lobbyOf = (gameId: string, status: StoredLobby["status"]): StoredLobby => ({
  gameId,
  inviteCode: "ABCDEF",
  status,
  settings: DEFAULT_SETTINGS,
  seats: [],
  maxPlayers: 4,
  createdAt: NOW,
  chat: { mode: "free", muted: [] },
});

const dirs: string[] = [];
const dbs: Db[] = [];
const servers: TestServer[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "poly-ret-"));
  dirs.push(d);
  return d;
}
function openDb(dir = ":memory:", opts: ConstructorParameters<typeof Db>[1] = {}): Db {
  const db = new Db(dir, { log: () => {}, ...opts });
  dbs.push(db);
  return db;
}
async function server(opts: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const ts = await startTestServer(opts);
  servers.push(ts);
  return ts;
}
afterEach(async () => {
  for (const ts of servers.splice(0)) await ts.dispose();
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadRetention (env)", () => {
  it("defaults: lobby 2 days, finished 30 days, running 60 days, keep 2000 actions", () => {
    expect(loadRetention({})).toEqual({
      lobbyDays: 2,
      finishedDays: 30,
      runningDays: 60,
      actionLogKeep: 2000,
    });
    expect(DEFAULT_RETENTION.actionLogKeep).toBe(2000);
  });

  it("reads positive integers and treats empty values as unset", () => {
    expect(
      loadRetention({
        GAME_TTL_LOBBY_DAYS: "1",
        GAME_TTL_FINISHED_DAYS: "7",
        GAME_TTL_RUNNING_DAYS: "",
        ACTION_LOG_KEEP: "50",
      }),
    ).toEqual({ lobbyDays: 1, finishedDays: 7, runningDays: 60, actionLogKeep: 50 });
  });

  it.each(["0", "-3", "1.5", "abc", "99999999999"])("refuses %s (startup abort)", (bad) => {
    expect(() => loadRetention({ GAME_TTL_LOBBY_DAYS: bad })).toThrow();
    expect(() => loadRetention({ ACTION_LOG_KEEP: bad })).toThrow();
  });
});

describe("expiry by status, measured from the last human activity", () => {
  it.each([
    ["lobby", 2 * DAY_MS],
    ["finished", 30 * DAY_MS],
    ["running", 60 * DAY_MS],
  ] as const)("%s: kept up to the limit, expired one millisecond after it", (status, ttl) => {
    const db = openDb();
    db.save(lobbyOf("inside", status), null, NOW - ttl);
    db.save(lobbyOf("outside", status), null, NOW - ttl - 1);
    expect(db.expiredGames(policy, NOW)).toEqual([{ id: "outside", status }]);
  });

  it("each status uses its own limit", () => {
    const db = openDb();
    db.save(lobbyOf("l", "lobby"), null, NOW - 3 * DAY_MS);
    db.save(lobbyOf("f", "finished"), null, NOW - 3 * DAY_MS);
    db.save(lobbyOf("r", "running"), null, NOW - 3 * DAY_MS);
    expect(db.expiredGames(policy, NOW).map((g) => g.id)).toEqual(["l"]);
  });

  it("a save without activity (bots, timers) does not move last_activity_at, but updated_at", () => {
    const db = openDb();
    db.save(lobbyOf("g", "running"), null, NOW - 61 * DAY_MS);
    db.save(lobbyOf("g", "running"), null); // bot move
    expect(db.lastActivity("g")).toBe(NOW - 61 * DAY_MS);
    expect(db.expiredGames(policy, NOW).map((g) => g.id)).toEqual(["g"]);
    db.save(lobbyOf("g", "running"), null, NOW - DAY_MS); // human action
    expect(db.lastActivity("g")).toBe(NOW - DAY_MS);
    expect(db.expiredGames(policy, NOW)).toEqual([]);
  });

  it("touchActivity (a seated human connects) revives a game", () => {
    const db = openDb();
    db.save(lobbyOf("g", "lobby"), null, NOW - 5 * DAY_MS);
    db.touchActivity("g", NOW);
    expect(db.expiredGames(policy, NOW)).toEqual([]);
  });
});

describe("purge: delete expired games and trim the action log in ONE transaction", () => {
  function fill(db: Db, gameId: string, n: number): void {
    for (let v = 1; v <= n; v++) db.logAction(gameId, v, "p1", { type: "roll" }, NOW + v);
  }
  function actionVersions(db: Db, gameId: string): number[] {
    return db.actionVersions(gameId);
  }

  it("deletes the game and all of its actions, leaves other games alone", () => {
    const db = openDb();
    db.save(lobbyOf("old", "lobby"), null, NOW - 9 * DAY_MS);
    db.save(lobbyOf("new", "lobby"), null, NOW);
    fill(db, "old", 3);
    fill(db, "new", 4);
    const r = db.purge(["old"], 2000);
    expect(r).toEqual({ games: 1, expiredActions: 3, trimmedActions: 0 });
    expect(db.exists("old")).toBe(false);
    expect(db.load("old")).toBeNull();
    expect(db.exists("new")).toBe(true);
    expect(actionVersions(db, "old")).toEqual([]);
    expect(actionVersions(db, "new")).toEqual([1, 2, 3, 4]);
  });

  it("keeps only the newest N actions per game", () => {
    const db = openDb();
    db.save(lobbyOf("a", "running"), null);
    db.save(lobbyOf("b", "running"), null);
    fill(db, "a", 2500);
    fill(db, "b", 10);
    const r = db.purge([], 2000);
    expect(r).toEqual({ games: 0, expiredActions: 0, trimmedActions: 500 });
    const kept = actionVersions(db, "a");
    expect(kept).toHaveLength(2000);
    expect(kept[0]).toBe(501);
    expect(kept.at(-1)).toBe(2500);
    expect(actionVersions(db, "b")).toHaveLength(10);
    expect(db.purge([], 2000).trimmedActions).toBe(0); // idempotent
  });

  it("a game that was trimmed still loads (snapshot, no replay)", () => {
    const db = openDb();
    db.save(lobbyOf("a", "running"), null);
    fill(db, "a", 30);
    db.purge([], 5);
    expect(db.load("a")?.lobby.gameId).toBe("a");
  });

  it("is atomic: when deleting the game fails, its actions are still there", () => {
    const dir = tmp();
    const db = openDb(dir, { journalMode: "delete" });
    db.save(lobbyOf("old", "lobby"), null, NOW - 9 * DAY_MS);
    fill(db, "old", 3);
    const raw = new DatabaseSync(join(dir, "games.sqlite"));
    raw.exec(
      "CREATE TRIGGER no_delete BEFORE DELETE ON games BEGIN SELECT RAISE(ABORT, 'nope'); END",
    );
    raw.close();
    expect(() => db.purge(["old"], 2000)).toThrow(/nope/);
    expect(db.exists("old")).toBe(true);
    expect(actionVersions(db, "old")).toEqual([1, 2, 3]);
    // the connection is usable afterwards (no dangling transaction)
    db.save(lobbyOf("x", "lobby"), null);
    expect(db.exists("x")).toBe(true);
  });
});

describe("VACUUM only when it pays off", () => {
  function bulk(db: Db, gameId: string, n: number): void {
    const big = { type: "note", pad: "x".repeat(2000) };
    for (let v = 1; v <= n; v++) db.logAction(gameId, v, "p1", big, v);
  }

  it("shrinks the file when enough space is free, and does nothing below the threshold", () => {
    const dir = tmp();
    const file = join(dir, "games.sqlite");
    const db = openDb(dir, { journalMode: "delete", vacuumMinFreeBytes: 100_000 });
    db.save(lobbyOf("g", "running"), null);
    bulk(db, "g", 200); // ~400 kB
    const full = statSync(file).size;
    expect(db.vacuumIfWorthIt()).toBe(false); // nothing free yet
    db.purge([], 180); // frees ~40 kB: below the threshold
    expect(db.vacuumIfWorthIt()).toBe(false);
    expect(statSync(file).size).toBe(full);
    db.purge([], 20); // frees ~360 kB in total
    expect(db.freeBytes()).toBeGreaterThanOrEqual(100_000);
    expect(db.vacuumIfWorthIt()).toBe(true);
    expect(statSync(file).size).toBeLessThan(full / 2);
    expect(db.freeBytes()).toBe(0);
    expect(db.exists("g")).toBe(true);
  });
});

describe("migration 3: last_activity_at", () => {
  it("is added with updated_at as value for existing rows and is part of a fresh schema", () => {
    const db = openDb();
    db.save(lobbyOf("g", "lobby"), null, 123_456);
    expect(db.lastActivity("g")).toBe(123_456);
    expect(db.lastActivity("nope")).toBeNull();
  });
});

describe("Hub: sweep of a live server", () => {
  it("expires a lobby: room unloaded, sockets closed with the expiry code, API says 404, actions gone", async () => {
    const ts = await server();
    const host = await createGame(ts);
    const c = await TestClient.join(ts, host);
    const hub = ts.srv.hub;
    const db = hub.db;
    db.logAction(host.gameId, 1, "p1", { type: "note" }, NOW);
    expect(hub.size).toBe(1);

    // not yet: 1 day 23 h of inactivity
    db.touchActivity(host.gameId, Date.now() - (2 * DAY_MS - 3_600_000));
    expect(hub.runRetention().expired).toEqual([]);
    expect(c.ws.readyState).toBe(1);

    db.touchActivity(host.gameId, Date.now() - 2 * DAY_MS - 1000);
    const report = hub.runRetention();
    expect(report.expired).toEqual([{ id: host.gameId, status: "lobby" }]);
    expect(await c.untilClosed()).toBe(WS_CLOSE_GAME_EXPIRED);
    expect(c.closeReason).toBe("game expired");
    expect(hub.size).toBe(0);
    expect(db.exists(host.gameId)).toBe(false);
    expect(db.actionVersions(host.gameId)).toEqual([]);
    const r = await ts.api("GET", `/api/games/${host.gameId}`);
    expect(r.status).toBe(404);
    const again = await TestClient.connect(ts, host.gameId, host.token);
    const err = await again.until((m) => m.t === "error");
    expect(err.t === "error" && err.message).toBe("Spiel nicht gefunden.");
    expect(db.exists(host.gameId)).toBe(false); // nothing resurrected it
  });

  it("an expired room that still has queued work cannot write the game back", async () => {
    const ts = await server();
    const host = await createGame(ts);
    const room = ts.srv.hub.get(host.gameId)!;
    ts.srv.hub.db.touchActivity(host.gameId, Date.now() - 3 * DAY_MS);
    ts.srv.hub.runRetention();
    room.persist();
    expect(ts.srv.hub.db.exists(host.gameId)).toBe(false);
  });

  it("the limits come from the configuration", async () => {
    const ts = await server({
      retention: { ...DEFAULT_RETENTION, finishedDays: 1, runningDays: 3 },
    });
    const t = await startedTable(ts, { bots: [] });
    const { db } = ts.srv.hub;
    db.touchActivity(t.host.gameId, Date.now() - 2 * DAY_MS);
    expect(ts.srv.hub.runRetention().expired).toEqual([]);
    db.touchActivity(t.host.gameId, Date.now() - 4 * DAY_MS);
    expect(ts.srv.hub.runRetention().expired).toEqual([{ id: t.host.gameId, status: "running" }]);
    expect(await t.a.untilClosed()).toBe(WS_CLOSE_GAME_EXPIRED);
  });

  it("human actions count, turn timeouts and bot moves do not", async () => {
    const ts = await server({ botDelayMs: 0 });
    const host = await createGame(ts, {
      host: "Anna",
      bots: ["normal"],
      maxPlayers: 2,
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 9 },
    });
    const a = await TestClient.join(ts, host);
    const { db } = ts.srv.hub;
    await startGame(ts, host);
    const started = db.lastActivity(host.gameId)!;
    const updatedAt = (): number => {
      const raw = new DatabaseSync(join(ts.dir, "games.sqlite"), { readOnly: true });
      const row = raw.prepare("SELECT updated_at AS u FROM games WHERE id = ?").get(host.gameId);
      raw.close();
      return Number((row as { u: number }).u);
    };
    const u0 = updatedAt();
    // the human misses the turn: the server (timer) and the bot keep playing and persisting
    await a.untilState((s) => s.players[0]!.missedTurns >= 1, 6000);
    await sleep(50);
    expect(updatedAt()).toBeGreaterThan(u0);
    expect(db.lastActivity(host.gameId)).toBe(started);
    // a human action does
    await sleep(5);
    a.act({
      type: "propose-trade",
      offer: {
        to: "p2",
        giveCash: 1,
        giveTiles: [],
        giveJailCards: 0,
        wantCash: 0,
        wantTiles: [],
        wantJailCards: 0,
      },
    });
    await a.until((m) => m.t === "update" && m.state.trades.length > 0, 3000);
    expect(db.lastActivity(host.gameId)).toBeGreaterThan(started);
    await a.close();
  }, 20_000);

  it("lobby changes (join, bot, settings, kick) and a seated hello count as activity", async () => {
    const ts = await server();
    const { db } = ts.srv.hub;
    const host = await createGame(ts, { maxPlayers: 4 });
    const old = Date.now() - 1.5 * DAY_MS;
    const age = (): void => db.touchActivity(host.gameId, old);

    age();
    await joinGame(ts, host, "Ben");
    expect(db.lastActivity(host.gameId)!).toBeGreaterThan(old + DAY_MS);
    age();
    await ts.api("POST", `/api/games/${host.gameId}/bots`, { botLevel: "easy" }, host.token);
    expect(db.lastActivity(host.gameId)!).toBeGreaterThan(old + DAY_MS);
    age();
    await ts.api("PATCH", `/api/games/${host.gameId}/settings`, { startingCash: 1700 }, host.token);
    expect(db.lastActivity(host.gameId)!).toBeGreaterThan(old + DAY_MS);
    age();
    const spectator = await TestClient.join(ts, { gameId: host.gameId, token: null });
    expect(db.lastActivity(host.gameId)).toBe(old); // a spectator is not a player
    await spectator.close();
    const seated = await TestClient.join(ts, host);
    await sleep(20);
    expect(db.lastActivity(host.gameId)!).toBeGreaterThan(old + DAY_MS);
    await seated.close();
  });

  it("a trimmed game keeps loading and playing, also after a restart", async () => {
    const ts = await server({ retention: { ...DEFAULT_RETENTION, actionLogKeep: 5 } });
    const t = await startedTable(ts, { bots: [] });
    const { db } = ts.srv.hub;
    for (let v = 1000; v < 1030; v++) db.logAction(t.host.gameId, v, "p1", { type: "note" }, v);
    const r = ts.srv.hub.runRetention();
    expect(r.trimmedActions).toBeGreaterThan(20);
    expect(db.actionVersions(t.host.gameId)).toHaveLength(5);
    await t.a.close();
    await t.b.close();
    await ts.restart();
    const a = await TestClient.join(ts, t.host);
    const s = await a.untilState(() => true);
    expect(s.status).toBe("running");
    const before = s.version;
    const me = s.players[s.current]!.id;
    const cur = me === t.host.playerId ? a : await TestClient.join(ts, t.friend);
    cur.act({ type: "roll" });
    await cur.untilState((x) => x.version > before, 3000);
    await a.close();
    await cur.close();
  });

  it("sweeps on startup (before games resume), hourly afterwards, and stops on shutdown", async () => {
    const dir = tmp();
    const first = await startTestServer({}, dir);
    const host = await createGame(first);
    first.srv.hub.db.touchActivity(host.gameId, Date.now() - 3 * DAY_MS);
    await first.stop();

    let now = Date.now();
    const ts = await startTestServer({ retentionIntervalMs: 15, clock: () => now }, dir);
    servers.push(ts);
    expect(ts.srv.hub.db.exists(host.gameId)).toBe(false); // gone before the first request

    // a game that becomes inactive while the server runs is picked up by the timer
    const g = await createGame(ts);
    expect(ts.srv.hub.db.exists(g.gameId)).toBe(true);
    now += 3 * DAY_MS;
    await sleep(80);
    expect(ts.srv.hub.db.exists(g.gameId)).toBe(false);

    let sweeps = 0;
    const original = ts.srv.hub.runRetention.bind(ts.srv.hub);
    ts.srv.hub.runRetention = () => {
      sweeps++;
      return original();
    };
    await ts.stop();
    await sleep(60);
    expect(sweeps).toBe(0);
  });
});
