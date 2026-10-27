// Show-off mode (Protzmodus, docs/DESIGN.md #93) over the real server: the setting via REST, the
// loan actions through the normal action path, interest at the next turn and the span event.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installInMemoryOtel } from "./otel-harness.ts";
import type { InMemoryOtel } from "./otel-harness.ts";

const otel: InMemoryOtel = installInMemoryOtel();

import type { LobbyInfo } from "@poly/engine";
import { spanGameId } from "../src/telemetry.ts";
import { TestClient, createGame, joinGame, sleep, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer({ testMode: true });
});
afterAll(async () => {
  await ts.dispose();
  await otel.shutdown();
});

async function table(settings: Record<string, unknown> = { loans: true }) {
  const anna = await createGame(ts, { host: "Annabelle", maxPlayers: 2, settings });
  const ben = await joinGame(ts, anna, "Benedikt");
  await startGame(ts, anna);
  const a = await TestClient.join(ts, anna);
  const b = await TestClient.join(ts, ben);
  return { anna, ben, a, b };
}

describe("Protzmodus: setting via REST", () => {
  it("defaults to off and is stored from create and PATCH; non-booleans are refused", async () => {
    const seat = await createGame(ts, {});
    let lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings.loans).toBe(false);
    const patched = await ts.api<LobbyInfo>(
      "PATCH",
      `/api/games/${seat.gameId}/settings`,
      { loans: true },
      seat.token,
    );
    expect(patched.status).toBe(200);
    expect(patched.json.settings.loans).toBe(true);
    for (const bad of ["yes", 1, null]) {
      const r = await ts.api(
        "PATCH",
        `/api/games/${seat.gameId}/settings`,
        { loans: bad },
        seat.token,
      );
      expect(r.status, String(bad)).toBe(400);
    }
    lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings.loans).toBe(true);
    const created = await createGame(ts, { settings: { loans: true } });
    const info = await ts.api<LobbyInfo>("GET", `/api/games/${created.gameId}`);
    expect(info.json.settings.loans).toBe(true);
  });
});

describe("Protzmodus: loans over WebSocket", () => {
  it("takes a loan on the own turn, charges the interest at the next turn and repays", async () => {
    const { a, b } = await table();
    const mark = a.mark();
    a.act({ type: "take-loan", amount: 300 });
    let s = await a.untilState((x) => (x.players[0]?.loans?.length ?? 0) === 1);
    expect(s.players[0]?.cash).toBe(2300);
    expect(s.players[0]?.loans).toEqual([{ amount: 300, ratePct: 8 }]);
    expect(JSON.stringify(s.log)).toContain("log.loanTaken");
    const update = await a.until(
      (m) => m.t === "update" && m.events.some((e) => e.type === "loan"),
      5000,
      mark,
    );
    expect(update.t === "update" ? update.events : []).toContainEqual({
      type: "loan",
      playerId: s.players[0]?.id,
      amount: 300,
      ratePct: 8,
    });
    // Ben may not borrow on Anna's turn
    const markB = b.mark();
    b.act({ type: "take-loan", amount: 100 });
    await b.until((m) => m.t === "error", 5000, markB);
    expect(b.errors(markB)[0]).toMatch(/eigenen Zug/);
    // Anna's next turn: 8 % of 300 = 24 interest
    const r = await ts.api("POST", `/api/test/games/${s.id}/state`, {
      current: s.players[1]?.id,
      phase: { type: "await-end-turn", canRollAgain: false },
    });
    expect(r.status).toBe(200);
    await b.untilState((x) => x.players[x.current]?.id === s.players[1]?.id);
    b.act({ type: "end-turn" });
    s = await a.untilState((x) => x.players[x.current]?.id === s.players[0]?.id);
    expect(s.players[0]?.cash).toBe(2276);
    expect(JSON.stringify(s.log)).toContain("log.loanInterest");
    a.act({ type: "repay-loan", amount: 300 });
    s = await a.untilState((x) => x.players[0]?.loans === undefined);
    expect(s.players[0]?.cash).toBe(1976);
    expect(JSON.stringify(s.log)).toContain("log.loanRepaid");
    await a.close();
    await b.close();
  });

  it("refuses loans when the mode is off and malformed actions before the engine", async () => {
    const { a, b } = await table({});
    const mark = a.mark();
    a.act({ type: "take-loan", amount: 100 });
    await a.until((m) => m.t === "error", 5000, mark);
    expect(a.errors(mark)[0]).toMatch(/Protzmodus/);
    for (const action of [
      { type: "take-loan", amount: -100 },
      { type: "take-loan", amount: "100" },
      { type: "repay-loan" },
      { type: "take-loan", amount: 1.5 },
    ]) {
      const m = a.mark();
      a.sendRaw(JSON.stringify({ t: "action", action }));
      await a.until((x) => x.t === "error", 5000, m);
    }
    expect(a.state?.players[0]?.cash).toBe(2000);
    await a.close();
    await b.close();
  });

  it("records the loan as a span event with the action type, without names", async () => {
    const { anna, a, b } = await table();
    a.act({ type: "take-loan", amount: 200 });
    await a.untilState((x) => (x.players[0]?.loans?.length ?? 0) === 1);
    await sleep(30);
    const spans = otel.spans();
    const actionSpan = spans.find(
      (sp) =>
        sp.name === "game.action" &&
        sp.attributes["game.action.type"] === "take-loan" &&
        sp.attributes["game.id"] === spanGameId(anna.gameId),
    );
    expect(actionSpan).toBeDefined();
    const ev = actionSpan?.events.find((e) => e.name === "game.loan");
    expect(ev?.attributes).toMatchObject({
      "game.seat.index": 0,
      "game.loan.amount": 200,
      "game.loan.rate_pct": 8,
    });
    const dump = JSON.stringify(spans.map((sp) => [sp.attributes, sp.events]));
    expect(dump).not.toContain("Annabelle");
    expect(dump).not.toContain("Benedikt");
    await a.close();
    await b.close();
  });

  it("lets bots play a show-off game to the round limit", async () => {
    const seat = await createGame(ts, {
      host: "Anna",
      bots: ["normal", "hard"],
      settings: { loans: true, maxRounds: 3, turnTimeoutSec: 1, awayAfterMissedTurns: 1 },
    });
    // Anna stays connected (a game waits while no human is, docs/DESIGN.md #60), misses her turns and goes away
    const spectator = await TestClient.join(ts, seat);
    await startGame(ts, seat);
    const done = await spectator.untilState((x) => x.status === "finished", 40_000);
    expect(done.settings.loans).toBe(true);
    await spectator.close();
  }, 60_000);

  it("test mode seeds loan tranches only in show-off games", async () => {
    const on = await table();
    const r = await ts.api("POST", `/api/test/games/${on.anna.gameId}/state`, {
      players: { [on.anna.playerId]: { loans: [{ amount: 400, ratePct: 12 }] } },
    });
    expect(r.status).toBe(200);
    const s = await on.b.untilState((x) => (x.players[0]?.loans?.length ?? 0) === 1);
    expect(s.players[0]?.loans).toEqual([{ amount: 400, ratePct: 12 }]);
    for (const bad of [[{ amount: 150, ratePct: 12 }], [{ amount: 100, ratePct: 0 }]]) {
      const x = await ts.api("POST", `/api/test/games/${on.anna.gameId}/state`, {
        players: { [on.anna.playerId]: { loans: bad } },
      });
      expect(x.status).toBe(400);
    }
    await on.a.close();
    await on.b.close();
    const off = await table({});
    const x = await ts.api("POST", `/api/test/games/${off.anna.gameId}/state`, {
      players: { [off.anna.playerId]: { loans: [{ amount: 100, ratePct: 8 }] } },
    });
    expect(x.status).toBe(400);
    await off.a.close();
    await off.b.close();
  });
});
