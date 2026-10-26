// Dividends of the securities mode over the real server (docs/DESIGN.md #83): the setting via REST,
// the payout at the round end over WebSocket and the telemetry span event (a total, no names).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installInMemoryOtel } from "./otel-harness.ts";
import type { InMemoryOtel } from "./otel-harness.ts";

const otel: InMemoryOtel = installInMemoryOtel();

import type { LobbyInfo } from "@poly/engine";
import { spanGameId } from "../src/telemetry.ts";
import { TestClient, createGame, joinGame, sleep, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

const GOTTHARD = "ch-gotthard"; // energy, issue price 70

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer({ testMode: true });
});
afterAll(async () => {
  await ts.dispose();
  await otel.shutdown();
});

async function table(settings: Record<string, unknown>) {
  const anna = await createGame(ts, { host: "Annabelle", maxPlayers: 2, settings });
  const ben = await joinGame(ts, anna, "Benedikt");
  await startGame(ts, anna);
  const a = await TestClient.join(ts, anna);
  const b = await TestClient.join(ts, ben);
  return { anna, ben, a, b };
}

describe("Dividends: setting via REST", () => {
  it("defaults to on and is stored from create and PATCH; non-booleans are refused", async () => {
    const seat = await createGame(ts, {});
    let lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings.securitiesDividends).toBe(true);
    const patched = await ts.api<LobbyInfo>(
      "PATCH",
      `/api/games/${seat.gameId}/settings`,
      { securities: true, securitiesDividends: false },
      seat.token,
    );
    expect(patched.status).toBe(200);
    expect(patched.json.settings).toMatchObject({ securities: true, securitiesDividends: false });
    for (const bad of ["no", 0, null]) {
      const r = await ts.api(
        "PATCH",
        `/api/games/${seat.gameId}/settings`,
        { securitiesDividends: bad },
        seat.token,
      );
      expect(r.status, String(bad)).toBe(400);
    }
    lobby = await ts.api<LobbyInfo>("GET", `/api/games/${seat.gameId}`);
    expect(lobby.json.settings.securitiesDividends).toBe(false);
    const created = await createGame(ts, {
      settings: { securities: true, securitiesDividends: false },
    });
    const info = await ts.api<LobbyInfo>("GET", `/api/games/${created.gameId}`);
    expect(info.json.settings.securitiesDividends).toBe(false);
  });
});

describe("Dividends: round end over WebSocket", () => {
  async function rigged(settings: Record<string, unknown>) {
    const t = await table(settings);
    const r = await ts.api("POST", `/api/test/games/${t.anna.gameId}/state`, {
      round: 4,
      current: t.ben.playerId,
      phase: { type: "await-end-turn", canRollAgain: false },
      players: {
        [t.anna.playerId]: {
          holdings: [{ secId: GOTTHARD, shares: 10, buyPrice: 70, boughtRound: 1 }],
        },
      },
    });
    expect(r.status).toBe(200);
    await t.b.untilState((s) => s.round === 4);
    return t;
  }

  it("credits the holder at the round end, logs it and emits a dividend event", async () => {
    const { a, b } = await rigged({ securities: true });
    const before = (await a.untilState((s) => s.round === 4)).players[0]?.cash ?? 0;
    const mark = a.mark();
    b.act({ type: "end-turn" });
    const s = await a.untilState((x) => x.round === 5);
    const paid = (s.players[0]?.cash ?? 0) - before;
    expect(paid).toBeGreaterThanOrEqual(21); // 10 x 70 x 3 % (a special dividend would pay more, a suspension none)
    expect(s.players[0]?.dividends).toBe(paid);
    expect(s.players[1]?.dividends).toBeUndefined();
    expect(JSON.stringify(s.log)).toContain("log.dividend");
    const update = await a.until(
      (m) => m.t === "update" && m.events.some((e) => e.type === "dividend"),
      5000,
      mark,
    );
    expect(update.t === "update" ? update.events : []).toContainEqual({
      type: "dividend",
      playerId: s.players[0]?.id,
      amount: paid,
      round: 4,
    });
    await a.close();
    await b.close();
  });

  it("pays nothing when the host switched dividends off", async () => {
    const { a, b } = await rigged({ securities: true, securitiesDividends: false });
    const before = (await a.untilState((s) => s.round === 4)).players[0]?.cash ?? 0;
    b.act({ type: "end-turn" });
    const s = await a.untilState((x) => x.round === 5);
    expect(s.players[0]?.cash).toBe(before);
    expect(s.players[0]?.dividends).toBeUndefined();
    await a.close();
    await b.close();
  });

  it("records the total as a span event on the round-end action, without any names", async () => {
    const { anna, a, b } = await rigged({ securities: true });
    b.act({ type: "end-turn" });
    const s = await a.untilState((x) => x.round === 5);
    await sleep(30);
    const ev = otel
      .spans()
      .flatMap((sp) => sp.events)
      .find(
        (e) => e.name === "game.dividends" && e.attributes?.["game.id"] === spanGameId(anna.gameId),
      );
    expect(ev?.attributes).toMatchObject({
      "game.round": 4,
      "game.dividends.total": s.players[0]?.dividends,
      "game.dividends.recipients": 1,
    });
    const dump = JSON.stringify(otel.spans().map((sp) => sp.events));
    expect(dump).not.toContain("Annabelle");
    expect(dump).not.toContain("Benedikt");
    await a.close();
    await b.close();
  });
});
