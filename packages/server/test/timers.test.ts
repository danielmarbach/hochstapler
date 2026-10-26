import { afterEach, describe, expect, it } from "vitest";
import type { TradeOffer } from "@poly/engine";
import {
  AutoPlayer,
  TestClient,
  createGame,
  settle,
  sleep,
  startGame,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer | null = null;
afterEach(async () => {
  await ts?.dispose();
  ts = null;
});

const cashTrade = (to: string, give: number, want: number): TradeOffer => ({
  to,
  giveCash: give,
  giveTiles: [],
  giveJailCards: 0,
  wantCash: want,
  wantTiles: [],
  wantJailCards: 0,
});

describe("4. turn timeout, away and return", () => {
  it("bot takes over on timeout, player becomes away after N misses and human again on own action (not on bot moves)", async () => {
    ts = await startTestServer({ botDelayMs: 40 });
    const host = await createGame(ts, {
      bots: ["normal"],
      maxPlayers: 2,
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 2 },
    });
    const a = await TestClient.join(ts, host);
    await startGame(ts, host);
    const s0 = await a.untilState(() => true);
    expect(s0.deadline).not.toBeNull();
    expect(s0.players[0]!.controller).toBe("human");

    // first miss: bot plays this turn, player is still 'human' with missedTurns 1
    const s1 = await a.untilState((s) => s.players[0]!.missedTurns === 1, 4000);
    expect(s1.players[0]!.controller).toBe("human");
    expect(s1.version).toBeGreaterThan(s0.version);

    // second miss: away
    const away = await a.untilState((s) => s.players[0]!.controller === "away", 5000);
    const awayAt = a.msgs.findIndex((m) => m.t === "update" && m.state.version === away.version);
    // bot keeps playing for the away player immediately (no more 1s waits): many versions in well under a second
    const more = await a.untilState((s) => s.version >= away.version + 15, 3000);
    expect(more.deadline === null || more.players[more.current]!.controller !== "away").toBe(true);
    // not one bot move flipped the player back to human
    const between = a.msgs.slice(awayAt).flatMap((m) => (m.t === "update" ? [m.state] : []));
    expect(between.length).toBeGreaterThan(10);
    for (const st of between) {
      expect(st.players[0]!.controller).toBe("away");
    }
    expect(
      a.msgs
        .slice(awayAt + 1)
        .some((m) => m.t === "update" && m.events.some((e) => e.type === "controller")),
    ).toBe(false);

    // the human acts again (a trade proposal is legal at any time) -> human, missedTurns reset, in a single update
    const m = a.mark();
    a.act({ type: "propose-trade", offer: cashTrade("p2", 5, 0) });
    const back = await a.until(
      (x) =>
        x.t === "update" && x.events.some((e) => e.type === "controller" && e.playerId === "p1"),
      3000,
      m,
    );
    expect(back.t === "update" && back.state.players[0]!.controller).toBe("human");
    expect(back.t === "update" && back.state.players[0]!.missedTurns).toBe(0);
    expect(a.errors()).toEqual([]);
    await a.close();
  }, 20_000);

  it("returning from away restarts the turn timer from the real clock", async () => {
    ts = await startTestServer({ botDelayMs: 400 });
    const t = await startedTable(ts, {
      bots: [],
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 1 },
    });
    new AutoPlayer(t.a, t.host.playerId, 3, { extraRate: 0 });
    // B never acts and goes away; wait for B's turn, where the (slow) bot has not moved yet
    const s = await t.b.untilState(
      (x) => x.players[1]!.controller === "away" && x.current === 1 && x.deadline === null,
      8000,
    );
    expect(s.players[1]!.controller).toBe("away");
    const sentAt = Date.now();
    t.b.act({ type: "propose-trade", offer: cashTrade(t.host.playerId, 5, 0) });
    const m = await t.b.until(
      (x) =>
        x.t === "update" && x.events.some((e) => e.type === "controller" && e.playerId === "p2"),
      3000,
      t.b.mark(),
    );
    const st = m.t === "update" ? m.state : null;
    expect(st!.players[1]!.controller).toBe("human");
    if (st!.current === 1) {
      // still B's decision: deadline = now + 1 s, not "last log entry + 1 s"
      expect(st!.deadline).not.toBeNull();
      expect(st!.deadline!).toBeGreaterThanOrEqual(sentAt + 1000);
      expect(st!.deadline!).toBeLessThanOrEqual(Date.now() + 1000);
    }
    await Promise.all([t.a.close(), t.b.close()]);
  }, 15_000);

  it("a rejected action from an away player does not bring them back", async () => {
    ts = await startTestServer({ botDelayMs: 40 });
    const host = await createGame(ts, {
      bots: ["normal"],
      maxPlayers: 2,
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 1 },
    });
    const a = await TestClient.join(ts, host);
    await startGame(ts, host);
    await a.untilState((s) => s.players[0]!.controller === "away", 4000);
    const m = a.mark();
    a.act({ type: "declare-bankruptcy" }); // never legal here
    a.act({ type: "respond-trade", tradeId: "nope", accept: true });
    await a.until((x) => x.t === "error", 2000, m);
    await sleep(150);
    expect(a.state!.players[0]!.controller).toBe("away");
    await a.close();
  }, 15_000);
});

describe("5. trades between humans and bots", () => {
  it("propose, reject, counter, accept moves cash exactly once", async () => {
    ts = await startTestServer();
    const t = await startedTable(ts, { bots: [] });
    const cash0 = t.a.state!.players.map((p) => p.cash);

    t.a.act({ type: "propose-trade", offer: cashTrade("p2", 30, 0) });
    const s1 = await t.b.untilState((s) => s.trades.some((x) => x.status === "pending"));
    const first = s1.trades[0]!;
    expect(first.from).toBe("p1");
    expect(first.expiresAt).toBeNull();
    t.b.act({ type: "respond-trade", tradeId: first.id, accept: false });
    await t.a.untilState((s) => s.trades.find((x) => x.id === first.id)?.status === "rejected");

    t.b.act({ type: "propose-trade", offer: cashTrade("p1", 20, 0) });
    const s2 = await t.a.untilState((s) =>
      s.trades.some((x) => x.status === "pending" && x.from === "p2"),
    );
    const counter = s2.trades.find((x) => x.status === "pending")!;
    t.a.act({ type: "respond-trade", tradeId: counter.id, accept: true });
    // a duplicate accept (e.g. double click) is refused
    t.a.act({ type: "respond-trade", tradeId: counter.id, accept: true });
    const done = await t.b.untilState(
      (s) => s.trades.find((x) => x.id === counter.id)?.status === "accepted",
    );
    await settle([t.a, t.b], 200);
    expect(t.a.errors()).toHaveLength(1);
    expect(done.players[0]!.cash).toBe(cash0[0]! + 20);
    expect(done.players[1]!.cash).toBe(cash0[1]! - 20);
    expect(t.a.state).toEqual(t.b.state);
    await Promise.all([t.a.close(), t.b.close()]);
  });

  it("trade to an absent human expires after the turn timeout", async () => {
    ts = await startTestServer();
    const t = await startedTable(ts, {
      bots: [],
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 5 },
    });
    await t.b.close();
    t.a.act({ type: "propose-trade", offer: cashTrade("p2", 30, 0) });
    const s1 = await t.a.untilState((s) => s.trades.some((x) => x.status === "pending"));
    const tr = s1.trades[0]!;
    expect(tr.expiresAt).not.toBeNull();
    const t0 = Date.now();
    const s2 = await t.a.untilState(
      (s) => s.trades.find((x) => x.id === tr.id)?.status === "expired",
      4000,
    );
    expect(s2.trades.find((x) => x.id === tr.id)!.status).toBe("expired");
    expect(Date.now() - t0).toBeLessThan(2500);
    // the target cannot accept an expired trade any more
    const b2 = await TestClient.join(ts, t.friend);
    const m = b2.mark();
    b2.act({ type: "respond-trade", tradeId: tr.id, accept: true });
    await b2.until((x) => x.t === "error", 2000, m);
    await Promise.all([t.a.close(), b2.close()]);
  }, 15_000);

  it("a trade proposed to an away human is answered by the bot, not left to expire", async () => {
    ts = await startTestServer({ botDelayMs: 0 });
    const t = await startedTable(ts, {
      bots: [],
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 1 },
    });
    new AutoPlayer(t.a, t.host.playerId, 3, { extraRate: 0 });
    // B never acts: after its first missed turn it is away
    await t.a.untilState((s) => s.players[1]!.controller === "away", 6000);
    t.a.act({ type: "propose-trade", offer: cashTrade(t.friend.playerId, 5, 0) });
    const s = await t.a.untilState(
      (x) => x.trades.length > 0 && x.trades.every((y) => y.status !== "pending"),
      3000,
    );
    expect(["accepted", "rejected"]).toContain(s.trades.at(-1)!.status);
    await Promise.all([t.a.close(), t.b.close()]);
  }, 15_000);

  it("a trade proposed to a bot gets answered", async () => {
    ts = await startTestServer();
    const t = await startedTable(ts, { bots: ["normal"] });
    const botId = t.a.lobby!.seats.find((x) => x.kind === "bot")!.playerId;
    t.a.act({ type: "propose-trade", offer: cashTrade(botId, 100, 0) });
    const s = await t.a.untilState(
      (x) => x.trades.length > 0 && x.trades.every((y) => y.status !== "pending"),
      4000,
    );
    expect(["accepted", "rejected"]).toContain(s.trades[0]!.status);
    expect(s.trades[0]!.expiresAt).toBeNull();
    await Promise.all([t.a.close(), t.b.close()]);
  });
});

describe("6. server restart", () => {
  it("a deadline that passed while the server was down starts over when the first human is back (no punishment for the downtime)", async () => {
    ts = await startTestServer();
    const host = await createGame(ts, {
      bots: ["normal"],
      maxPlayers: 2,
      settings: { turnTimeoutSec: 1 },
    });
    const a0 = await TestClient.join(ts, host);
    await startGame(ts, host);
    const s0 = await a0.untilState(() => true);
    expect(s0.deadline).not.toBeNull();
    await ts.stop();
    await sleep(1300); // deadline passes while the server is down
    await ts.restart();
    const back = Date.now();
    const a = await TestClient.join(ts, host);
    expect(a.state!.players[0]!.missedTurns).toBe(0);
    expect(a.state!.deadline!).toBeGreaterThanOrEqual(back + 900);
    // ... and the timer works as before while a human is connected
    const s1 = await a.untilState((s) => s.players[0]!.missedTurns >= 1, 4000);
    expect(s1.version).toBeGreaterThan(s0.version);
    await a.close();
  }, 15_000);

  it("mid-game restart: state survives, timers and bots continue, clients converge", async () => {
    ts = await startTestServer({ botDelayMs: 0 });
    const t = await startedTable(ts, { bots: ["normal"] });
    const pa = new AutoPlayer(t.a, t.host.playerId, 1, { maxVersion: 60 });
    const pb = new AutoPlayer(t.b, t.friend.playerId, 2, { maxVersion: 60 });
    await t.a.untilState((s) => s.version >= 60, 10_000);
    await settle([t.a, t.b], 200);
    const seen = Math.max(t.a.state!.version, t.b.state!.version);
    expect(pa.sent.length + pb.sent.length).toBeGreaterThan(5);
    await ts.stop();
    await ts.restart();
    const a = await TestClient.join(ts, t.host);
    const b = await TestClient.join(ts, t.friend);
    expect(a.state!.version).toBeGreaterThanOrEqual(seen);
    expect(a.state).toEqual(b.state);
    new AutoPlayer(a, t.host.playerId, 3, { maxVersion: 120 });
    new AutoPlayer(b, t.friend.playerId, 4, { maxVersion: 120 });
    await a.untilState((s) => s.version >= 120, 10_000);
    await settle([a, b], 300);
    expect(a.state).toEqual(b.state);
    expect(a.errors()).toEqual([]);
    expect(b.errors()).toEqual([]);
    await Promise.all([a.close(), b.close()]);
  }, 30_000);

  it("a pending bot move is resumed after restart", async () => {
    ts = await startTestServer({ botDelayMs: 1500 });
    const host = await createGame(ts, {
      bots: ["normal"],
      maxPlayers: 2,
      settings: { auctions: false },
    });
    const a = await TestClient.join(ts, host);
    await startGame(ts, host);
    const s0 = await a.untilState(() => true);
    new AutoPlayer(a, "p1", 5, {
      extraRate: 0,
      stopWhen: (s) => s.players[s.current]!.id !== "p1",
    });
    // human finishes their turn(s); the bot move is now pending behind a 1.5 s delay
    const sBot = await a.untilState((s) => s.players[s.current]!.id === "p2", 5000);
    expect(sBot.version).toBeGreaterThan(s0.version);
    await ts.stop();
    await ts.restart({ botDelayMs: 0 });
    const a2 = await TestClient.join(ts, host);
    expect(a2.state!.version).toBeGreaterThanOrEqual(sBot.version);
    const moved = await a2.untilState((s) => s.version > sBot.version, 3000);
    expect(moved.version).toBeGreaterThan(sBot.version);
    await a2.close();
  }, 20_000);

  it("a trade that expired while the server was down gets a fresh window when a human is back, then expires on time", async () => {
    ts = await startTestServer();
    const t = await startedTable(ts, {
      bots: [],
      settings: { turnTimeoutSec: 3, awayAfterMissedTurns: 5 },
    });
    t.b.act({ type: "propose-trade", offer: cashTrade(t.host.playerId, 10, 0) });
    const s1 = await t.a.untilState((s) => s.trades.some((x) => x.status === "pending"));
    const tr = s1.trades[0]!;
    await Promise.all([t.a.close(), t.b.close()]);
    await ts.stop();
    await sleep(Math.max(0, tr.expiresAt! + 150 - Date.now()));
    await ts.restart();
    const back = Date.now();
    const a = await TestClient.join(ts, t.host);
    const open = a.state!.trades.find((x) => x.id === tr.id)!;
    expect(open.status).toBe("pending");
    expect(open.expiresAt!).toBeGreaterThanOrEqual(back + 2500);
    const s3 = await a.untilState(
      (s) => s.trades.find((x) => x.id === tr.id)?.status === "expired",
      5000,
    );
    expect(s3.trades.find((x) => x.id === tr.id)!.status).toBe("expired");
    await a.close();
  }, 15_000);
});

describe("room unloading", () => {
  it("idle rooms are unloaded and come back intact (state, pending trades, bots keep going)", async () => {
    ts = await startTestServer({ idleMs: 60, sweepMs: 20 });
    const t = await startedTable(ts, { bots: ["normal"] });
    t.a.act({ type: "propose-trade", offer: cashTrade(t.friend.playerId, 5, 0) });
    const s1 = await t.b.untilState((s) => s.trades.some((x) => x.status === "pending"));
    await Promise.all([t.a.close(), t.b.close()]);
    const end = Date.now() + 3000;
    while (ts.srv.hub.size > 0 && Date.now() < end) {
      await sleep(20);
    }
    expect(ts.srv.hub.size).toBe(0);
    const again = await TestClient.join(ts, t.friend);
    expect(again.state).toEqual(s1);
    again.act({ type: "respond-trade", tradeId: s1.trades[0]!.id, accept: true });
    await again.untilState((s) => s.trades[0]?.status === "accepted");
    await again.close();
  });
});
