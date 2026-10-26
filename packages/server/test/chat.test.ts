// Chat safety (docs/DESIGN.md #69): authorisation on every path, host controls, limits, no text in logs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyInfo, ServerMessage } from "@poly/engine";
import {
  TestClient,
  createGame,
  joinGame,
  sleep,
  startGame,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { Seat, TestServer } from "./harness.ts";

type Chat = Extract<ServerMessage, { t: "chat" }>;
type Quick = Extract<ServerMessage, { t: "quick-chat" }>;
type Rejected = Extract<ServerMessage, { t: "chat-rejected" }>;

const chats = (c: TestClient): Chat[] => c.msgs.filter((m): m is Chat => m.t === "chat");
const quicks = (c: TestClient): Quick[] => c.msgs.filter((m): m is Quick => m.t === "quick-chat");
const rejected = (c: TestClient): string[] =>
  c.msgs.filter((m): m is Rejected => m.t === "chat-rejected").map((m) => m.reason);
/** every chat-ish message a client received, as one string (what a leak would show up in) */
const everything = (c: TestClient): string => JSON.stringify(c.msgs);

/** `token`: the host's by default, "" sends none */
const patch = (ts: TestServer, host: Seat, body: unknown, token: string = host.token) =>
  ts.api<LobbyInfo | { error: string }>("PATCH", `/api/games/${host.gameId}/chat`, body, token);

let ts: TestServer;
beforeEach(async () => {
  ts = await startTestServer();
});
afterEach(async () => {
  await ts.dispose();
});

/** gives the server time to (not) deliver something; the clients then still have to be connected */
async function settleChat(...clients: TestClient[]): Promise<void> {
  await sleep(150);
  for (const c of clients) await c.until((m) => m.t === "presence" || m.t === "welcome");
}

describe("who may read chat", () => {
  it("seated players get messages; spectators and unknown tokens get nothing, on every path", async () => {
    const t = await startedTable(ts, { bots: [] });
    // spectators connected BEFORE the message
    const spec = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    const bogus = await TestClient.join(ts, { gameId: t.host.gameId, token: "nope" });
    t.a.send({ t: "chat", text: "geheime Strategie" });
    await t.b.until((m) => m.t === "chat");
    await settleChat(spec, bogus);
    expect(chats(t.b).map((m) => m.text)).toEqual(["geheime Strategie"]);
    expect(everything(spec)).not.toContain("geheime");
    expect(everything(bogus)).not.toContain("geheime");

    // spectators joining AFTER the message: the welcome snapshot and the replay carry no chat
    const lateSpec = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    await settleChat(lateSpec);
    expect(everything(lateSpec)).not.toContain("geheime");
    expect(lateSpec.msgs.some((m) => m.t === "chat" || m.t === "quick-chat")).toBe(false);
    // a seated player reconnecting gets the history
    const b2 = await TestClient.join(ts, t.friend);
    await b2.until((m) => m.t === "chat");
    expect(chats(b2).map((m) => m.text)).toEqual(["geheime Strategie"]);

    // REST: nothing returns chat
    const lobby = await ts.api("GET", `/api/games/${t.host.gameId}`);
    expect(JSON.stringify(lobby.json)).not.toContain("geheime");
    for (const [method, path] of [
      ["GET", `/api/games/${t.host.gameId}/chat`],
      ["GET", `/api/games/${t.host.gameId}/messages`],
    ] as const) {
      expect([404, 405]).toContain((await ts.api(method, path)).status);
    }
    await Promise.all([
      t.a.close(),
      t.b.close(),
      b2.close(),
      spec.close(),
      bogus.close(),
      lateSpec.close(),
    ]);
  });

  it("spectators cannot send; the attempt is answered with an error and reaches nobody", async () => {
    const t = await startedTable(ts, { bots: [] });
    const spec = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    const m = spec.mark();
    spec.send({ t: "chat", text: "hallo" });
    spec.send({ t: "quick-chat", id: "hello" });
    await spec.until((x) => x.t === "error", 2000, m);
    await settleChat(t.a, t.b);
    expect(chats(t.a)).toHaveLength(0);
    expect(quicks(t.a)).toHaveLength(0);
    expect(chats(t.b)).toHaveLength(0);
    await Promise.all([t.a.close(), t.b.close(), spec.close()]);
  });

  it("a player removed from the lobby neither receives nor can send, even after reconnecting", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const ben = await joinGame(ts, host, "Ben");
    const cleo = await joinGame(ts, host, "Cleo");
    const a = await TestClient.join(ts, host);
    const c = await TestClient.join(ts, cleo);
    const b = await TestClient.join(ts, ben);
    const removed = await ts.api(
      "DELETE",
      `/api/games/${host.gameId}/seats/${ben.playerId}`,
      undefined,
      host.token,
    );
    expect(removed.status).toBe(200);
    await b.untilClosed();
    a.send({ t: "chat", text: "nur fuer uns" });
    await c.until((m) => m.t === "chat");
    expect(everything(b)).not.toContain("nur fuer uns");
    // the old token now only opens a spectator view
    const again = await TestClient.join(ts, ben);
    expect(again.you).toBeNull();
    again.send({ t: "chat", text: "ich bin noch da" });
    await again.until((m) => m.t === "error");
    a.send({ t: "chat", text: "zweite" });
    await c.until((m) => m.t === "chat" && m.text === "zweite");
    expect(everything(again)).not.toContain("zweite");
    expect(chats(a).some((m) => m.text === "ich bin noch da")).toBe(false);
    await Promise.all([a.close(), c.close(), again.close()]);
  });
});

describe("chat modes", () => {
  it("quick mode accepts only the predefined messages", async () => {
    const t = await startedTable(ts, { bots: [] });
    const r = await patch(ts, t.host, { mode: "quick" });
    expect(r.status).toBe(200);
    expect((r.json as LobbyInfo).chat).toEqual({ mode: "quick", muted: [] });
    await t.b.until((m) => m.t === "lobby" && m.lobby.chat.mode === "quick");

    t.b.send({ t: "chat", text: "hallo zusammen" });
    await t.b.until((m) => m.t === "chat-rejected");
    expect(rejected(t.b)).toEqual(["quick"]);
    t.b.send({ t: "quick-chat", id: "lucky" });
    const q = (await t.a.until((m) => m.t === "quick-chat")) as Quick;
    expect(q).toMatchObject({ from: t.friend.playerId, name: "Ben", id: "lucky" });
    expect(chats(t.a)).toHaveLength(0);
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("off switches chat off for everybody and deletes what was said", async () => {
    const t = await startedTable(ts, { bots: [] });
    t.a.send({ t: "chat", text: "vorher" });
    await t.b.until((m) => m.t === "chat");
    await patch(ts, t.host, { mode: "off" });
    await t.b.until((m) => m.t === "lobby" && m.lobby.chat.mode === "off");
    t.b.send({ t: "chat", text: "nachher" });
    t.b.send({ t: "quick-chat", id: "gg" });
    await t.b.until((m) => m.t === "chat-rejected");
    await sleep(100);
    expect(rejected(t.b)).toEqual(["off", "off"]);
    expect(chats(t.a).map((m) => m.text)).toEqual(["vorher"]);
    // history is gone: a reconnecting player gets none, and after switching back on neither
    await patch(ts, t.host, { mode: "free" });
    const b2 = await TestClient.join(ts, t.friend);
    await settleChat(b2);
    expect(everything(b2)).not.toContain("vorher");
    await Promise.all([t.a.close(), t.b.close(), b2.close()]);
  });

  it("the mode is part of the lobby info (also for spectators) and survives a restart", async () => {
    const host = await createGame(ts, { host: "Anna" });
    await joinGame(ts, host, "Ben");
    await patch(ts, host, { mode: "quick" });
    const spec = await TestClient.join(ts, { gameId: host.gameId, token: null });
    expect(spec.lobby?.chat.mode).toBe("quick");
    await spec.close();
    await ts.restart();
    const lobby = await ts.api<LobbyInfo>("GET", `/api/games/${host.gameId}`);
    expect(lobby.json.chat).toEqual({ mode: "quick", muted: [] });
  });

  it("defaults to free chat with nobody muted", async () => {
    const host = await createGame(ts);
    const lobby = await ts.api<LobbyInfo>("GET", `/api/games/${host.gameId}`);
    expect(lobby.json.chat).toEqual({ mode: "free", muted: [] });
  });
});

describe("host controls (PATCH /api/games/:id/chat)", () => {
  it("is host only, validated and answers with the lobby", async () => {
    const t = await startedTable(ts, { bots: [] });
    expect((await patch(ts, t.host, { mode: "quick" }, t.friend.token)).status).toBe(403);
    expect((await patch(ts, t.host, { mode: "quick" }, "")).status).toBe(403);
    expect((await patch(ts, t.host, { mode: "quick" }, "nope")).status).toBe(403);
    expect((await patch(ts, t.host, {})).status).toBe(400);
    expect((await patch(ts, t.host, { mode: "loud" })).status).toBe(400);
    expect((await patch(ts, t.host, { mode: "free", extra: 1 })).status).toBe(400);
    expect((await patch(ts, t.host, { mute: { playerId: "p9", muted: true } })).status).toBe(404);
    expect(
      (await patch(ts, t.host, { mute: { playerId: t.host.playerId, muted: true } })).status,
    ).toBe(400);
    expect(
      (await ts.api("POST", `/api/games/${t.host.gameId}/chat`, {}, t.host.token)).status,
    ).toBe(405);
    expect(
      (await ts.api("PATCH", `/api/games/nope1234/chat`, { mode: "off" }, t.host.token)).status,
    ).toBe(404);
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("a muted player can read but not write, until unmuted; bots cannot be muted", async () => {
    const t = await startedTable(ts, { bots: ["easy"] });
    const bot = t.a.lobby!.seats.find((s) => s.kind === "bot")!;
    expect(
      (await patch(ts, t.host, { mute: { playerId: bot.playerId, muted: true } })).status,
    ).toBe(400);

    const r = await patch(ts, t.host, { mute: { playerId: t.friend.playerId, muted: true } });
    expect((r.json as LobbyInfo).chat.muted).toEqual([t.friend.playerId]);
    await t.b.until((m) => m.t === "lobby" && m.lobby.chat.muted.length === 1);
    t.b.send({ t: "chat", text: "darf ich nicht" });
    t.b.send({ t: "quick-chat", id: "gg" });
    await t.b.until((m) => m.t === "chat-rejected");
    await sleep(100);
    expect(rejected(t.b)).toEqual(["muted", "muted"]);
    t.a.send({ t: "chat", text: "ich schon" });
    await t.b.until((m) => m.t === "chat" && m.text === "ich schon");
    expect(chats(t.a).some((m) => m.text === "darf ich nicht")).toBe(false);

    await patch(ts, t.host, { mute: { playerId: t.friend.playerId, muted: false } });
    t.b.send({ t: "chat", text: "wieder da" });
    await t.a.until((m) => m.t === "chat" && m.text === "wieder da");
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("a mute does not leak to whoever later takes the seat id (removed seats are unmuted)", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const ben = await joinGame(ts, host, "Ben");
    await patch(ts, host, { mute: { playerId: ben.playerId, muted: true } });
    await ts.api(
      "DELETE",
      `/api/games/${host.gameId}/seats/${ben.playerId}`,
      undefined,
      host.token,
    );
    const lobby = await ts.api<LobbyInfo>("GET", `/api/games/${host.gameId}`);
    expect(lobby.json.chat.muted).toEqual([]);
    const cleo = await joinGame(ts, host, "Cleo");
    const c = await TestClient.join(ts, cleo);
    const a = await TestClient.join(ts, host);
    c.send({ t: "chat", text: "hi" });
    await a.until((m) => m.t === "chat");
    await Promise.all([a.close(), c.close()]);
  });

  it("works in the lobby and while the game runs", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const ben = await joinGame(ts, host, "Ben");
    expect((await patch(ts, host, { mode: "quick" })).status).toBe(200);
    await startGame(ts, host);
    expect((await patch(ts, host, { mode: "free" })).status).toBe(200);
    expect((await patch(ts, host, { mute: { playerId: ben.playerId, muted: true } })).status).toBe(
      200,
    );
  });
});

describe("content rules on the wire", () => {
  it("rejects links and contact data with a reason, silently drops nothing", async () => {
    const t = await startedTable(ts, { bots: [] });
    t.a.send({ t: "chat", text: "geh auf example.ch" });
    t.a.send({ t: "chat", text: "ruf an 079 123 45 67" });
    t.a.send({ t: "chat", text: "du Arschloch" });
    t.a.send({ t: "chat", text: "a".repeat(201) });
    t.a.send({ t: "chat", text: "‮evil" });
    await sleep(200);
    expect(rejected(t.a)).toEqual(["link", "contact", "language", "length", "invalid"]);
    expect(chats(t.b)).toHaveLength(0);
    t.a.send({ t: "chat", text: "Alles gut" });
    await t.b.until((m) => m.t === "chat");
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("delivers the cleaned text", async () => {
    const t = await startedTable(ts, { bots: [] });
    t.a.send({ t: "chat", text: "  hi​  du\u0007 " });
    const m = (await t.b.until((x) => x.t === "chat")) as Chat;
    expect(m.text).toBe("hi du");
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("refuses unknown quick ids and malformed chat messages without publishing", async () => {
    const t = await startedTable(ts, { bots: [] });
    t.a.sendRaw('{"t":"quick-chat","id":"<script>"}');
    t.a.sendRaw('{"t":"chat","text":""}');
    t.a.sendRaw('{"t":"chat","text":5}');
    t.a.sendRaw(`{"t":"chat","text":"${"x".repeat(5000)}"}`);
    await sleep(200);
    expect(t.a.errors()).toHaveLength(4);
    expect(chats(t.b)).toHaveLength(0);
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("quick messages in free mode are published too", async () => {
    const t = await startedTable(ts, { bots: [] });
    t.a.send({ t: "quick-chat", id: "e-party" });
    const q = (await t.b.until((m) => m.t === "quick-chat")) as Quick;
    expect(q.id).toBe("e-party");
    await Promise.all([t.a.close(), t.b.close()]);
  });
});

describe("limits", () => {
  it("rate limits chat per player and tells the sender", async () => {
    await ts.dispose();
    ts = await startTestServer({ limits: { chatBurst: 3, chatPerHour: 3 } });
    const t = await startedTable(ts, { bots: [] });
    for (let i = 0; i < 6; i++) t.a.send({ t: "chat", text: `nachricht ${i}` });
    await sleep(250);
    expect(chats(t.b)).toHaveLength(3);
    expect(rejected(t.a)).toEqual(["rate", "rate", "rate"]);
    // another player has their own budget
    t.b.send({ t: "chat", text: "ich bin dran" });
    await t.a.until((m) => m.t === "chat" && m.text === "ich bin dran");
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("keeps the last 50 lines per game and replays them in order", async () => {
    const t = await startedTable(ts, { bots: [] });
    for (let i = 0; i < 60; i++) t.a.send({ t: "chat", text: `zeile ${i}` });
    await t.b.until((m) => m.t === "chat" && m.text === "zeile 59");
    const b2 = await TestClient.join(ts, t.friend);
    await b2.until((m) => m.t === "chat" && m.text === "zeile 59");
    const texts = chats(b2).map((m) => m.text);
    expect(texts).toHaveLength(50);
    expect(texts[0]).toBe("zeile 10");
    expect(texts.at(-1)).toBe("zeile 59");
    await Promise.all([t.a.close(), t.b.close(), b2.close()]);
  });
});

describe("chat text never reaches logs", () => {
  it("not for accepted, rejected or malformed messages", async () => {
    const seen: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi
        .spyOn(console, k)
        .mockImplementation((...a: unknown[]) => void seen.push(a.map(String).join(" "))),
    );
    try {
      const t = await startedTable(ts, { bots: [] });
      t.a.send({ t: "chat", text: "GEHEIMTEXT-ok" });
      t.a.send({ t: "chat", text: "GEHEIMTEXT example.com" });
      t.a.send({ t: "chat", text: "GEHEIMTEXT Scheisse" });
      t.a.sendRaw('{"t":"chat","text":"GEHEIMTEXT"');
      await t.b.until((m) => m.t === "chat");
      await sleep(200);
      expect(seen.join("\n")).not.toContain("GEHEIMTEXT");
      await Promise.all([t.a.close(), t.b.close()]);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
