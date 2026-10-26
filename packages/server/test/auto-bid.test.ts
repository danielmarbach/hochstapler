import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicGameState } from "@poly/engine";
import { TestClient, createGame, joinGame, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

const ANNA_MAX = 777;
const CARL_MAX = 555;

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer({ testMode: true });
});
afterAll(async () => {
  await ts.dispose();
});

const autoBidsOf = (s: PublicGameState | null): Record<string, number> | undefined =>
  s?.phase.type === "auction" ? s.phase.auction.autoBids : undefined;

/** Every auto-bid maximum a client ever received, in welcome and update messages. */
const received = (c: TestClient): number[] => [
  ...new Set(
    c.msgs.flatMap((m) =>
      (m.t === "welcome" || m.t === "update") && m.state
        ? Object.values(autoBidsOf(m.state) ?? {})
        : [],
    ),
  ),
];

describe("auto-bid privacy over the wire", () => {
  it("sends every client only their own maximum, in welcome and in updates", async () => {
    const anna = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const ben = await joinGame(ts, anna, "Ben");
    const carl = await joinGame(ts, anna, "Carl");
    await startGame(ts, anna);
    const a = await TestClient.join(ts, anna);
    const b = await TestClient.join(ts, ben);
    const c = await TestClient.join(ts, carl);
    const spectator = await TestClient.join(ts, { gameId: anna.gameId, token: null });

    // Anna rolls onto tile 3 and declines: auction, bidding order Ben, Carl, Anna
    await ts.api("POST", `/api/test/games/${anna.gameId}/dice`, { sequence: [[2, 1]] });
    a.act({ type: "roll" });
    await a.untilState((s) => s.phase.type === "await-buy");
    a.act({ type: "decline-buy" });
    await b.untilState((s) => s.phase.type === "auction");
    b.act({ type: "bid", amount: 20 });
    c.act({ type: "set-auto-bid", max: CARL_MAX }); // Carl's turn: bids 30 at once
    await c.untilState((s) => autoBidsOf(s)?.[carl.playerId] === CARL_MAX);
    a.act({ type: "set-auto-bid", max: ANNA_MAX }); // Anna's turn: bids 40, then waits for Ben
    await a.untilState((s) => autoBidsOf(s)?.[anna.playerId] === ANNA_MAX);
    await b.untilState((s) => s.phase.type === "auction" && s.phase.auction.highestBid === 40);
    await spectator.untilState(
      (s) => s.phase.type === "auction" && s.phase.auction.highestBid === 40,
    );

    expect(autoBidsOf(a.state)).toEqual({ [anna.playerId]: ANNA_MAX });
    expect(autoBidsOf(c.state)).toEqual({ [carl.playerId]: CARL_MAX });
    expect(autoBidsOf(b.state)).toBeUndefined();
    expect(autoBidsOf(spectator.state)).toBeUndefined();

    expect(received(a)).toEqual([ANNA_MAX]);
    expect(received(c)).toEqual([CARL_MAX]);
    expect(received(b)).toEqual([]);
    expect(received(spectator)).toEqual([]);

    // a reconnecting client gets a redacted welcome, too
    const ben2 = await TestClient.join(ts, ben);
    const anna2 = await TestClient.join(ts, anna);
    expect(autoBidsOf(ben2.state)).toBeUndefined();
    expect(received(ben2)).toEqual([]);
    expect(autoBidsOf(anna2.state)).toEqual({ [anna.playerId]: ANNA_MAX });
    expect(received(anna2)).toEqual([ANNA_MAX]);

    // the game still works: Ben passes, Carl's and Anna's auto-bids fight it out
    b.act({ type: "pass-auction" });
    await a.untilState((s) => s.phase.type !== "auction");
    expect(a.state?.properties[3]?.owner).toBe(anna.playerId); // 777 beats 555
    expect(received(b)).toEqual([]);

    for (const x of [a, b, c, spectator, ben2, anna2]) {
      await x.close();
    }
  });
});
