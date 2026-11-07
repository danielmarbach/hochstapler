// POST /api/games/:id/rematch: a finished game opens one new lobby (same settings and bots) that every seated human of
// the old game can enter with their own new token (docs/DESIGN.md #102).
import { afterEach, describe, expect, it } from "vitest";
import { POW_HEADER, getTheme } from "@poly/engine";
import type { BotLevel, JoinResponse, LobbyInfo } from "@poly/engine";
import { Db } from "../src/db.ts";
import { LeaseFencedError } from "../src/lease/types.ts";
import { sha256 } from "../src/rooms.ts";
import { POW_INVALID_MESSAGE, POW_MISSING_MESSAGE, SERVER_FULL_MESSAGE } from "../src/server.ts";
import {
  TestClient,
  createGame,
  joinGame,
  solvedPowHeaders,
  startGame,
  startTestServer,
} from "./harness.ts";
import type { Seat, TestServer } from "./harness.ts";

let ts: TestServer;
afterEach(async () => {
  await ts.dispose();
});

interface Table {
  host: Seat;
  friend: Seat;
}

/** Anna (host) and Ben at a started game, ended by their vote (the bots agree by themselves). */
async function finishedTable(
  opts: { bots?: BotLevel[]; maxPlayers?: number; host?: string; theme?: string } = {},
): Promise<Table> {
  const bots = opts.bots ?? ["easy", "hard"];
  const host = await createGame(ts, {
    host: opts.host ?? "Anna",
    bots,
    maxPlayers: opts.maxPlayers ?? bots.length + 2,
    settings: { themeId: opts.theme ?? "fr", startingCash: 1700, turnTimeoutSec: 0 },
  });
  const friend = await joinGame(ts, host, "Ben");
  const a = await TestClient.join(ts, host);
  const b = await TestClient.join(ts, friend);
  await startGame(ts, host);
  await a.untilState(() => true);
  a.act({ type: "propose-end-game" });
  await b.untilState((s) => s.endVote !== undefined);
  b.act({ type: "vote-end-game", accept: true });
  await a.untilState((s) => s.status === "finished");
  await Promise.all([a.close(), b.close()]);
  return { host, friend };
}

/** The raw call: only the headers given are sent (a solved proof of work is needed by the call that opens the lobby). */
async function rematchWith(
  seat: Pick<Seat, "gameId">,
  headers: Record<string, string>,
  body: unknown = {},
): Promise<{ status: number; json: JoinResponse }> {
  const r = await fetch(`${ts.base}/api/games/${seat.gameId}/rematch`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as JoinResponse };
}

/** A well-formed call as the client sends it: the player token and a freshly solved proof of work. */
const rematch = async (seat: Pick<Seat, "gameId">, token: string | undefined, body: unknown = {}) =>
  rematchWith(
    seat,
    { ...(token ? { "x-player-token": token } : {}), ...(await solvedPowHeaders(ts.base)) },
    body,
  );

const readonlyError = () =>
  Object.assign(new Error("attempt to write a readonly database"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 1544,
  });

const lobbyOf = async (gameId: string) =>
  (await ts.api<LobbyInfo>("GET", `/api/games/${gameId}`)).json;

describe("rematch (POST /api/games/:id/rematch)", () => {
  it("the first caller opens a new lobby with the same settings and bots and is its host", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const old = await lobbyOf(host.gameId);
    const r = await rematch(host, friend.token);
    expect(r.status).toBe(201);
    expect(r.json.gameId).not.toBe(host.gameId);
    expect(r.json.inviteCode).not.toBe(host.inviteCode);
    expect(r.json.playerToken).not.toBe(friend.token);
    const next = await lobbyOf(r.json.gameId);
    expect(next.status).toBe("lobby");
    expect(next.settings).toEqual(old.settings);
    expect(next.settings.themeId).toBe("fr");
    expect(next.maxPlayers).toBe(old.maxPlayers);
    expect(next.seats.map((s) => [s.kind, s.botLevel, s.isHost])).toEqual([
      ["human", "normal", true],
      ["bot", "easy", false],
      ["bot", "hard", false],
    ]);
    expect(next.seats[0]?.name).toBe("Ben");
    expect(next.seats[0]?.playerId).toBe(r.json.playerId);
    expect(next.seats.map((s) => s.tokenId)).toHaveLength(
      new Set(next.seats.map((s) => s.tokenId)).size,
    );
  }, 20_000);

  it("the old game announces that a rematch exists (the fact only, no ids, no tokens)", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    expect((await lobbyOf(host.gameId)).rematch).toBe(false);
    const watching = await TestClient.join(ts, host);
    expect(watching.lobby?.rematch).toBe(false);
    const m = watching.mark();
    const r = await rematch(host, friend.token);
    const msg = await watching.until((x) => x.t === "lobby" && x.lobby.rematch, 3000, m);
    expect((await lobbyOf(host.gameId)).rematch).toBe(true);
    const wire = JSON.stringify(msg);
    expect(wire).not.toContain(r.json.gameId);
    expect(wire).not.toContain(r.json.playerToken);
    expect(wire).not.toContain(r.json.inviteCode);
    await watching.close();
  }, 20_000);

  it("the second human joins the same lobby with their own new token", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const first = await rematch(friend, friend.token);
    const second = await rematch(host, host.token);
    expect(second.status).toBe(201);
    expect(second.json.gameId).toBe(first.json.gameId);
    expect(second.json.inviteCode).toBe(first.json.inviteCode);
    expect(second.json.playerId).not.toBe(first.json.playerId);
    expect(second.json.playerToken).not.toBe(first.json.playerToken);
    expect(second.json.playerToken).not.toBe(host.token);
    const next = await lobbyOf(first.json.gameId);
    expect(next.seats.filter((s) => s.kind === "human").map((s) => [s.name, s.isHost])).toEqual([
      ["Ben", true],
      ["Anna", false],
    ]);
    const c = await TestClient.join(ts, {
      gameId: second.json.gameId,
      token: second.json.playerToken,
    });
    expect(c.you).toBe(second.json.playerId);
    await c.close();
  }, 20_000);

  it("keeps the previous game piece when it is free and honours a wished one", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable({ bots: [] });
    const old = await lobbyOf(host.gameId);
    const pieceOf = (lobby: LobbyInfo, name: string) =>
      lobby.seats.find((s) => s.name === name)?.tokenId;
    const wished = getTheme("fr").tokens.find(
      (t) => !old.seats.some((s) => s.tokenId === t.id),
    )?.id;
    expect(wished).toBeDefined();
    const first = await rematch(friend, friend.token);
    const second = await rematch(host, host.token, { tokenId: wished });
    expect(second.status).toBe(201);
    const next = await lobbyOf(first.json.gameId);
    expect(pieceOf(next, "Ben")).toBe(pieceOf(old, "Ben"));
    expect(pieceOf(next, "Anna")).toBe(wished);
  }, 20_000);

  it("a repeat call by a seated human is refused and mints no second seat or token", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const first = await rematch(friend, friend.token);
    const again = await rematch(friend, friend.token);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.json)).not.toContain(first.json.playerToken);
    const joined = await rematch(host, host.token);
    const joinedAgain = await rematch(host, host.token);
    expect(joinedAgain.status).toBe(409);
    expect(JSON.stringify(joinedAgain.json)).not.toContain(joined.json.playerToken);
    expect((await lobbyOf(first.json.gameId)).seats).toHaveLength(4);
  }, 20_000);

  it("two simultaneous calls open exactly one lobby", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const [a, b] = await Promise.all([rematch(host, host.token), rematch(friend, friend.token)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.json.gameId).toBe(b.json.gameId);
    expect(a.json.playerId).not.toBe(b.json.playerId);
    const next = await lobbyOf(a.json.gameId);
    expect(next.seats.filter((s) => s.kind === "human")).toHaveLength(2);
  }, 20_000);

  it("refuses a game that has not finished", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const lobby = await createGame(ts, { host: "Anna", bots: ["easy"] });
    expect((await rematch(lobby, lobby.token)).status).toBe(409);
    await startGame(ts, lobby);
    expect((await rematch(lobby, lobby.token)).status).toBe(409);
    expect((await lobbyOf(lobby.gameId)).rematch).toBe(false);
  });

  it("needs a seated human's own token", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host } = await finishedTable();
    const other = await finishedTable();
    expect((await rematch(host, undefined)).status).toBe(403);
    expect((await rematch(host, "nope")).status).toBe(403);
    // a bot's stored hash is empty: the empty token must never authenticate
    expect((await rematch(host, "")).status).toBe(403);
    // the token of another game
    expect((await rematch(host, other.host.token)).status).toBe(403);
    expect((await lobbyOf(host.gameId)).rematch).toBe(false);
  }, 30_000);

  it("rejects wrong methods, malformed bodies and unknown games", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const path = `/api/games/${host.gameId}/rematch`;
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const r = await fetch(ts.base + path, { method, headers: { "x-player-token": host.token } });
      expect(r.status, method).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
    for (const body of [{ tokenId: 5 }, { tokenId: "" }, { tokenId: "x".repeat(33) }, { a: 1 }]) {
      expect((await rematch(host, host.token, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await rematch(host, host.token, { tokenId: "no-such-piece" })).status).toBe(400);
    expect((await ts.api("POST", "/api/games/zzzzzzzz/rematch", {}, host.token)).status).toBe(404);
    const text = await fetch(ts.base + path, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-player-token": friend.token },
      body: "{}",
    });
    expect(text.status).toBe(415);
    const big = await fetch(ts.base + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-player-token": friend.token },
      body: JSON.stringify({ tokenId: "x".repeat(70_000) }),
    });
    expect(big.status).toBe(413);
    // none of the refused calls opened a lobby
    expect((await lobbyOf(host.gameId)).rematch).toBe(false);
  }, 30_000);

  it("tells a late human that the new lobby is full, taken by name or already started", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable({ bots: ["easy"] });
    // Anna opens the lobby (Anna + bot), a stranger fills the last seat
    const opened = await rematch(host, host.token);
    const lobbyHost: Seat = { ...opened.json, token: opened.json.playerToken };
    await joinGame(ts, lobbyHost, "Clara");
    const full = await rematch(friend, friend.token);
    expect(full.status).toBe(409);
    expect(full.json).toMatchObject({ error: "Das Spiel ist voll." });
  }, 20_000);

  it("tells a late human that the rematch has started", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable({ bots: ["easy"] });
    const opened = await rematch(host, host.token);
    await startGame(ts, { ...opened.json, token: opened.json.playerToken });
    const late = await rematch(friend, friend.token);
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({ error: "Die Revanche hat bereits begonnen." });
  }, 20_000);

  it("tells a late human whose name was taken meanwhile", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable({ bots: ["easy"], maxPlayers: 4 });
    const opened = await rematch(host, host.token);
    await joinGame(ts, { ...opened.json, token: opened.json.playerToken }, "Ben");
    const late = await rematch(friend, friend.token);
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({ error: "Dieser Name ist schon vergeben." });
    // nothing was marked as joined: Ben may try again once the name is free (a refused call keeps no seat)
    expect((await lobbyOf(opened.json.gameId)).seats.filter((s) => s.name === "Ben")).toHaveLength(
      1,
    );
  }, 20_000);

  it("opens a fresh lobby when the one it linked was deleted for inactivity", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const first = await rematch(friend, friend.token);
    ts.srv.hub.db.touchActivity(first.json.gameId, Date.now() - 3 * 24 * 60 * 60_000);
    expect(ts.srv.hub.runRetention().expired).toEqual([{ id: first.json.gameId, status: "lobby" }]);
    const second = await rematch(host, host.token);
    expect(second.status).toBe(201);
    expect(second.json.gameId).not.toBe(first.json.gameId);
    const third = await rematch(friend, friend.token);
    expect(third.status).toBe(201);
    expect(third.json.gameId).toBe(second.json.gameId);
    expect(
      (await lobbyOf(second.json.gameId)).seats.filter((s) => s.kind === "human"),
    ).toHaveLength(2);
  }, 20_000);

  it("the link to the new game is persisted and survives a restart", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const first = await rematch(friend, friend.token);
    await ts.restart();
    const db = new Db(ts.dir);
    const row = db.load(host.gameId);
    db.close();
    expect(row?.lobby.rematch?.gameId).toBe(first.json.gameId);
    expect(row?.lobby.rematch?.joined).toEqual([friend.playerId]);
    // only hashes are stored
    expect(JSON.stringify(row)).not.toContain(first.json.playerToken);
    expect(JSON.stringify(row)).toContain(sha256(friend.token));
    expect((await lobbyOf(host.gameId)).rematch).toBe(true);
    const second = await rematch(host, host.token);
    expect(second.status).toBe(201);
    expect(second.json.gameId).toBe(first.json.gameId);
    // a repeat after the restart is still refused
    expect((await rematch(friend, friend.token)).status).toBe(409);
  }, 30_000);

  describe("persistence is all or nothing (the new lobby and the link are one fenced write)", () => {
    const failures = [
      ["a failing disk", readonlyError],
      ["a lost writer lease", () => new LeaseFencedError()],
    ] as const;

    it.each(failures)(
      "%s while opening the lobby: no 201, no orphan lobby, no link, a retry works",
      async (_name, makeError) => {
        let failing = false;
        ts = await startTestServer({
          botDelayMs: 5_000,
          dbWriteFault: () => {
            if (failing) throw makeError();
          },
        });
        const { host, friend } = await finishedTable();
        failing = true;
        const failed = await rematch(friend, friend.token);
        failing = false;
        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect(JSON.stringify(failed.json)).not.toContain("playerToken");
        expect((await lobbyOf(host.gameId)).rematch).toBe(false);
        expect(ts.srv.hub.db.countByStatus().lobby).toBe(0);
        await ts.restart();
        const db = new Db(ts.dir);
        const row = db.load(host.gameId);
        const lobbies = db.countByStatus().lobby;
        db.close();
        expect(row?.lobby.rematch).toBeUndefined();
        expect(lobbies).toBe(0);
        const retry = await rematch(friend, friend.token);
        expect(retry.status).toBe(201);
        expect((await rematch(host, host.token)).json.gameId).toBe(retry.json.gameId);
      },
      30_000,
    );

    it.each(failures)(
      "%s while joining: no seat, the caller is not marked as joined, a retry works",
      async (_name, makeError) => {
        let failing = false;
        ts = await startTestServer({
          botDelayMs: 5_000,
          dbWriteFault: () => {
            if (failing) throw makeError();
          },
        });
        const { host, friend } = await finishedTable();
        const opened = await rematch(friend, friend.token);
        failing = true;
        const failed = await rematch(host, host.token);
        failing = false;
        expect(failed.status).toBeGreaterThanOrEqual(500);
        const humans = async () =>
          (await lobbyOf(opened.json.gameId)).seats.filter((s) => s.kind === "human");
        expect(await humans()).toHaveLength(1);
        const retry = await rematch(host, host.token);
        expect(retry.status).toBe(201);
        expect(retry.json.gameId).toBe(opened.json.gameId);
        expect(await humans()).toHaveLength(2);
      },
      30_000,
    );
  });

  describe("the call that opens the lobby costs what creating a game costs", () => {
    it("needs a valid proof of work, refused like a game creation, and opens nothing without one", async () => {
      ts = await startTestServer({ botDelayMs: 5_000 });
      const { host, friend } = await finishedTable();
      const headers = { "x-player-token": friend.token };
      const missing = await rematchWith(host, headers);
      expect(missing.status).toBe(403);
      expect(missing.json).toEqual({ error: POW_MISSING_MESSAGE });
      const bad = await rematchWith(host, { ...headers, [POW_HEADER]: "garbage" });
      expect(bad.status).toBe(403);
      expect(bad.json).toEqual({ error: POW_INVALID_MESSAGE });
      const lobbies = () => ts.srv.hub.db.countByStatus().lobby;
      expect(lobbies()).toBe(0);
      expect((await lobbyOf(host.gameId)).rematch).toBe(false);
      const solved = await solvedPowHeaders(ts.base);
      const ok = await rematchWith(host, { ...headers, ...solved });
      expect(ok.status).toBe(201);
      expect(lobbies()).toBe(1);
    }, 30_000);

    it("a solved proof is spent by the call that opens the lobby and cannot open another one", async () => {
      ts = await startTestServer({ botDelayMs: 5_000 });
      const one = await finishedTable();
      const two = await finishedTable();
      const solved = await solvedPowHeaders(ts.base);
      expect(
        (await rematchWith(one.host, { "x-player-token": one.friend.token, ...solved })).status,
      ).toBe(201);
      const replay = await rematchWith(two.host, { "x-player-token": two.friend.token, ...solved });
      expect(replay.status).toBe(403);
      expect((await lobbyOf(two.host.gameId)).rematch).toBe(false);
    }, 40_000);

    it("joining the lobby that is already open needs no proof of work", async () => {
      ts = await startTestServer({ botDelayMs: 5_000 });
      const { host, friend } = await finishedTable();
      const opened = await rematch(friend, friend.token);
      const joined = await rematchWith(host, { "x-player-token": host.token });
      expect(joined.status).toBe(201);
      expect(joined.json.gameId).toBe(opened.json.gameId);
    }, 20_000);

    it("a probe without a proof is refused before the create limiter: the real call keeps its allowance", async () => {
      ts = await startTestServer({
        botDelayMs: 5_000,
        limits: { createBurst: 3, createPerHour: 3, joinBurst: 1000, joinPerHour: 1000 },
      });
      const { host, friend } = await finishedTable(); // 1 of 3 creations
      const first = await rematch(friend, friend.token); // 2 of 3
      ts.srv.hub.db.touchActivity(first.json.gameId, Date.now() - 3 * 24 * 60 * 60_000);
      expect(ts.srv.hub.runRetention().expired).toEqual([
        { id: first.json.gameId, status: "lobby" },
      ]);
      // the join-first probe of the client: the linked lobby is gone, so the server asks for a proof
      const probe = await rematchWith(host, { "x-player-token": host.token });
      expect(probe.status).toBe(403);
      expect(probe.json).toEqual({ error: POW_MISSING_MESSAGE });
      const real = await rematch(host, host.token); // the last allowance
      expect(real.status).toBe(201);
      expect(real.json.gameId).not.toBe(first.json.gameId);
    }, 40_000);

    it("is charged against the create limiter: chained rematches run into it", async () => {
      ts = await startTestServer({
        botDelayMs: 5_000,
        limits: {
          createBurst: 3,
          createPerHour: 3,
          joinBurst: 1000,
          joinPerHour: 1000,
        },
      });
      const one = await finishedTable(); // 1 of 3 creations
      const two = await finishedTable(); // 2 of 3
      expect((await rematch(one.host, one.friend.token)).status).toBe(201); // 3 of 3
      const over = await rematch(two.host, two.friend.token);
      expect(over.status).toBe(429);
      expect((await lobbyOf(two.host.gameId)).rematch).toBe(false);
    }, 40_000);
  });

  it("two finished games rematching at once take the last free lobby slot only once", async () => {
    ts = await startTestServer({ botDelayMs: 5_000, limits: { maxOpenLobbies: 1 } });
    const one = await finishedTable();
    const two = await finishedTable();
    const proofs = [await solvedPowHeaders(ts.base), await solvedPowHeaders(ts.base)];
    const [a, b] = await Promise.all([
      rematchWith(one.host, { "x-player-token": one.friend.token, ...proofs[0] }),
      rematchWith(two.host, { "x-player-token": two.friend.token, ...proofs[1] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 503]);
    const refused = a.status === 503 ? a : b;
    expect(refused.json).toEqual({ error: SERVER_FULL_MESSAGE });
    expect(ts.srv.hub.db.countByStatus().lobby).toBe(1);
    const refusedFrom = a.status === 503 ? one : two;
    expect((await lobbyOf(refusedFrom.host.gameId)).rematch).toBe(false);
    await ts.restart();
    const db = new Db(ts.dir);
    const lobbies = db.countByStatus().lobby;
    db.close();
    expect(lobbies).toBe(1);
  }, 40_000);

  it("keeps the names of the original bots, so no returning human finds their name taken", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    // the bot of a Swiss table is "Ueli Chäsli" because the host already is "Heidi vom Pilatus", the first bot name
    const { host, friend } = await finishedTable({
      host: "Heidi vom Pilatus",
      theme: "ch",
      bots: ["easy"],
      maxPlayers: 3,
    });
    const old = await lobbyOf(host.gameId);
    const botNames = old.seats.filter((s) => s.kind === "bot").map((s) => s.name);
    const opened = await rematch(friend, friend.token);
    const next = await lobbyOf(opened.json.gameId);
    expect(next.seats.filter((s) => s.kind === "bot").map((s) => s.name)).toEqual(botNames);
    const back = await rematch(host, host.token);
    expect(back.status).toBe(201);
    expect(
      (await lobbyOf(opened.json.gameId)).seats.find((s) => s.name === "Heidi vom Pilatus")?.kind,
    ).toBe("human");
  }, 20_000);

  it("checks the wished piece against the rematch lobby's own theme, not the old game's", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable({ bots: [], theme: "fr" });
    const opened = await rematch(friend, friend.token);
    const lobbyHost: Seat = { ...opened.json, token: opened.json.playerToken };
    const patched = await ts.api(
      "PATCH",
      `/api/games/${opened.json.gameId}/settings`,
      { themeId: "ch" },
      lobbyHost.token,
    );
    expect(patched.status).toBe(200);
    const taken = (await lobbyOf(opened.json.gameId)).seats.map((s) => s.tokenId);
    const swiss = getTheme("ch").tokens.find((t) => !taken.includes(t.id))?.id;
    const french = getTheme("fr").tokens[0]?.id;
    expect(swiss).toBeDefined();
    // a piece of the old game's theme does not exist in the lobby any more
    const stale = await rematch(host, host.token, { tokenId: french });
    expect(stale.status).toBe(400);
    const joined = await rematch(host, host.token, { tokenId: swiss });
    expect(joined.status).toBe(201);
    const seat = (await lobbyOf(opened.json.gameId)).seats.find((s) => s.name === "Anna");
    expect(seat?.tokenId).toBe(swiss);
  }, 20_000);

  it("validates the player token header: malformed or doubled values are 400, missing or foreign 403", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const { host, friend } = await finishedTable();
    const solved = await solvedPowHeaders(ts.base);
    const call = (token: string | undefined) =>
      rematchWith(host, { ...(token === undefined ? {} : { "x-player-token": token }), ...solved });
    for (const bad of [
      "x".repeat(129),
      "two words",
      "semi;colon",
      "päivä",
      "",
      `${friend.token}, ${host.token}`,
    ]) {
      expect((await call(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // two header lines reach the server as one comma-joined value
    const doubled = await fetch(`${ts.base}/api/games/${host.gameId}/rematch`, {
      method: "POST",
      headers: [
        ["content-type", "application/json"],
        ["x-player-token", friend.token],
        ["x-player-token", host.token],
        [POW_HEADER, solved[POW_HEADER] ?? ""],
      ],
      body: "{}",
    });
    expect(doubled.status).toBe(400);
    expect((await call(undefined)).status).toBe(403);
    expect((await call("notatoken")).status).toBe(403);
    expect((await lobbyOf(host.gameId)).rematch).toBe(false);
    expect((await call(friend.token)).status).toBe(201);
  }, 30_000);
});
