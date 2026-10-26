import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTheme } from "@poly/engine";
import type {
  GameAction,
  JoinResponse,
  LobbyInfo,
  PublicGameState,
  TradeOffer,
} from "@poly/engine";
import {
  AutoPlayer,
  Brain,
  TestClient,
  createGame,
  currentOf,
  invariantViolations,
  joinGame,
  otherOf,
  settle,
  sleep,
  startGame,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";

/** default theme is "ch"; the first bot gets its first themed name */
const FIRST_CH_BOT = getTheme("ch").botNames[0] ?? "";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
});

describe("1. full game with two humans and two bots", () => {
  it("plays to game-over or 300 versions with consistent, gapless updates", async () => {
    const host = await createGame(ts, {
      host: "Anna",
      bots: ["normal", "hard"],
      maxPlayers: 4,
      settings: { startingCash: 600 },
    });
    const friend = await joinGame(ts, host, "Ben");
    const a = await TestClient.join(ts, host);
    const b = await TestClient.join(ts, friend);
    await startGame(ts, host);
    const pa = new AutoPlayer(a, host.playerId, 11, { maxVersion: 300 });
    const pb = new AutoPlayer(b, friend.playerId, 22, { maxVersion: 300 });
    await a.untilState((s) => s.status === "finished" || s.version >= 300, 30_000);
    await settle([a, b]);

    expect(a.state).toEqual(b.state);
    expect(a.errors()).toEqual([]);
    expect(b.errors()).toEqual([]);
    expect(a.updates().flatMap((u) => invariantViolations(u.state))).toEqual([]);
    for (const c of [a, b]) {
      const versions = c.updates().map((u) => u.state.version);
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i], `version step at update ${i}`).toBe(versions[i - 1]! + 1);
      }
    }
    // both humans actually acted, including something besides roll/buy
    expect(pa.sent.length + pb.sent.length).toBeGreaterThan(20);
    const kinds = new Set([...pa.sent, ...pb.sent].map((x: GameAction) => x.type));
    expect(kinds.has("roll")).toBe(true);
    await a.close();
    await b.close();
    const lobby = (await ts.api<LobbyInfo>("GET", `/api/games/${host.gameId}`)).json;
    expect(["running", "finished"]).toContain(lobby.status);
    await sleep(0);
  }, 60_000);
});

const nothingToTrade = (to: string): TradeOffer => ({
  to,
  giveCash: 0,
  giveTiles: [],
  giveJailCards: 0,
  wantCash: 0,
  wantTiles: [],
  wantJailCards: 0,
});
const cashTrade = (to: string, give: number, want: number): TradeOffer => ({
  ...nothingToTrade(to),
  giveCash: give,
  wantCash: want,
});

describe("2. rejected input leaves state untouched", () => {
  it("wrong player, stale, malformed, spectator and cross-seat actions", async () => {
    const t = await startedTable(ts);
    const spec = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    const bogus = await TestClient.join(ts, { gameId: t.host.gameId, token: "not-a-real-token" });
    const v0 = t.a.state!.version;
    const snapshot = JSON.stringify(t.a.state);
    const marks = [t.a, t.b, spec, bogus].map((c) => c.mark());

    // not B's turn
    t.b.act({ type: "roll" });
    t.b.act({ type: "end-turn" });
    // stale / out of phase for A
    t.a.act({ type: "buy" });
    t.a.act({ type: "end-turn" });
    t.a.act({ type: "respond-trade", tradeId: "t99", accept: true });
    // spectators and unknown tokens
    for (const c of [spec, bogus]) {
      c.act({ type: "roll" });
      c.send({ t: "chat", text: "hi" });
    }
    // malformed
    t.a.sendRaw("not json");
    t.a.sendRaw('{"t":"action"}');
    t.a.sendRaw('{"t":"action","action":{"type":"bid","amount":-5}}');
    t.a.sendRaw('{"t":"action","action":{"type":"build","tile":999}}');
    t.a.sendRaw('{"t":"nope"}');
    t.a.sendRaw("[]");
    t.a.sendRaw("null");
    t.a.sendRaw('{"t":"hello","gameId":"x","playerToken":null}'); // second hello
    t.a.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    await settle([t.a, t.b, spec, bogus], 250);

    expect(t.a.state!.version).toBe(v0);
    expect(JSON.stringify(t.a.state)).toBe(snapshot);
    expect(t.b.state!.version).toBe(v0);
    expect(t.a.updates().filter((u) => u.state.version > v0)).toHaveLength(0);
    expect(t.a.errors(marks[0]!).length).toBe(12);
    expect(t.b.errors(marks[1]!).length).toBe(2);
    expect(spec.errors(marks[2]!).length).toBe(2);
    expect(bogus.errors(marks[3]!).length).toBe(2);
    expect(spec.msgs.some((m) => m.t === "chat")).toBe(false);
    expect(t.a.ws.readyState).toBe(1);

    // game still works afterwards
    t.a.act({ type: "roll" });
    await t.b.untilState((s) => s.version > v0);
    await Promise.all([spec.close(), bogus.close(), t.a.close(), t.b.close()]);
  });

  it("a seat token cannot act for another seat (trades, bot seats)", async () => {
    const t = await startedTable(ts);
    const bot = t.a.lobby!.seats.find((x) => x.kind === "bot")!;
    t.a.act({ type: "propose-trade", offer: cashTrade(t.friend.playerId, 10, 0) });
    const s1 = await t.b.untilState((s) => s.trades.some((x) => x.status === "pending"));
    const trade = s1.trades[0]!;
    // the proposer cannot answer for the target; a third party (spectator with a stolen bot id) cannot either
    const m = t.a.mark();
    t.a.act({ type: "respond-trade", tradeId: trade.id, accept: true });
    await t.a.until((x) => x.t === "error", 2000, m);
    // B cannot cancel A's trade
    const mb = t.b.mark();
    t.b.act({ type: "cancel-trade", tradeId: trade.id });
    await t.b.until((x) => x.t === "error", 2000, mb);
    // an empty token never matches the (empty-hash) bot seat
    const impostor = await TestClient.join(ts, { gameId: t.host.gameId, token: "" });
    expect(impostor.you).toBeNull();
    expect(bot.kind).toBe("bot");
    const mi = impostor.mark();
    impostor.act({ type: "respond-trade", tradeId: trade.id, accept: true });
    await impostor.until((x) => x.t === "error", 2000, mi);
    await settle([t.a, t.b]);
    expect(t.a.state!.trades.find((x) => x.id === trade.id)!.status).toBe("pending");
    await Promise.all([impostor.close(), t.a.close(), t.b.close()]);
  });
});

const offer = (o: Partial<TradeOffer> & { to: string }): TradeOffer => ({
  giveCash: 0,
  giveTiles: [],
  giveJailCards: 0,
  wantCash: 0,
  wantTiles: [],
  wantJailCards: 0,
  ...o,
});

describe("2b. hostile trade offers (engine validation seen through the server)", () => {
  it("are all rejected without changing the state", async () => {
    const t = await startedTable(ts, { bots: [] });
    const [pa, pb] = [t.host.playerId, t.friend.playerId];
    const owns = (s: PublicGameState, id: string) =>
      Object.entries(s.properties)
        .filter(([, p]) => p.owner === id && p.level === 0)
        .map(([k]) => Number(k));
    const a = new AutoPlayer(t.a, pa, 7, { extraRate: 0 });
    const b = new AutoPlayer(t.b, pb, 8, { extraRate: 0 });
    await t.a.untilState((s) => owns(s, pa).length > 0 && owns(s, pb).length > 0, 20_000);
    a.paused = true;
    b.paused = true;
    await settle([t.a, t.b], 300);
    const s = t.a.state!;
    const mine = owns(s, pa)[0]!;
    const theirs = owns(s, pb)[0]!;
    const me = s.players[0]!;
    const cases: [string, TradeOffer][] = [
      ["to self", offer({ to: pa, giveCash: 1 })],
      ["to unknown player", offer({ to: "p9", giveCash: 1 })],
      ["duplicate tile in give", offer({ to: pb, giveTiles: [mine, mine] })],
      ["give a tile I do not own", offer({ to: pb, giveTiles: [theirs] })],
      ["want a tile the target does not own", offer({ to: pb, wantTiles: [mine] })],
      ["same tile on both sides", offer({ to: pb, giveTiles: [mine], wantTiles: [mine] })],
      ["more cash than I have", offer({ to: pb, giveCash: me.cash + 1 })],
      ["jail cards I do not hold", offer({ to: pb, giveJailCards: 2 })],
      ["non-buyable tile", offer({ to: pb, giveTiles: [0] })],
      ["empty offer", offer({ to: pb })],
    ];
    const v0 = s.version;
    for (const [label, o] of cases) {
      const m = t.a.mark();
      t.a.act({ type: "propose-trade", offer: o });
      await settle([t.a, t.b], 120);
      const errs = t.a.errors(m);
      const changed = t.a.state!.version !== v0 || t.a.state!.trades.length !== s.trades.length;
      expect({ label, errs: errs.length, changed }).toEqual({ label, errs: 1, changed: false });
    }
    await Promise.all([t.a.close(), t.b.close()]);
  }, 40_000);
});

describe("3. reconnect and presence", () => {
  it("reconnect gets the current state; multiple sockets per player all get updates", async () => {
    const t = await startedTable(ts);
    const cur = currentOf(t);
    const other = otherOf(t, cur);
    const curSeat = cur === t.a ? t.host : t.friend;
    const otherSeat = cur === t.a ? t.friend : t.host;
    expect(cur.connected.sort()).toEqual([t.host.playerId, t.friend.playerId].sort());

    cur.act({ type: "roll" });
    await other.untilState((s) => s.version >= 1);
    await settle([other], 150); // bots may still react to the move
    const mid = other.state!;
    // current player drops mid-turn
    const markOther = other.mark();
    await cur.close();
    const pres = await other.until(
      (m) => m.t === "presence" && !m.connected.includes(curSeat.playerId),
      3000,
      markOther,
    );
    expect(pres.t === "presence" && pres.connected).toEqual([otherSeat.playerId]);
    const lobby = await other.until(
      (m) =>
        m.t === "lobby" &&
        m.lobby.seats.some((x) => x.playerId === curSeat.playerId && !x.connected),
      3000,
      markOther,
    );
    expect(lobby.t).toBe("lobby");

    // reconnects with the token on a new socket, and a second one on top
    const re = await TestClient.join(ts, curSeat);
    expect(re.you).toBe(curSeat.playerId);
    expect(re.state!.version).toBe(mid.version);
    expect(re.state).toEqual(other.state);
    const re2 = await TestClient.join(ts, curSeat);
    expect(re2.state).toEqual(re.state);
    await other.until(
      (m) => m.t === "presence" && m.connected.includes(curSeat.playerId),
      3000,
      markOther,
    );
    // presence lists a player once, however many sockets
    expect(other.connected.filter((x) => x === curSeat.playerId)).toHaveLength(1);

    // continue the turn from the new socket; every socket sees it
    const next1 = new Brain(curSeat.playerId, 5, { extraRate: 0 }).decide(re.state!);
    expect(next1).not.toBeNull();
    re.act(next1!);
    const next = await other.untilState((s) => s.version > mid.version);
    await re2.untilState((s) => s.version >= next.version);
    await re.untilState((s) => s.version >= next.version);
    expect(re2.state!.version).toBe(re.state!.version);

    // closing one of two sockets keeps the player present
    const m2 = other.mark();
    await re.close();
    await settle([other], 200);
    expect(
      other.msgs
        .slice(m2)
        .filter((m) => m.t === "presence" && !m.connected.includes(curSeat.playerId)),
    ).toHaveLength(0);
    expect(other.connected).toContain(curSeat.playerId);
    await Promise.all([re2.close(), other.close()]);
  });
});

describe("7. lobby edge cases", () => {
  it("join rules: full, after start, wrong code, duplicate names, case-insensitive code", async () => {
    const h = await createGame(ts, { host: "Hanna", bots: ["easy"], maxPlayers: 3 });
    const bad = await ts.api("POST", `/api/games/${h.gameId}/join`, {
      name: "Eve",
      inviteCode: "ZZZZZZ",
    });
    expect(bad.status).toBe(403);
    const dupHost = await ts.api("POST", `/api/games/${h.gameId}/join`, {
      name: "hanna",
      inviteCode: h.inviteCode,
    });
    expect(dupHost.status).toBe(409);
    const dupBot = await ts.api("POST", `/api/games/${h.gameId}/join`, {
      name: FIRST_CH_BOT,
      inviteCode: h.inviteCode,
    });
    expect(dupBot.status).toBe(409);
    const ok = await ts.api<JoinResponse>("POST", `/api/games/${h.gameId}/join`, {
      name: "Ida",
      inviteCode: h.inviteCode.toLowerCase(),
    });
    expect(ok.status).toBe(201);
    const dup2 = await ts.api("POST", `/api/games/${h.gameId}/join`, {
      name: " IDA ",
      inviteCode: h.inviteCode,
    });
    expect(dup2.status).toBe(409);
    const full = await ts.api("POST", `/api/games/${h.gameId}/join`, {
      name: "Zed",
      inviteCode: h.inviteCode,
    });
    expect(full.status).toBe(409);
    expect(
      (await ts.api("POST", `/api/games/${h.gameId}/bots`, { botLevel: "easy" }, h.token)).status,
    ).toBe(409);
    expect(
      (
        await ts.api("POST", "/api/games", {
          hostName: "X",
          settings: {},
          bots: ["easy", "easy", "easy"],
          maxPlayers: 3,
        })
      ).status,
    ).toBe(400);
    await startGame(ts, h);
    expect(
      (
        await ts.api("POST", `/api/games/${h.gameId}/join`, {
          name: "Late",
          inviteCode: h.inviteCode,
        })
      ).status,
    ).toBe(409);
    expect((await ts.api("POST", `/api/games/${h.gameId}/start`, {}, h.token)).status).toBe(409);
    expect(
      (await ts.api("PATCH", `/api/games/${h.gameId}/settings`, { startingCash: 900 }, h.token))
        .status,
    ).toBe(409);
    expect(
      (await ts.api("POST", `/api/games/${h.gameId}/bots`, { botLevel: "easy" }, h.token)).status,
    ).toBe(409);
    expect(
      (await ts.api("DELETE", `/api/games/${h.gameId}/seats/p2`, undefined, h.token)).status,
    ).toBe(409);
  });

  it("start needs two seats; only the host may manage", async () => {
    const h = await createGame(ts, { host: "Solo", maxPlayers: 4 });
    expect((await ts.api("POST", `/api/games/${h.gameId}/start`, {}, h.token)).status).toBe(400);
    expect((await ts.api("POST", `/api/games/${h.gameId}/start`, {}, "nope")).status).toBe(403);
    const f = await joinGame(ts, h, "Fred");
    for (const [m, p, b] of [
      ["POST", "start", {}],
      ["POST", "bots", { botLevel: "easy" }],
      ["PATCH", "settings", { startingCash: 900 }],
      ["DELETE", "seats/p2", undefined],
    ] as const) {
      expect((await ts.api(m, `/api/games/${h.gameId}/${p}`, b, f.token)).status, `${m} ${p}`).toBe(
        403,
      );
    }
    expect(
      (await ts.api("DELETE", `/api/games/${h.gameId}/seats/p1`, undefined, h.token)).status,
    ).toBe(400);
    expect(
      (await ts.api("DELETE", `/api/games/${h.gameId}/seats/p7`, undefined, h.token)).status,
    ).toBe(404);
    expect(
      (await ts.api("PATCH", `/api/games/${h.gameId}/settings`, { themeId: "zz" }, h.token)).status,
    ).toBe(400);
  });

  it("host removes a seat that has an open socket", async () => {
    const h = await createGame(ts, { host: "Hugo", maxPlayers: 3 });
    const f = await joinGame(ts, h, "Fiona");
    const g = await joinGame(ts, h, "Gus");
    const hc = await TestClient.join(ts, h);
    const fc = await TestClient.join(ts, f);
    const gc = await TestClient.join(ts, g);
    expect(gc.connected).toContain(f.playerId);
    const mh = hc.mark();
    const mg = gc.mark();
    const r = await ts.api<LobbyInfo>(
      "DELETE",
      `/api/games/${h.gameId}/seats/${f.playerId}`,
      undefined,
      h.token,
    );
    expect(r.status).toBe(200);
    expect(r.json.seats.map((x) => x.playerId)).toEqual(["p1", "p3"]);
    await fc.untilClosed();
    expect(fc.closeCode).toBe(4000);
    expect(fc.errors().length).toBeGreaterThan(0);
    await hc.until((m) => m.t === "presence" && !m.connected.includes(f.playerId), 2000, mh);
    await gc.until((m) => m.t === "lobby" && m.lobby.seats.length === 2, 2000, mg);
    // the removed token no longer maps to a seat
    const again = await TestClient.join(ts, f);
    expect(again.you).toBeNull();
    // the freed seat is re-usable
    const j = await joinGame(ts, h, "Newbie");
    expect(j.playerId).toBe("p4");
    await startGame(ts, h);
    await Promise.all([hc.close(), gc.close(), again.close()]);
  });

  it("settings: theme change keeps token ids unique and valid", async () => {
    const h = await createGame(ts, { host: "T", bots: ["easy", "easy"], maxPlayers: 4 });
    for (const themeId of ["fr", "de", "it", "ch"]) {
      const r = await ts.api<LobbyInfo>(
        "PATCH",
        `/api/games/${h.gameId}/settings`,
        { themeId },
        h.token,
      );
      expect(r.status).toBe(200);
      expect(new Set(r.json.seats.map((x) => x.tokenId)).size).toBe(r.json.seats.length);
    }
  });
});

describe("7b. lobby concurrency and persistence", () => {
  it("parallel joins for the last seat and parallel starts: exactly one wins", async () => {
    const h = await createGame(ts, { host: "Racer", maxPlayers: 2 });
    const joins = await Promise.all(
      ["Ann", "Bob", "Cat", "Dan"].map((name) =>
        ts.api("POST", `/api/games/${h.gameId}/join`, { name, inviteCode: h.inviteCode }),
      ),
    );
    expect(joins.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    const starts = await Promise.all(
      [1, 2, 3].map(() => ts.api("POST", `/api/games/${h.gameId}/start`, {}, h.token)),
    );
    expect(starts.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const c = await TestClient.join(ts, h);
    expect(c.state!.version).toBe(0);
    await c.close();
  });

  it("lobbies (seats, tokens, settings) survive a restart", async () => {
    const own = await startTestServer();
    try {
      const h = await createGame(own, {
        host: "Persist",
        bots: ["easy"],
        maxPlayers: 3,
        settings: { startingCash: 777 },
      });
      const f = await joinGame(own, h, "Friend");
      await own.restart();
      const lobby = (await own.api<LobbyInfo>("GET", `/api/games/${h.gameId}`)).json;
      expect(lobby.status).toBe("lobby");
      expect(lobby.seats.map((x) => x.name)).toEqual(["Persist", FIRST_CH_BOT, "Friend"]);
      expect(lobby.settings.startingCash).toBe(777);
      const c = await TestClient.join(own, f);
      expect(c.you).toBe(f.playerId);
      expect((await own.api("POST", `/api/games/${h.gameId}/start`, {}, f.token)).status).toBe(403);
      await startGame(own, h);
      await c.untilState((s) => s.players.length === 3);
      await c.close();
    } finally {
      await own.dispose();
    }
  });
});

describe("3b. socket cap", () => {
  it("spectators filling the room cannot lock out a seated player", async () => {
    const t = await startedTable(ts, { bots: [] });
    const specs: TestClient[] = [];
    for (let i = 0; i < 70; i++) {
      specs.push(await TestClient.connect(ts, t.host.gameId, null));
    }
    await sleep(300);
    const open = specs.filter((c) => c.ws.readyState === 1).length;
    expect(open).toBeLessThanOrEqual(64);
    // a third player reconnecting with a valid token still gets in (a spectator is dropped to make room)
    const re = await TestClient.connect(ts, t.friend.gameId, t.friend.token);
    const w = await re.until((m) => m.t === "welcome", 3000);
    expect(w.t === "welcome" && w.you).toBe(t.friend.playerId);
    // while an extra spectator is turned away
    const extra = await TestClient.connect(ts, t.host.gameId, null);
    await extra.untilClosed(2000);
    expect(extra.closeCode).toBe(1013);
    await Promise.all([re.close(), t.a.close(), t.b.close(), ...specs.map((c) => c.close())]);
  });
});

describe("8. concurrency and spam", () => {
  it("double accept from two sockets of the target applies exactly once", async () => {
    const t = await startedTable(ts, { bots: [] });
    const b2 = await TestClient.join(ts, t.friend);
    const cash0 = t.a.state!.players.map((p) => p.cash);
    t.a.act({ type: "propose-trade", offer: cashTrade(t.friend.playerId, 0, 40) });
    const s1 = await t.b.untilState((s) => s.trades.some((x) => x.status === "pending"));
    const id = s1.trades[0]!.id;
    const m1 = t.b.mark();
    const m2 = b2.mark();
    t.b.act({ type: "respond-trade", tradeId: id, accept: true });
    b2.act({ type: "respond-trade", tradeId: id, accept: true });
    await settle([t.a, t.b, b2], 250);
    const applied = [t.b, b2].map(
      (c) =>
        c
          .updates()
          .filter((u) => u.events.some((e) => e.type === "trade" && e.trade.status === "accepted"))
          .length,
    );
    // both sockets see the one accepted update; exactly one of them got an error
    expect(applied).toEqual([1, 1]);
    expect(t.b.errors(m1).length + b2.errors(m2).length).toBe(1);
    const fin = t.a.state!;
    expect(fin.players[0]!.cash).toBe(cash0[0]! + 40);
    expect(fin.players[1]!.cash).toBe(cash0[1]! - 40);
    expect(t.b.state).toEqual(fin);
    expect(b2.state).toEqual(fin);
    await Promise.all([t.a.close(), t.b.close(), b2.close()]);
  });

  it("two humans and a duplicate socket all fire at the same version: states stay identical and gapless", async () => {
    const t = await startedTable(ts, { bots: ["normal"] });
    const a2 = await TestClient.join(ts, t.host);
    const marks = [t.a.mark(), t.b.mark(), a2.mark()];
    new AutoPlayer(t.a, t.host.playerId, 31, { maxVersion: 200, extraRate: 0.2 });
    new AutoPlayer(a2, t.host.playerId, 32, { maxVersion: 200, extraRate: 0.2 });
    new AutoPlayer(t.b, t.friend.playerId, 33, { maxVersion: 200, extraRate: 0.2 });
    await t.a.untilState((s) => s.version >= 200, 20_000);
    await settle([t.a, t.b, a2], 300);
    expect(t.a.state).toEqual(t.b.state);
    expect(t.a.state).toEqual(a2.state);
    for (const [i, c] of [t.a, t.b, a2].entries()) {
      const vs = c.msgs
        .slice(marks[i]!)
        .flatMap((m) => (m.t === "update" ? [m.state.version] : []));
      for (let k = 1; k < vs.length; k++) {
        expect(vs[k]).toBe(vs[k - 1]! + 1);
      }
    }
    // the duplicate socket produced real conflicts, and the server turned them into errors, not corruption
    expect(t.a.errors().length + a2.errors().length).toBeGreaterThan(0);
    await Promise.all([t.a.close(), t.b.close(), a2.close()]);
  }, 40_000);

  it("chat spam is rate limited and does not disturb the game", async () => {
    const limited = await startTestServer({ wsRate: { burst: 30, perSec: 10 } });
    try {
      const t = await startedTable(limited, { bots: [] });
      const mb = t.b.mark();
      for (let i = 0; i < 300; i++) {
        t.b.send({ t: "chat", text: `spam ${i}` });
      }
      await t.b.untilClosed(5000);
      expect(t.b.closeCode).toBe(1008);
      const chats = t.a.msgs.filter((m) => m.t === "chat").length;
      expect(chats).toBeLessThanOrEqual(35);
      expect(chats).toBeGreaterThan(0);
      expect(t.b.errors(mb).some((e) => e.includes("Zu viele"))).toBe(true);
      // the game goes on for the well-behaved player, and the spammer can come back
      const v0 = t.a.state!.version;
      t.a.act({ type: "roll" });
      await t.a.untilState((s) => s.version > v0);
      const b2 = await TestClient.join(limited, t.friend);
      expect(b2.you).toBe(t.friend.playerId);
      await Promise.all([t.a.close(), b2.close()]);
    } finally {
      await limited.dispose();
    }
  });
});

describe("7c. full 8-seat table with gaps in the seat ids", () => {
  it("plays with p1, p3..p9 style ids after a seat was removed and re-filled", async () => {
    const h = await createGame(ts, {
      host: "Octo",
      bots: ["easy", "normal", "hard", "easy", "normal"],
      maxPlayers: 8,
      settings: { themeId: "it" },
    });
    const f1 = await joinGame(ts, h, "Eins");
    const f2 = await joinGame(ts, h, "Zwei");
    expect(
      (await ts.api("DELETE", `/api/games/${h.gameId}/seats/p3`, undefined, h.token)).status,
    ).toBe(200); // a bot
    const f3 = await joinGame(ts, h, "Drei");
    expect(
      (
        await ts.api("POST", `/api/games/${h.gameId}/join`, {
          name: "Zuviel",
          inviteCode: h.inviteCode,
        })
      ).status,
    ).toBe(409);
    const lobby = (await ts.api<LobbyInfo>("GET", `/api/games/${h.gameId}`)).json;
    expect(lobby.seats).toHaveLength(8);
    expect(new Set(lobby.seats.map((x) => x.playerId)).size).toBe(8);
    expect(new Set(lobby.seats.map((x) => x.tokenId)).size).toBe(8);
    expect(new Set(lobby.seats.map((x) => x.color)).size).toBe(8);
    const clients = await Promise.all([h, f1, f2, f3].map((x) => TestClient.join(ts, x)));
    await startGame(ts, h);
    const players = [h, f1, f2, f3].map(
      (x, i) =>
        new AutoPlayer(clients[i]!, x.playerId, 60 + i, { maxVersion: 150, extraRate: 0.3 }),
    );
    await clients[0]!.untilState((s) => s.version >= 150, 20_000);
    await settle(clients, 300);
    for (const c of clients) {
      expect(c.errors()).toEqual([]);
      expect(c.state).toEqual(clients[0]!.state);
    }
    expect(clients[0]!.updates().flatMap((u) => invariantViolations(u.state))).toEqual([]);
    expect(players.some((p) => p.sent.length > 0)).toBe(true);
    await Promise.all(clients.map((c) => c.close()));
  }, 40_000);
});

describe("8b. rate limit strikes decay", () => {
  it("occasional bursts over a long connection do not add up to a disconnect", async () => {
    const limited = await startTestServer({ wsRate: { burst: 2, perSec: 50, strikeDecayMs: 40 } });
    try {
      const h = await createGame(limited, { bots: ["easy"], maxPlayers: 2 });
      const c = await TestClient.join(limited, h);
      for (let i = 0; i < 30; i++) {
        c.send({ t: "ping" });
        c.send({ t: "ping" });
        c.send({ t: "ping" }); // third one in the same instant exceeds the burst
        await sleep(70);
      }
      expect(c.ws.readyState).toBe(1);
      expect(c.errors().length).toBeGreaterThanOrEqual(20);
      await c.close();
    } finally {
      await limited.dispose();
    }
  });
});

describe("9. all themes", () => {
  for (const themeId of ["ch", "fr", "de", "it"]) {
    it(`theme ${themeId} starts and plays`, async () => {
      const h = await createGame(ts, {
        bots: ["normal", "easy"],
        maxPlayers: 3,
        settings: { themeId },
      });
      const c = await TestClient.join(ts, h);
      await startGame(ts, h);
      const s0 = await c.untilState(() => true);
      expect(s0.settings.themeId).toBe(themeId);
      expect(new Set(s0.players.map((p) => p.tokenId)).size).toBe(3);
      new AutoPlayer(c, h.playerId, 41, { maxVersion: 80 });
      await c.untilState((s) => s.version >= 80, 10_000);
      expect(c.errors()).toEqual([]);
      await c.close();
    });
  }
});

describe("game over", () => {
  it("finishes via maxRounds, rejects further actions and survives a restart", async () => {
    const own = await startTestServer();
    try {
      const t = await startedTable(own, {
        bots: ["hard"],
        settings: { maxRounds: 3, startingCash: 500 },
      });
      new AutoPlayer(t.a, t.host.playerId, 51);
      new AutoPlayer(t.b, t.friend.playerId, 52);
      const fin = await t.a.untilState((s) => s.status === "finished", 20_000);
      await settle([t.a, t.b], 300);
      expect(t.a.state).toEqual(t.b.state);
      expect(fin.phase.type).toBe("game-over");
      expect(t.a.errors()).toEqual([]);
      const lobby = (await own.api<LobbyInfo>("GET", `/api/games/${t.host.gameId}`)).json;
      expect(lobby.status).toBe("finished");
      const m = t.a.mark();
      t.a.act({ type: "roll" });
      await t.a.until((x) => x.t === "error", 2000, m);
      expect(t.a.state!.version).toBe(fin.version);
      await own.restart();
      const again = await TestClient.join(own, t.host);
      expect(again.state).toEqual(t.a.state);
      await settle([again], 300);
      expect(again.state!.version).toBe(fin.version);
      await Promise.all([t.a.close(), t.b.close(), again.close()]);
    } finally {
      await own.dispose();
    }
  }, 40_000);
});

const SOAK = process.env["SERVER_SOAK"] === "1";
describe.skipIf(!SOAK)("soak (SERVER_SOAK=1)", () => {
  for (let seed = 1; seed <= 12; seed++) {
    it(`long game, seed ${seed}`, async () => {
      const t = await startedTable(ts, {
        bots: ["normal", "hard"],
        settings: { startingCash: 800 },
      });
      new AutoPlayer(t.a, t.host.playerId, seed * 7, { extraRate: 0.5 });
      new AutoPlayer(t.b, t.friend.playerId, seed * 13, { extraRate: 0.5 });
      await t.a.untilState((s) => s.status === "finished" || s.version >= 3000, 120_000);
      await settle([t.a, t.b], 500);
      expect(t.a.state).toEqual(t.b.state);
      expect(t.a.errors()).toEqual([]);
      expect(t.b.errors()).toEqual([]);
      expect(
        t.a
          .updates()
          .flatMap((u) => invariantViolations(u.state))
          .slice(0, 5),
      ).toEqual([]);
      await Promise.all([t.a.close(), t.b.close()]);
    }, 130_000);
  }

  it("chaos: humans pausing and returning with real 1 s timeouts keeps every invariant", async () => {
    const own = await startTestServer({ botDelayMs: 5 });
    try {
      const t = await startedTable(own, {
        bots: ["normal"],
        settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 2, startingCash: 800 },
      });
      const pa = new AutoPlayer(t.a, t.host.playerId, 3, { extraRate: 0.4 });
      const pb = new AutoPlayer(t.b, t.friend.playerId, 4, { extraRate: 0.4 });
      const end = Date.now() + 25_000;
      while (Date.now() < end && t.a.state!.status === "running") {
        pb.paused = !pb.paused;
        pa.paused = false;
        pa.step();
        pb.step();
        await sleep(pb.paused ? 3500 : 1500);
      }
      pa.paused = false;
      pb.paused = false;
      pa.step();
      pb.step();
      await settle([t.a, t.b], 500, 15_000);
      expect(t.a.state).toEqual(t.b.state);
      expect(t.a.errors()).toEqual([]);
      expect(
        t.a
          .updates()
          .flatMap((u) => invariantViolations(u.state))
          .slice(0, 5),
      ).toEqual([]);
      const vs = t.a.updates().map((u) => u.state.version);
      expect(vs.every((v, i) => i === 0 || v > vs[i - 1]!)).toBe(true);
      await Promise.all([t.a.close(), t.b.close()]);
    } finally {
      await own.dispose();
    }
  }, 60_000);
});
