// Wertpapiere (docs/DESIGN.md #48) over the real server: settings, actions over WebSocket,
// redaction, persistence and the test-mode fixtures the browser E2E suite uses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LobbyInfo } from "@poly/engine";
import { TestClient, createGame, joinGame, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

const PILATUS = "ch-pilatus";
const PRICE = 80;

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer({ testMode: true });
});
afterAll(async () => {
  await ts.dispose();
});

async function table(settings: Record<string, unknown> = { securities: true }) {
  const anna = await createGame(ts, { host: "Anna", maxPlayers: 2, settings });
  const ben = await joinGame(ts, anna, "Ben");
  await startGame(ts, anna);
  const a = await TestClient.join(ts, anna);
  const b = await TestClient.join(ts, ben);
  return { anna, ben, a, b };
}

describe("Securities: settings via REST", () => {
  it("defaults to off with a 3-round lock-up", async () => {
    const seat = await createGame(ts, {});
    const lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings).toMatchObject({ securities: false, securitiesLockRounds: 3 });
  });

  it("stores the mode and the lock-up from create and PATCH, validates the range", async () => {
    const seat = await createGame(ts, { settings: { securities: true, securitiesLockRounds: 6 } });
    let lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings).toMatchObject({ securities: true, securitiesLockRounds: 6 });
    const patched = await ts.api<LobbyInfo>(
      "PATCH",
      `/api/games/${seat.gameId}/settings`,
      { securities: false, securitiesLockRounds: 10 },
      seat.token,
    );
    expect(patched.status).toBe(200);
    expect(patched.json.settings).toMatchObject({ securities: false, securitiesLockRounds: 10 });
    for (const bad of [0, 11, 2.5, "3"]) {
      const r = await ts.api(
        "PATCH",
        `/api/games/${seat.gameId}/settings`,
        { securitiesLockRounds: bad },
        seat.token,
      );
      expect(r.status, String(bad)).toBe(400);
    }
    lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings.securitiesLockRounds).toBe(10);
  });
});

describe("Securities: actions via WebSocket", () => {
  it("sends the market to everyone, never the rng, and applies buy and sell", async () => {
    const { anna, a, b } = await table();
    expect(a.state?.market?.prices[PILATUS]).toBe(PRICE);
    expect("rng" in (a.state ?? {})).toBe(false);

    a.act({ type: "buy-securities", secId: PILATUS, shares: 5 });
    const s = await b.untilState((x) => (x.players[0]?.holdings?.length ?? 0) === 1);
    expect(s.players[0]?.cash).toBe(2000 - 5 * PRICE);
    expect(s.players[0]?.holdings).toEqual([
      { secId: PILATUS, shares: 5, buyPrice: PRICE, boughtRound: 1 },
    ]);
    const update = await a.until(
      (m) => m.t === "update" && m.events.some((e) => e.type === "securities-trade"),
    );
    const trade =
      update.t === "update" ? update.events.find((e) => e.type === "securities-trade") : null;
    expect(trade).toMatchObject({ playerId: anna.playerId, side: "buy", shares: 5 });

    // locked: the sale is refused with a readable message and nothing changes
    const mark = a.mark();
    a.act({ type: "sell-securities", secId: PILATUS, lot: 0 });
    await a.until((m) => m.t === "error", 5000, mark);
    expect(a.errors(mark)[0]).toMatch(/gesperrt/);
    expect(a.state?.players[0]?.holdings).toHaveLength(1);

    // the lock-up passes with the rounds (test mode jumps the round), then Anna sells at the price
    const jump = await ts.api("POST", `/api/test/games/${anna.gameId}/state`, { round: 4 });
    expect(jump.status).toBe(200);
    await a.untilState((x) => x.round === 4);
    a.act({ type: "sell-securities", secId: PILATUS, lot: 0 });
    const sold = await a.untilState((x) => (x.players[0]?.holdings?.length ?? 1) === 0);
    expect(sold.players[0]?.cash).toBe(2000);
    await a.close();
    await b.close();
  });

  it("rejects securities actions when the mode is off and malformed ones before the engine", async () => {
    const { a, b } = await table({});
    expect(a.state?.market).toBeUndefined();
    const mark = a.mark();
    a.act({ type: "buy-securities", secId: PILATUS, shares: 1 });
    await a.until((m) => m.t === "error", 5000, mark);
    expect(a.errors(mark)[0]).toMatch(/Wertpapiere/);
    const mark2 = a.mark();
    a.sendRaw(
      JSON.stringify({
        t: "action",
        action: { type: "buy-securities", secId: PILATUS, shares: -1 },
      }),
    );
    await a.until((m) => m.t === "error", 5000, mark2);
    await a.close();
    await b.close();
  });

  it("lets the spectator see the market and keeps the state across a server restart", async () => {
    const { anna, a, b } = await table();
    a.act({ type: "buy-securities", secId: PILATUS, shares: 2 });
    await a.untilState((x) => (x.players[0]?.holdings?.length ?? 0) === 1);
    await a.close();
    await b.close();
    await ts.restart();
    const spectator = await TestClient.join(ts, { gameId: anna.gameId, token: null });
    expect(spectator.state?.market?.prices[PILATUS]).toBe(PRICE);
    expect(spectator.state?.players[0]?.holdings).toEqual([
      { secId: PILATUS, shares: 2, buyPrice: PRICE, boughtRound: 1 },
    ]);
    await spectator.close();
  });

  it("lets bots play a securities game to the end of the round limit", async () => {
    const seat = await createGame(ts, {
      host: "Anna",
      bots: ["normal", "normal"],
      settings: {
        securities: true,
        securitiesLockRounds: 1,
        maxRounds: 3,
        turnTimeoutSec: 1,
        awayAfterMissedTurns: 1,
      },
    });
    // Anna stays connected (a game waits while no human is, docs/DESIGN.md #60), misses her turns and goes away
    const spectator = await TestClient.join(ts, seat);
    await startGame(ts, seat);
    const done = await spectator.untilState((s) => s.status === "finished", 40_000);
    expect(done.market).toBeDefined();
    await spectator.close();
  }, 60_000);
});

describe("Wertpapiere: Testmodus-Fixtures", () => {
  it("sets prices (with history) and holdings and broadcasts them", async () => {
    const { anna, a, b } = await table();
    const r = await ts.api("POST", `/api/test/games/${anna.gameId}/state`, {
      round: 5,
      market: { prices: { [PILATUS]: 120 } },
      players: {
        [anna.playerId]: {
          holdings: [{ secId: PILATUS, shares: 10, buyPrice: 80, boughtRound: 1 }],
        },
      },
    });
    expect(r.status).toBe(200);
    const s = await b.untilState((x) => x.market?.prices[PILATUS] === 120);
    expect(s.market?.history[PILATUS]).toEqual([PRICE, 120]);
    expect(s.players[0]?.holdings).toEqual([
      { secId: PILATUS, shares: 10, buyPrice: 80, boughtRound: 1 },
    ]);
    a.act({ type: "sell-securities", secId: PILATUS, lot: "all" });
    const sold = await a.untilState((x) => (x.players[0]?.holdings?.length ?? 1) === 0);
    expect(sold.players[0]?.cash).toBe(2000 + 10 * 120);
    await a.close();
    await b.close();
  });

  it("refuses market fixtures that are impossible", async () => {
    const { anna, a, b } = await table();
    const post = (body: unknown) => ts.api("POST", `/api/test/games/${anna.gameId}/state`, body);
    expect((await post({ market: { prices: { "ch-nope": 10 } } })).status).toBe(400);
    expect((await post({ market: { prices: { [PILATUS]: 0 } } })).status).toBe(400);
    expect(
      (
        await post({
          players: {
            [anna.playerId]: {
              holdings: [{ secId: "ch-nope", shares: 1, buyPrice: 1, boughtRound: 1 }],
            },
          },
        })
      ).status,
    ).toBe(400);
    await a.close();
    await b.close();
    const off = await table({});
    expect(
      (
        await ts.api("POST", `/api/test/games/${off.anna.gameId}/state`, {
          market: { prices: { [PILATUS]: 90 } },
        })
      ).status,
    ).toBe(400);
    await off.a.close();
    await off.b.close();
  });
});
