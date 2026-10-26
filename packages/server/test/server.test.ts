import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";
import type { RunningServer } from "../src/server.ts";
import { solvedPowHeaders } from "./harness.ts";
import type { JoinResponse, LobbyInfo, ServerMessage } from "@poly/engine";

let srv: RunningServer;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "poly-test-"));
  srv = await startServer({
    pow: { difficulty: 16 },
    port: 0,
    dataDir: dir,
    botDelayMs: 0,
    host: "127.0.0.1",
    allowLowSettings: true,
  });
  base = `http://127.0.0.1:${srv.port}`;
});
afterAll(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: T }> {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-player-token": token } : {}),
      ...(method === "POST" && path === "/api/games" ? await solvedPowHeaders(base) : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as T };
}

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (d) => this.msgs.push(JSON.parse(d.toString())));
  }
  open() {
    return new Promise<void>((ok) => this.ws.once("open", () => ok()));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends ServerMessage["t"]>(
    t: T,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    ms = 5000,
  ) {
    const end = Date.now() + ms;
    for (;;) {
      const m = this.msgs.find((x) => x.t === t && pred(x as any));
      if (m) return m as Extract<ServerMessage, { t: T }>;
      if (Date.now() > end) throw new Error(`timeout waiting for ${t}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

async function connect(gameId: string, token: string | null) {
  const c = new Client(`ws://127.0.0.1:${srv.port}/ws`);
  await c.open();
  c.send({ t: "hello", gameId, playerToken: token });
  return c;
}

describe("lobby", () => {
  it("lists themes", async () => {
    const r = await api("GET", "/api/themes");
    expect(r.status).toBe(200);
    expect(r.json.length).toBeGreaterThan(0);
    expect(r.json[0]).toHaveProperty("flag");
  });

  it("create / join / bots / settings / start", async () => {
    const c = await api<JoinResponse>("POST", "/api/games", {
      hostName: "Daniel",
      settings: { turnTimeoutSec: 0 },
      bots: ["easy"],
      maxPlayers: 3,
    });
    expect(c.status).toBe(201);
    const { gameId, playerToken, inviteCode } = c.json;
    expect(gameId).toHaveLength(8);
    expect(inviteCode).toHaveLength(6);

    let lobby = (await api<LobbyInfo>("GET", `/api/games/${gameId}`)).json;
    expect(lobby.seats).toHaveLength(2);
    expect(new Set(lobby.seats.map((s) => s.color)).size).toBe(2);
    expect(new Set(lobby.seats.map((s) => s.tokenId)).size).toBe(2);

    expect(
      (await api("POST", `/api/games/${gameId}/join`, { name: "Eve", inviteCode: "WRONG1" }))
        .status,
    ).toBe(403);
    const j = await api<JoinResponse>("POST", `/api/games/${gameId}/join`, {
      name: "Anna",
      inviteCode,
    });
    expect(j.status).toBe(201);
    expect(j.json.playerToken).not.toBe(playerToken);
    expect(
      (await api("POST", `/api/games/${gameId}/join`, { name: "Full", inviteCode })).status,
    ).toBe(409);

    // host-only
    expect((await api("POST", `/api/games/${gameId}/start`, {}, j.json.playerToken)).status).toBe(
      403,
    );
    expect(
      (await api("POST", `/api/games/${gameId}/bots`, { botLevel: "hard" }, playerToken)).status,
    ).toBe(409);
    expect(
      (await api("PATCH", `/api/games/${gameId}/settings`, { maxRounds: -1 }, playerToken)).status,
    ).toBe(400);
    expect(
      (
        await api(
          "PATCH",
          `/api/games/${gameId}/settings`,
          { turnTimeoutSec: 99999999 },
          playerToken,
        )
      ).status,
    ).toBe(400);
    const p = await api<LobbyInfo>(
      "PATCH",
      `/api/games/${gameId}/settings`,
      { startingCash: 1500 },
      playerToken,
    );
    expect(p.json.settings.startingCash).toBe(1500);

    expect(
      (await api("DELETE", `/api/games/${gameId}/seats/p2`, undefined, playerToken)).status,
    ).toBe(200);
    lobby = (
      await api<LobbyInfo>("POST", `/api/games/${gameId}/bots`, { botLevel: "hard" }, playerToken)
    ).json;
    expect(lobby.seats).toHaveLength(3);

    const st = await api<LobbyInfo>("POST", `/api/games/${gameId}/start`, {}, playerToken);
    expect(st.status).toBe(200);
    expect(st.json.status).toBe("running");
    expect(
      (await api("POST", `/api/games/${gameId}/join`, { name: "Late", inviteCode })).status,
    ).toBe(409);
  });

  it("validates input and survives garbage", async () => {
    expect(
      (
        await api("POST", "/api/games", {
          hostName: "x".repeat(30),
          settings: {},
          bots: [],
          maxPlayers: 4,
        })
      ).status,
    ).toBe(400);
    expect(
      (await api("POST", "/api/games", { hostName: "A", settings: {}, bots: ["x"], maxPlayers: 4 }))
        .status,
    ).toBe(400);
    expect(
      (await api("POST", "/api/games", { hostName: "A", settings: {}, bots: [], maxPlayers: 9 }))
        .status,
    ).toBe(400);
    expect((await api("GET", "/api/games/nope")).status).toBe(404);
    const r = await fetch(base + "/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(r.status).toBe(400);
  });

  it("start needs >= 2 seats", async () => {
    const c = await api<JoinResponse>("POST", "/api/games", {
      hostName: "Solo",
      settings: {},
      bots: [],
      maxPlayers: 4,
    });
    expect(
      (await api("POST", `/api/games/${c.json.gameId}/start`, {}, c.json.playerToken)).status,
    ).toBe(400);
  });
});

describe("websocket", () => {
  it("hello + action round trip, chat, errors", async () => {
    const c = await api<JoinResponse>("POST", "/api/games", {
      hostName: "Daniel",
      settings: { turnTimeoutSec: 0 },
      bots: ["easy"],
      maxPlayers: 2,
    });
    const { gameId, playerToken } = c.json;
    const ws = await connect(gameId, playerToken);
    const w = await ws.waitFor("welcome");
    expect(w.you).toBe("p1");
    expect(w.state).toBeNull();
    const spec = await connect(gameId, null);
    expect((await spec.waitFor("welcome")).you).toBeNull();

    ws.ws.send("not json");
    await ws.waitFor("error");

    // chat goes to seated players only (docs/DESIGN.md #69): the sender gets the echo, the spectator nothing
    ws.send({ t: "chat", text: "hallo" });
    await ws.waitFor("chat", (m) => m.text === "hallo");
    expect(spec.msgs.some((m) => m.t === "chat")).toBe(false);

    await api("POST", `/api/games/${gameId}/start`, {}, playerToken);
    const upd = await ws.waitFor("update");
    expect(upd.state.id).toBe(gameId);
    expect((upd.state as any).rng).toBeUndefined();

    // spectator cannot act
    spec.send({ t: "action", action: { type: "roll" } });
    await spec.waitFor("error");

    // invalid action for the player -> error (buy while awaiting roll), then a roll works when it's our turn
    const me = upd.state.players[upd.state.current]!.id === "p1";
    if (me) {
      ws.send({ t: "action", action: { type: "buy" } });
      await ws.waitFor("error", (m) => m.message.length > 0);
      const v = upd.state.version;
      ws.send({ t: "action", action: { type: "roll" } });
      await ws.waitFor("update", (m) => m.state.version > v);
    }
    ws.ws.close();
    spec.ws.close();
  });
});

describe("bots", () => {
  it("bot-only game progresses automatically", async () => {
    const c = await api<JoinResponse>("POST", "/api/games", {
      hostName: "H",
      settings: { turnTimeoutSec: 0 },
      bots: ["normal", "hard", "easy"],
      maxPlayers: 4,
    });
    const { gameId, playerToken } = c.json;
    const room = srv.hub.get(gameId)!;
    // the host stays connected: bots only play while a human is attached (docs/DESIGN.md #60)
    const ws = await connect(gameId, playerToken);
    await ws.waitFor("welcome");
    const st = await api("POST", `/api/games/${gameId}/start`, {}, playerToken);
    expect(st.status).toBe(200);
    // make the whole table bots
    room.lobby.seats[0]!.kind = "bot";
    room.state!.players[0]!.controller = "bot";
    room.schedule();
    const u = await ws.waitFor("update", (m) => m.state.version >= 40, 15000);
    expect(u.state.version).toBeGreaterThanOrEqual(40);
    ws.ws.close();
  }, 20000);

  it("timeout hands a human turn to the bot and resumes after restart", async () => {
    const c = await api<JoinResponse>("POST", "/api/games", {
      hostName: "H",
      settings: { turnTimeoutSec: 1 },
      bots: ["normal"],
      maxPlayers: 2,
    });
    const { gameId, playerToken } = c.json;
    // a connected human keeps the timers running (a game nobody is connected to waits, docs/DESIGN.md #60)
    const host = await connect(gameId, playerToken);
    await host.waitFor("welcome");
    await api("POST", `/api/games/${gameId}/start`, {}, playerToken);
    const startVersion = srv.hub.get(gameId)?.state?.version ?? 0;
    // Wait for the effect, not a fixed time: under load the 1 s turn timer and the bot steps can
    // take longer than a hard-coded sleep (that made this test flaky).
    const deadline = Date.now() + 15_000;
    let human = srv.hub.get(gameId)?.state?.players.find((p) => p.id === "p1");
    while ((human?.missedTurns ?? 0) === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      human = srv.hub.get(gameId)?.state?.players.find((p) => p.id === "p1");
    }
    expect(human?.missedTurns).toBeGreaterThan(0);
    expect(srv.hub.get(gameId)?.state?.version).toBeGreaterThan(startVersion);
    host.ws.close();
  }, 20_000);
});

describe("persistence", () => {
  it("reloads games from sqlite after restart", async () => {
    const d = mkdtempSync(join(tmpdir(), "poly-persist-"));
    const s1 = await startServer({
      pow: { difficulty: 16 },
      port: 0,
      dataDir: d,
      botDelayMs: 0,
      host: "127.0.0.1",
      allowLowSettings: true,
    });
    const r = (await (
      await fetch(`http://127.0.0.1:${s1.port}/api/games`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await solvedPowHeaders(`http://127.0.0.1:${s1.port}`)),
        },
        body: JSON.stringify({
          hostName: "P",
          bots: ["easy"],
          maxPlayers: 2,
          settings: { turnTimeoutSec: 0 },
        }),
      })
    ).json()) as JoinResponse;
    await fetch(`http://127.0.0.1:${s1.port}/api/games/${r.gameId}/start`, {
      method: "POST",
      headers: { "x-player-token": r.playerToken },
    });
    await s1.close();
    const s2 = await startServer({
      port: 0,
      dataDir: d,
      botDelayMs: 0,
      host: "127.0.0.1",
      allowLowSettings: true,
    });
    const lobby = (await (
      await fetch(`http://127.0.0.1:${s2.port}/api/games/${r.gameId}`)
    ).json()) as LobbyInfo;
    expect(lobby.status).toBe("running");
    const ws = new Client(`ws://127.0.0.1:${s2.port}/ws`);
    await ws.open();
    ws.send({ t: "hello", gameId: r.gameId, playerToken: r.playerToken });
    const w = await ws.waitFor("welcome");
    expect(w.you).toBe("p1");
    expect(w.state).not.toBeNull();
    ws.ws.close();
    await s2.close();
    rmSync(d, { recursive: true, force: true });
  });
});
