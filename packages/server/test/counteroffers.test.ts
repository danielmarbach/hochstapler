import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_COUNTERS } from "@poly/engine";
import type { TradeOffer } from "@poly/engine";
import { TestClient, settle, startTestServer, startedTable } from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
});

const cash = (to: string, give: number, want: number): TradeOffer => ({
  to,
  giveCash: give,
  giveTiles: [],
  giveJailCards: 0,
  wantCash: want,
  wantTiles: [],
  wantJailCards: 0,
});

describe("counteroffers over the wire", () => {
  it("links the counteroffer, shows every viewer the same trades and settles on accept", async () => {
    const t = await startedTable(ts);
    const spec = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    // Anna offers Ben 100 for 20; Ben asks for 140 in return for the same 20
    t.a.act({ type: "propose-trade", offer: cash(t.friend.playerId, 100, 20) });
    const first = (await t.b.untilState((s) => s.trades.some((x) => x.status === "pending")))
      .trades[0];
    expect(first).toBeDefined();
    t.b.act({
      type: "counter-trade",
      tradeId: first?.id ?? "",
      offer: cash(t.host.playerId, 20, 140),
    });
    const s = await t.a.untilState((st) => st.trades.length === 2);
    await settle([t.a, t.b, spec]);
    expect(s.trades.map((x) => x.status)).toEqual(["countered", "pending"]);
    expect(s.trades[1]?.counterOf).toBe(first?.id);
    expect(s.trades[1]?.counterDepth).toBe(1);
    // offers are public: players and spectators see the identical list (no redaction of trades)
    expect(t.b.state?.trades).toEqual(s.trades);
    expect(spec.state?.trades).toEqual(s.trades);

    const cashA = t.a.state?.players.find((p) => p.id === t.host.playerId)?.cash ?? 0;
    t.a.act({ type: "respond-trade", tradeId: s.trades[1]?.id ?? "", accept: true });
    const done = await t.a.untilState((st) => st.trades[1]?.status === "accepted");
    expect(done.players.find((p) => p.id === t.host.playerId)?.cash).toBe(cashA + 20 - 140);
    await Promise.all([spec.close(), t.a.close(), t.b.close()]);
  });

  it("refuses foreign, malformed and over-limit counteroffers without touching the state", async () => {
    const t = await startedTable(ts);
    const spec = await TestClient.join(ts, { gameId: t.host.gameId, token: null });
    t.a.act({ type: "propose-trade", offer: cash(t.friend.playerId, 10, 0) });
    const id =
      (await t.b.untilState((s) => s.trades.some((x) => x.status === "pending"))).trades[0]?.id ??
      "";
    await settle([t.a, t.b]);
    const v0 = t.a.state?.version ?? 0;
    const marks = [t.a, t.b, spec].map((c) => c.mark());
    const good = cash(t.host.playerId, 0, 30);

    // the proposer and a spectator cannot counter; a counter must go back to the proposer
    t.a.act({ type: "counter-trade", tradeId: id, offer: cash(t.friend.playerId, 0, 30) });
    spec.act({ type: "counter-trade", tradeId: id, offer: good });
    t.b.act({ type: "counter-trade", tradeId: id, offer: cash("p9", 0, 30) });
    t.b.act({ type: "counter-trade", tradeId: "nope", offer: good });
    // protocol validation (zod): missing/invalid offer fields never reach the engine
    t.b.sendRaw(`{"t":"action","action":{"type":"counter-trade","tradeId":"${id}"}}`);
    t.b.sendRaw(
      `{"t":"action","action":{"type":"counter-trade","tradeId":"${id}","offer":{"to":"${t.host.playerId}","giveCash":-1,"giveTiles":[],"giveJailCards":0,"wantCash":0,"wantTiles":[],"wantJailCards":0}}}`,
    );
    t.b.sendRaw(
      `{"t":"action","action":{"type":"counter-trade","tradeId":"${id}","offer":{"to":"${t.host.playerId}","giveCash":0,"giveTiles":[${"1,".repeat(40)}1],"giveJailCards":0,"wantCash":0,"wantTiles":[],"wantJailCards":0}}}`,
    );
    t.b.sendRaw(`{"t":"action","action":{"type":"counter-trade","tradeId":"","offer":null}}`);
    // empty counteroffer (engine rule)
    t.b.act({ type: "counter-trade", tradeId: id, offer: cash(t.host.playerId, 0, 0) });
    await settle([t.a, t.b, spec], 250);
    expect(t.a.errors(marks[0]).length).toBe(1);
    expect(spec.errors(marks[2]).length).toBe(1);
    expect(t.b.errors(marks[1]).length).toBe(7);
    expect(t.a.state?.version).toBe(v0);
    expect(t.a.state?.trades.map((x) => x.status)).toEqual(["pending"]);
    await Promise.all([spec.close(), t.a.close(), t.b.close()]);
  });

  it(`allows ${MAX_COUNTERS} counteroffers per negotiation, the next one is refused`, async () => {
    const t = await startedTable(ts);
    const players = [
      { c: t.a, id: t.host.playerId },
      { c: t.b, id: t.friend.playerId },
    ];
    t.a.act({ type: "propose-trade", offer: cash(t.friend.playerId, 50, 0) });
    let last = (await t.b.untilState((s) => s.trades.length === 1)).trades[0];
    for (let n = 1; n <= MAX_COUNTERS; n++) {
      const answering = players[n % 2];
      const other = players[(n + 1) % 2];
      expect(last?.to).toBe(answering?.id);
      answering?.c.act({
        type: "counter-trade",
        tradeId: last?.id ?? "",
        offer: cash(other?.id ?? "", 0, 10 * n),
      });
      const st = await (answering?.c ?? t.a).untilState((s) => s.trades.length === n + 1);
      last = st.trades[n];
    }
    expect(last?.counterDepth).toBe(MAX_COUNTERS);
    const answering = players[(MAX_COUNTERS + 1) % 2];
    const m = (answering?.c ?? t.a).mark();
    answering?.c.act({
      type: "counter-trade",
      tradeId: last?.id ?? "",
      offer: cash(players[MAX_COUNTERS % 2]?.id ?? "", 0, 5),
    });
    await (answering?.c ?? t.a).until((x) => x.t === "error", 2000, m);
    await settle([t.a, t.b]);
    expect(t.a.state?.trades).toHaveLength(MAX_COUNTERS + 1);
    expect(t.a.state?.trades.at(-1)?.status).toBe("pending");
    await Promise.all([t.a.close(), t.b.close()]);
  });
});
