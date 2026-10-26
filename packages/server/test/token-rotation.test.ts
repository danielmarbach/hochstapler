import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LobbyInfo } from "@poly/engine";
import { sha256 } from "../src/rooms.ts";
import { Db } from "../src/db.ts";
import {
  TestClient,
  createGame,
  joinGame,
  startGame,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { Seat, TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
});

interface RotateResponse {
  playerToken: string;
}
const rotate = (seat: Pick<Seat, "gameId">, token: string | undefined) =>
  ts.api<RotateResponse>("POST", `/api/games/${seat.gameId}/seats/me/token`, {}, token);

describe("seat token rotation (POST /api/games/:id/seats/me/token)", () => {
  it("issues a new token and invalidates the old one for REST", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 4 });
    const r = await rotate(host, host.token);
    expect(r.status).toBe(200);
    expect(r.json.playerToken).not.toBe(host.token);
    expect(r.json.playerToken.length).toBeGreaterThanOrEqual(24);
    const body = { botLevel: "easy" };
    const withOld = await ts.api("POST", `/api/games/${host.gameId}/bots`, body, host.token);
    expect(withOld.status).toBe(403);
    const withNew = await ts.api(
      "POST",
      `/api/games/${host.gameId}/bots`,
      body,
      r.json.playerToken,
    );
    expect(withNew.status).toBe(200);
    expect((await rotate(host, host.token)).status).toBe(403);
  });

  it("invalidates the old token for WS hello, the new token works", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const next = (await rotate(host, host.token)).json.playerToken;
    const old = await TestClient.join(ts, host);
    expect(old.you).toBeNull();
    const fresh = await TestClient.join(ts, { gameId: host.gameId, token: next });
    expect(fresh.you).toBe(host.playerId);
    await old.close();
    await fresh.close();
  });

  it("closes every socket of that seat with a clear reason; others stay connected", async () => {
    const t = await startedTable(ts);
    const laptop = t.a;
    const phone = await TestClient.join(ts, t.host);
    const spectator = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    const r = await rotate(t.host, t.host.token);
    expect(r.status).toBe(200);
    await laptop.untilClosed();
    await phone.untilClosed();
    for (const c of [laptop, phone]) {
      expect(c.closeCode).toBe(4001);
      expect(c.closeReason).toBe("token rotated");
    }
    expect(t.b.ws.readyState).toBe(1);
    expect(spectator.ws.readyState).toBe(1);
    const again = await TestClient.join(ts, { gameId: t.host.gameId, token: r.json.playerToken });
    expect(again.you).toBe(t.host.playerId);
    await t.b.close();
    await spectator.close();
    await again.close();
  });

  it("does not touch other seats' tokens", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const friend = await joinGame(ts, host, "Ben");
    await rotate(host, host.token);
    const c = await TestClient.join(ts, friend);
    expect(c.you).toBe(friend.playerId);
    await c.close();
    expect((await rotate(friend, friend.token)).status).toBe(200);
  });

  it("works while the game is running and leaves the game state unchanged", async () => {
    const t = await startedTable(ts);
    const before = t.a.state?.version;
    const r = await rotate(t.host, t.host.token);
    expect(r.status).toBe(200);
    const again = await TestClient.join(ts, { gameId: t.host.gameId, token: r.json.playerToken });
    expect(again.you).toBe(t.host.playerId);
    expect(again.state?.version).toBe(before);
    await t.b.close();
    await again.close();
  });

  it("rejects missing and wrong credentials; bot seats have no token to rotate", async () => {
    const host = await createGame(ts, { host: "Anna", bots: ["easy"] });
    expect((await rotate(host, undefined)).status).toBe(403);
    expect((await rotate(host, "nope")).status).toBe(403);
    // a bot's stored hash is empty: the empty token must never authenticate
    expect((await rotate(host, "")).status).toBe(403);
    const info = await ts.api<LobbyInfo>("GET", `/api/games/${host.gameId}`);
    expect(info.json.seats.some((s) => s.kind === "bot")).toBe(true);
    expect((await rotate(host, host.token)).status).toBe(200);
  });

  it("rejects a malformed body and unknown games", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const path = `/api/games/${host.gameId}/seats/me/token`;
    expect((await ts.api("POST", path, { playerId: "p2" }, host.token)).status).toBe(400);
    const nogame = await ts.api("POST", "/api/games/zzzzzzzz/seats/me/token", {}, host.token);
    expect(nogame.status).toBe(404);
  });

  it("is rate limited per seat", async () => {
    const host = await createGame(ts, { host: "Anna" });
    let token = host.token;
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await rotate(host, token);
      statuses.push(r.status);
      if (r.status === 200) token = r.json.playerToken;
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    const c = await TestClient.join(ts, { gameId: host.gameId, token });
    expect(c.you).toBe(host.playerId);
    await c.close();
  });

  it("stores only the sha256 and survives a restart", async () => {
    const host = await createGame(ts, { host: "Anna" });
    await joinGame(ts, host, "Ben");
    await startGame(ts, host);
    const next = (await rotate(host, host.token)).json.playerToken;
    await ts.restart();
    const db = new Db(ts.dir);
    const row = db.load(host.gameId);
    db.close();
    const hashes = row?.lobby.seats.map((s) => s.tokenHash) ?? [];
    expect(hashes).toContain(sha256(next));
    expect(hashes).not.toContain(sha256(host.token));
    expect(JSON.stringify(row)).not.toContain(next);
    const c = await TestClient.join(ts, { gameId: host.gameId, token: next });
    expect(c.you).toBe(host.playerId);
    await c.close();
  });
});
