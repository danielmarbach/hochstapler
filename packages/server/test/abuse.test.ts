// H-1 / M-1 / L-1 / L-4 / I-1 (docs/DESIGN.md #59): per-client rate limits, global caps, socket caps, settings floors.
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { JoinResponse } from "@poly/engine";
import {
  TestClient,
  createGame,
  sleep,
  solvedPowHeaders,
  startGame,
  startTestServer,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";
import { RATE_LIMITED_MESSAGE, SERVER_FULL_MESSAGE } from "../src/server.ts";

let ts: TestServer | null = null;
afterEach(async () => {
  await ts?.dispose();
  ts = null;
});

const NEW_GAME = { hostName: "Anna", settings: {}, bots: ["easy"], maxPlayers: 2 };

async function post(
  server: TestServer,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown>; retryAfter: string | null }> {
  const r = await fetch(server.base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(path === "/api/games" ? await solvedPowHeaders(server.base) : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    json: (await r.json()) as Record<string, unknown>,
    retryAfter: r.headers.get("retry-after"),
  };
}

describe("H-1: game creation is rate limited per client", () => {
  it("answers 429 with Retry-After and a translatable message after the burst", async () => {
    ts = await startTestServer({ limits: { createBurst: 3, createPerHour: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await post(ts, "/api/games", NEW_GAME)).status);
    expect(statuses).toEqual([201, 201, 201]);
    const refused = await post(ts, "/api/games", NEW_GAME);
    expect(refused.status).toBe(429);
    expect(refused.json["error"]).toBe(RATE_LIMITED_MESSAGE);
    expect(Number(refused.retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it("limits joins separately (and a bit higher by default)", async () => {
    ts = await startTestServer({ limits: { joinBurst: 2, joinPerHour: 2 } });
    const host = await createGame(ts, { maxPlayers: 8 });
    const join = (name: string) =>
      post(ts!, `/api/games/${host.gameId}/join`, { name, inviteCode: host.inviteCode });
    expect([(await join("B")).status, (await join("C")).status]).toEqual([201, 201]);
    const refused = await join("D");
    expect(refused.status).toBe(429);
    expect(refused.retryAfter).not.toBeNull();
    // creating games is a different bucket
    expect((await post(ts, "/api/games", NEW_GAME)).status).toBe(201);
  });

  it("a forged x-forwarded-for entry does not bypass the limit (only the trusted proxy's entry counts)", async () => {
    ts = await startTestServer({
      trustProxyHops: 1,
      limits: { createBurst: 2, createPerHour: 2 },
    });
    const as = (real: string, forged: string) => ({ "x-forwarded-for": `${forged}, ${real}` });
    expect((await post(ts, "/api/games", NEW_GAME, as("203.0.113.5", "1.1.1.1"))).status).toBe(201);
    expect((await post(ts, "/api/games", NEW_GAME, as("203.0.113.5", "2.2.2.2"))).status).toBe(201);
    for (const forged of ["3.3.3.3", "4.4.4.4", "::1"]) {
      const r = await post(ts, "/api/games", NEW_GAME, as("203.0.113.5", forged));
      expect(r.status, forged).toBe(429);
    }
    // another real client is unaffected
    expect((await post(ts, "/api/games", NEW_GAME, as("203.0.113.9", "1.1.1.1"))).status).toBe(201);
  });

  it("without TRUST_PROXY_HOPS the header is ignored entirely", async () => {
    ts = await startTestServer({ limits: { createBurst: 1, createPerHour: 1 } });
    expect((await post(ts, "/api/games", NEW_GAME, { "x-forwarded-for": "5.5.5.5" })).status).toBe(
      201,
    );
    expect((await post(ts, "/api/games", NEW_GAME, { "x-forwarded-for": "6.6.6.6" })).status).toBe(
      429,
    );
  });
});

describe("H-1: global caps answer 503 'server full'", () => {
  it("refuses new lobbies above maxOpenLobbies", async () => {
    ts = await startTestServer({ limits: { maxOpenLobbies: 2 } });
    await createGame(ts);
    await createGame(ts);
    const r = await post(ts, "/api/games", NEW_GAME);
    expect(r.status).toBe(503);
    expect(r.json["error"]).toBe(SERVER_FULL_MESSAGE);
    expect(r.retryAfter).not.toBeNull();
  });

  it("refuses to start games above maxRunningGames (lobbies stay open)", async () => {
    ts = await startTestServer({ limits: { maxRunningGames: 1 } });
    const a = await createGame(ts, { bots: ["easy"], maxPlayers: 2 });
    const b = await createGame(ts, { bots: ["easy"], maxPlayers: 2 });
    await startGame(ts, a);
    const r = await ts.api("POST", `/api/games/${b.gameId}/start`, {}, b.token);
    expect(r.status).toBe(503);
    expect((r.json as { error: string }).error).toBe(SERVER_FULL_MESSAGE);
    expect((await ts.api("GET", `/api/games/${b.gameId}`)).status).toBe(200);
  });
});

describe("L-1: invite-code failures are counted per client and game", () => {
  it("one client's wrong guesses do not lock the lobby for everybody", async () => {
    ts = await startTestServer({ trustProxyHops: 1 });
    const host = await createGame(ts, { maxPlayers: 4 });
    const path = `/api/games/${host.gameId}/join`;
    const attacker = { "x-forwarded-for": "198.51.100.7" };
    for (let i = 0; i < 10; i++) {
      expect((await post(ts, path, { name: "X", inviteCode: "WRONG1" }, attacker)).status).toBe(
        403,
      );
    }
    expect((await post(ts, path, { name: "X", inviteCode: "WRONG1" }, attacker)).status).toBe(429);
    // even the right code is refused for the attacker while locked ...
    expect(
      (await post(ts, path, { name: "X", inviteCode: host.inviteCode }, attacker)).status,
    ).toBe(429);
    // ... but a friend from another address gets in
    const friend = await post(
      ts,
      path,
      { name: "Ben", inviteCode: host.inviteCode },
      { "x-forwarded-for": "198.51.100.8" },
    );
    expect(friend.status).toBe(201);
  });

  it("the same client has separate counters per game", async () => {
    ts = await startTestServer({ trustProxyHops: 1 });
    const g1 = await createGame(ts, { maxPlayers: 4 });
    const g2 = await createGame(ts, { maxPlayers: 4 });
    const client = { "x-forwarded-for": "198.51.100.7" };
    for (let i = 0; i < 10; i++)
      await post(ts, `/api/games/${g1.gameId}/join`, { name: "X", inviteCode: "WRONG1" }, client);
    const other = await post(
      ts,
      `/api/games/${g2.gameId}/join`,
      { name: "X", inviteCode: g2.inviteCode },
      client,
    );
    expect(other.status).toBe(201);
  });
});

describe("M-1: WebSocket cap per client", () => {
  const open = (server: TestServer, headers: Record<string, string> = {}) =>
    new Promise<{ ws: WebSocket; status: number | null }>((resolve) => {
      const ws = new WebSocket(server.wsUrl, { headers });
      ws.on("open", () => resolve({ ws, status: 101 }));
      ws.on("unexpected-response", (_req, res) => {
        res.resume();
        resolve({ ws, status: res.statusCode ?? null });
      });
      ws.on("error", () => undefined);
    });

  it("refuses the socket above the per-client cap, pre-hello sockets included, and frees the slot on close", async () => {
    ts = await startTestServer({ limits: { wsPerIp: 3 } });
    const sockets = [];
    for (let i = 0; i < 3; i++) sockets.push(await open(ts));
    expect(sockets.map((s) => s.status)).toEqual([101, 101, 101]);
    const refused = await open(ts);
    expect(refused.status).toBe(429);
    sockets[0]!.ws.close();
    await sleep(100);
    const again = await open(ts);
    expect(again.status).toBe(101);
    for (const s of [...sockets, again]) s.ws.close();
  });

  it("counts clients behind the trusted proxy separately, ignoring forged entries", async () => {
    ts = await startTestServer({ trustProxyHops: 1, limits: { wsPerIp: 1 } });
    const a = await open(ts, { "x-forwarded-for": "9.9.9.9, 203.0.113.5" });
    expect(a.status).toBe(101);
    expect((await open(ts, { "x-forwarded-for": "8.8.8.8, 203.0.113.5" })).status).toBe(429);
    const other = await open(ts, { "x-forwarded-for": "9.9.9.9, 203.0.113.6" });
    expect(other.status).toBe(101);
    a.ws.close();
    other.ws.close();
  });

  it("closes a socket that never says hello after the hello timeout", async () => {
    ts = await startTestServer({ wsHelloTimeoutMs: 150 });
    const c = await TestClient.open(ts.wsUrl);
    expect(await c.untilClosed(2000)).toBe(4408);
  });
});

describe("L-4: settings floors", () => {
  it("rejects turn times below 30 s and fewer than 2 missed turns at creation and in the lobby", async () => {
    ts = await startTestServer({ allowLowSettings: false });
    for (const settings of [
      { turnTimeoutSec: 1 },
      { turnTimeoutSec: 29 },
      { awayAfterMissedTurns: 1 },
    ]) {
      const r = await post(ts, "/api/games", { ...NEW_GAME, settings });
      expect(r.status).toBe(400);
      expect(String(r.json["error"])).toContain("30 Sekunden");
    }
    const ok = await post(ts, "/api/games", {
      ...NEW_GAME,
      settings: { turnTimeoutSec: 30, awayAfterMissedTurns: 2 },
    });
    expect(ok.status).toBe(201);
    const off = await post(ts, "/api/games", { ...NEW_GAME, settings: { turnTimeoutSec: 0 } });
    expect(off.status).toBe(201);
    const host = off.json as unknown as JoinResponse;
    const patch = await ts.api(
      "PATCH",
      `/api/games/${host.gameId}/settings`,
      { turnTimeoutSec: 1 },
      host.playerToken,
    );
    expect(patch.status).toBe(400);
    const patched = await ts.api(
      "PATCH",
      `/api/games/${host.gameId}/settings`,
      { turnTimeoutSec: 45 },
      host.playerToken,
    );
    expect(patched.status).toBe(200);
  });

  it("test mode (never production) may go below the floors for e2e speed", async () => {
    ts = await startTestServer({ allowLowSettings: false, testMode: true });
    const r = await post(ts, "/api/games", { ...NEW_GAME, settings: { turnTimeoutSec: 1 } });
    expect(r.status).toBe(201);
  });
});

describe("I-1: HEAD is answered like GET (without a body) on the allow-listed routes", () => {
  it("HEAD /api/themes and /api/games/:id return 200 with the headers of GET and no body", async () => {
    ts = await startTestServer();
    const host = await createGame(ts);
    for (const path of ["/api/themes", `/api/games/${host.gameId}`]) {
      const get = await fetch(ts.base + path);
      const head = await fetch(ts.base + path, { method: "HEAD" });
      expect(head.status, path).toBe(200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
      expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
      expect(head.headers.get("content-security-policy")).not.toBeNull();
    }
  });

  it("HEAD of an unknown game is 404 and HEAD on a POST-only route stays 405", async () => {
    ts = await startTestServer();
    expect((await fetch(ts.base + "/api/games/nope", { method: "HEAD" })).status).toBe(404);
    const r = await fetch(ts.base + "/api/games", { method: "HEAD" });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("POST");
  });
});
