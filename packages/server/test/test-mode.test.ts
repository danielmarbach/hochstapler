import { afterEach, describe, expect, it } from "vitest";
import { TestClient, createGame, joinGame, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";
import { seedForDice } from "../src/test-mode.ts";
import { startServer } from "../src/server.ts";

let ts: TestServer | null = null;
afterEach(async () => {
  await ts?.dispose();
  ts = null;
});

async function twoHumans(server: TestServer) {
  const host = await createGame(server, { host: "Anna" });
  const guest = await joinGame(server, host, "Ben");
  await startGame(server, host);
  const a = await TestClient.join(server, host);
  const b = await TestClient.join(server, guest);
  return { host, guest, a, b };
}

describe("test mode: expire", () => {
  it("makes a game look abandoned and runs the retention sweep once (the game is gone afterwards)", async () => {
    ts = await startTestServer({ testMode: true });
    const host = await createGame(ts);
    const c = await TestClient.join(ts, host);
    const r = await ts.api<{ expired: number }>(
      "POST",
      `/api/test/games/${host.gameId}/expire`,
      {},
    );
    expect(r.status).toBe(200);
    expect(r.json.expired).toBe(1);
    expect(await c.untilClosed()).toBe(4404);
    expect((await ts.api("GET", `/api/games/${host.gameId}`)).status).toBe(404);
    expect((await ts.api("POST", `/api/test/games/${host.gameId}/expire`, {})).status).toBe(404);
  });
});

describe("test mode is off by default", () => {
  it("answers 404 for every /api/test route without POLY_TEST_MODE", async () => {
    ts = await startTestServer({ testMode: false });
    const host = await createGame(ts);
    for (const sub of ["dice", "state", "expire"]) {
      const r = await ts.api("POST", `/api/test/games/${host.gameId}/${sub}`, {
        sequence: [[1, 2]],
        patch: {},
      });
      expect(r.status, sub).toBe(404);
    }
  });

  it("is not switched on by anything but the exact flag value 1", async () => {
    const before = process.env["POLY_TEST_MODE"];
    process.env["POLY_TEST_MODE"] = "true";
    try {
      ts = await startTestServer({});
      const host = await createGame(ts);
      expect(
        (await ts.api("POST", `/api/test/games/${host.gameId}/dice`, { sequence: [[1, 2]] }))
          .status,
      ).toBe(404);
    } finally {
      if (before === undefined) {
        delete process.env["POLY_TEST_MODE"];
      } else {
        process.env["POLY_TEST_MODE"] = before;
      }
    }
  });

  it("refuses to start in production", async () => {
    const before = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      await expect(startServer({ port: 0, testMode: true, staticDir: null })).rejects.toThrow(
        /production/,
      );
    } finally {
      if (before === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = before;
      }
    }
  });
});

describe("seed table", () => {
  it("covers all 36 dice pairs", () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        expect(seedForDice(a, b)).toBeTypeOf("number");
      }
    }
  });
});

describe("test mode on", () => {
  it("rolls exactly the queued dice, in order, for humans", async () => {
    ts = await startTestServer({ testMode: true });
    const { host, guest, a, b } = await twoHumans(ts);
    const queued = await ts.api("POST", `/api/test/games/${host.gameId}/dice`, {
      sequence: [
        [2, 3],
        [6, 6],
        [1, 2],
      ],
    });
    expect(queued.status).toBe(200);

    a.act({ type: "roll" });
    const first = await a.until((m) => m.t === "update" && m.events.some((e) => e.type === "dice"));
    expect(first.t === "update" && first.events.find((e) => e.type === "dice")).toMatchObject({
      dice: [2, 3],
    });
    a.act({ type: "buy" });
    a.act({ type: "end-turn" });
    b.act({ type: "roll" });
    await b.untilState((s) => s.dice?.[0] === 6 && s.dice[1] === 6);
    expect(guest.playerId).toBe("p2");
  });

  it("does not consume rolls when the action does not throw dice", async () => {
    ts = await startTestServer({ testMode: true });
    const { host, a } = await twoHumans(ts);
    await ts.api("POST", `/api/test/games/${host.gameId}/dice`, { sequence: [[2, 5]] });
    a.act({ type: "end-turn" }); // illegal before rolling -> error, queue untouched
    await a.until((m) => m.t === "error");
    a.act({ type: "roll" });
    await a.untilState((s) => s.dice?.[0] === 2 && s.dice[1] === 5);
  });

  it("rejects invalid dice and invalid fixtures", async () => {
    ts = await startTestServer({ testMode: true });
    const { host } = await twoHumans(ts);
    expect(
      (await ts.api("POST", `/api/test/games/${host.gameId}/dice`, { sequence: [[0, 7]] })).status,
    ).toBe(400);
    const badOwner = await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
      properties: { "1": { owner: "p9" } },
    });
    expect(badOwner.status).toBe(400);
    const notBuyable = await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
      properties: { "0": { owner: "p1" } },
    });
    expect(notBuyable.status).toBe(400);
    const unknownKey = await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
      cheat: true,
    });
    expect(unknownKey.status).toBe(400);
  });

  it("loads a fixture, broadcasts it and recomputes the bank stock", async () => {
    ts = await startTestServer({ testMode: true });
    const { host, a, b } = await twoHumans(ts);
    const r = await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
      players: { p1: { cash: 777, position: 6 } },
      properties: { "6": { owner: "p1", level: 3 }, "8": { owner: "p1", level: 5 } },
    });
    expect(r.status).toBe(200);
    const s = await b.untilState((x) => x.players[0]?.cash === 777);
    expect(s.players[0]?.position).toBe(6);
    expect(s.properties[6]).toMatchObject({ owner: "p1", level: 3 });
    expect(s.bank).toMatchObject({ houses: 48 - 3, hotels: 16 - 1 });
    expect((await a.untilState((x) => x.players[0]?.cash === 777)).version).toBe(s.version);
  });

  it("sets up a pending end-game vote (proposer agrees, listed players agreed, others pending)", async () => {
    ts = await startTestServer({ testMode: true });
    const { host, a, b } = await twoHumans(ts);
    const bad = await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
      endVote: { by: "p9", agreed: [] },
    });
    expect(bad.status).toBe(400);
    const ok = await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
      endVote: { by: "p2", agreed: [], expiresInMs: 60_000 },
    });
    expect(ok.status).toBe(200);
    const s = await a.untilState((x) => x.endVote !== undefined);
    expect(s.endVote).toMatchObject({ by: "p2", votes: { p2: true } });
    expect(s.endVote?.expiresAt).toBeGreaterThan(Date.now());
    expect((await b.untilState((x) => x.endVote !== undefined)).version).toBe(s.version);
  });

  it("moves a chosen card to the top of its deck and the next chance field draws it", async () => {
    ts = await startTestServer({ testMode: true });
    const { host, a } = await twoHumans(ts);
    expect(
      (
        await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
          nextCard: { chance: "cc-go" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ts.api("POST", `/api/test/games/${host.gameId}/state`, {
          nextCard: { chance: "ch-dividend" },
        })
      ).status,
    ).toBe(200);
    await ts.api("POST", `/api/test/games/${host.gameId}/dice`, { sequence: [[3, 4]] }); // tile 7 = chance
    a.act({ type: "roll" });
    const update = await a.until(
      (m) => m.t === "update" && m.events.some((e) => e.type === "card"),
    );
    expect(update.t === "update" && update.events.find((e) => e.type === "card")).toMatchObject({
      cardId: "ch-dividend",
    });
  });
});
