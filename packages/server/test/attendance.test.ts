// H-1 (docs/DESIGN.md #60): a game nobody is connected to waits; it continues when a human returns.
import { afterEach, describe, expect, it } from "vitest";
import {
  AutoPlayer,
  TestClient,
  createGame,
  joinGame,
  sleep,
  startGame,
  startTestServer,
} from "./harness.ts";
import type { Seat, TestServer } from "./harness.ts";

let ts: TestServer | null = null;
afterEach(async () => {
  await ts?.dispose();
  ts = null;
});

const versionOf = (server: TestServer, gameId: string): number =>
  server.srv.hub.get(gameId)?.state?.version ?? -1;

/** Host (p1) + one bot; the host plays until the bot has to act, then leaves (socket closed). */
async function hostHandsOverToBot(server: TestServer, settings: object = {}) {
  const host = await createGame(server, { bots: ["normal"], maxPlayers: 2, settings });
  const a = await TestClient.join(server, host);
  await startGame(server, host);
  await a.untilState(() => true);
  new AutoPlayer(a, host.playerId, 5, {
    extraRate: 0,
    stopWhen: (s) => s.players[s.current]!.id !== host.playerId,
  });
  await a.untilState((s) => s.players[s.current]!.id !== host.playerId, 8000);
  return { host, a };
}

describe("a game without a connected human waits", () => {
  it("no bot moves while nobody is connected; they continue when the human returns", async () => {
    ts = await startTestServer({ botDelayMs: 400 });
    const { host, a } = await hostHandsOverToBot(ts);
    await a.close();
    await sleep(60); // the server has seen the close; the 400 ms bot timer was cancelled
    const frozen = versionOf(ts, host.gameId);
    await sleep(900);
    expect(versionOf(ts, host.gameId)).toBe(frozen);

    const back = await TestClient.join(ts, host);
    const next = await back.untilState((s) => s.version > frozen, 4000);
    expect(next.version).toBeGreaterThan(frozen);
    await back.close();
  }, 20_000);

  it("a spectator does not count as a connected human", async () => {
    ts = await startTestServer({ botDelayMs: 400 });
    const { host, a } = await hostHandsOverToBot(ts);
    const spectator = await TestClient.join(ts, { gameId: host.gameId, token: null });
    await a.close();
    await sleep(60);
    const frozen = versionOf(ts, host.gameId);
    await sleep(900);
    expect(versionOf(ts, host.gameId)).toBe(frozen);
    expect(spectator.state!.version).toBe(frozen);
    await spectator.close();
  }, 20_000);

  it("bots keep playing while at least one of several humans is connected", async () => {
    ts = await startTestServer({ botDelayMs: 30 });
    // Ben leaves: his turn times out, he goes away and the bots play for him, all while Anna is connected
    const host = await createGame(ts, {
      bots: ["normal"],
      maxPlayers: 3,
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 2 },
    });
    const friend = await joinGame(ts, host, "Ben");
    const a = await TestClient.join(ts, host);
    const b = await TestClient.join(ts, friend);
    await startGame(ts, host);
    await a.untilState(() => true);
    new AutoPlayer(a, host.playerId, 1, { extraRate: 0 });
    await b.close(); // one human left, one stays
    const away = (st: { players: { id: string; controller: string }[] }) =>
      st.players.find((p) => p.id === friend.playerId)?.controller === "away";
    const s = await a.untilState(away, 15_000);
    expect(away(s)).toBe(true);
    await a.close();
  }, 20_000);

  it("the turn timer does not run for a game nobody is connected to, and restarts in full for the first human back", async () => {
    ts = await startTestServer();
    const host = await createGame(ts, {
      bots: ["normal"],
      maxPlayers: 2,
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 5 },
    });
    const a0 = await TestClient.join(ts, host);
    await startGame(ts, host);
    const s0 = await a0.untilState(() => true);
    expect(s0.deadline).not.toBeNull();
    await a0.close();
    await sleep(1500); // longer than the whole time limit
    const room = ts.srv.hub.get(host.gameId)!;
    expect(room.state!.players[0]!.missedTurns).toBe(0);
    expect(room.state!.version).toBe(s0.version);

    const back = Date.now();
    const a = await TestClient.join(ts, host);
    expect(a.state!.players[0]!.missedTurns).toBe(0);
    expect(a.state!.deadline!).toBeGreaterThanOrEqual(back + 900);
    // with a human connected the bot still takes over an absent player
    const missed = await a.untilState((s) => s.players[0]!.missedTurns >= 1, 4000);
    expect(missed.players[0]!.missedTurns).toBeGreaterThanOrEqual(1);
    await a.close();
  }, 20_000);

  it("rooms without connected humans can be unloaded even while a bot move is due", async () => {
    ts = await startTestServer({ botDelayMs: 400, idleMs: 60, sweepMs: 20 });
    const { host, a } = await hostHandsOverToBot(ts);
    await a.close();
    const end = Date.now() + 3000;
    while (ts.srv.hub.size > 0 && Date.now() < end) await sleep(20);
    expect(ts.srv.hub.size).toBe(0);
    // coming back loads it from the database and continues
    const frozen = (await TestClient.join(ts, host)).state!.version;
    expect(frozen).toBeGreaterThan(0);
  }, 20_000);
});

describe("startup", () => {
  it("does not restart bot loops (or even load rooms) for games nobody is connected to", async () => {
    ts = await startTestServer({ botDelayMs: 400 });
    const { host, a } = await hostHandsOverToBot(ts);
    await a.close();
    await sleep(60);
    const frozen = versionOf(ts, host.gameId);
    await ts.stop();
    await ts.restart();
    expect(ts.srv.hub.size).toBe(0);
    await sleep(900);
    expect(ts.srv.hub.size).toBe(0);
    const back = await TestClient.join(ts, host);
    expect(back.state!.version).toBe(frozen);
    const next = await back.untilState((s) => s.version > frozen, 4000);
    expect(next.version).toBeGreaterThan(frozen);
    await back.close();
  }, 20_000);

  it("the test-only option keeps the old behaviour (bots play without humans)", async () => {
    ts = await startTestServer({ botDelayMs: 0, runWithoutHumans: true });
    const host: Seat = await createGame(ts, { bots: ["normal", "easy"], maxPlayers: 3 });
    await startGame(ts, host);
    const room = ts.srv.hub.get(host.gameId)!;
    room.lobby.seats[0]!.kind = "bot";
    room.state!.players[0]!.controller = "bot";
    room.schedule();
    const end = Date.now() + 5000;
    while (versionOf(ts, host.gameId) < 10 && Date.now() < end) await sleep(20);
    expect(versionOf(ts, host.gameId)).toBeGreaterThanOrEqual(10);
  }, 20_000);
});
