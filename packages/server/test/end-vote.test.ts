import { afterEach, describe, expect, it } from "vitest";
import { settle, sleep, startTestServer, startedTable } from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer | null = null;
afterEach(async () => {
  await ts?.dispose();
  ts = null;
});

const START_CASH = 1500;

describe("9. vote to end the game", () => {
  it("two humans and a bot: the bot agrees automatically, the second human decides; everybody gets the same ranking", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const t = await startedTable(ts, { settings: { startingCash: START_CASH, turnTimeoutSec: 0 } });

    t.a.act({ type: "propose-end-game" });
    const pending = await t.b.untilState((s) => s.endVote !== undefined);
    const bot = pending.players.find((p) => p.controller === "bot");
    expect(pending.endVote).toMatchObject({ by: t.host.playerId, expiresAt: null });
    expect(pending.endVote?.votes[bot?.id ?? ""]).toBe(true);
    expect(pending.endVote?.votes[t.friend.playerId]).toBeUndefined();
    // spectators and everyone else see the same public vote
    expect((await t.a.untilState((s) => s.endVote !== undefined)).endVote).toEqual(pending.endVote);

    t.b.act({ type: "vote-end-game", accept: true });
    const over = await t.a.untilState((s) => s.status === "finished");
    await settle([t.a, t.b]);
    expect(t.b.state).toEqual(t.a.state);
    expect(over.endVote).toBeUndefined();
    expect(over.phase.type).toBe("game-over");
    if (over.phase.type !== "game-over") {
      throw new Error("unreachable");
    }
    expect(over.phase.reason).toBe("vote");
    expect(over.phase.results).toHaveLength(3);
    expect(over.phase.results?.[0]?.playerId).toBe(over.phase.winner);
    expect(t.a.errors()).toEqual([]);
    expect(t.b.errors()).toEqual([]);
    const lobby = (await ts.api<{ status: string }>("GET", `/api/games/${t.host.gameId}`)).json;
    expect(lobby.status).toBe("finished");
  }, 20_000);

  it("a refusal cancels the vote, the game goes on and the proposer must wait a round", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const t = await startedTable(ts, { settings: { turnTimeoutSec: 0 } });
    t.a.act({ type: "propose-end-game" });
    await t.b.untilState((s) => s.endVote !== undefined);
    t.b.act({ type: "vote-end-game", accept: false });
    const after = await t.a.untilState((s) => s.endVote === undefined);
    expect(after.status).toBe("running");
    expect(after.log.at(-1)?.msg?.key).toBe("log.endVoteDeclined");
    const m = t.a.mark();
    t.a.act({ type: "propose-end-game" });
    await t.a.until((x) => x.t === "error", 3000, m);
    expect(t.a.errors(m)).toEqual([
      "Das Spielende kann erst in der nächsten Runde wieder beantragt werden",
    ]);
    expect(t.a.state?.endVote).toBeUndefined();
  }, 20_000);

  it("expires on time: a silent player counts as no and the server timer ends the vote exactly at expiresAt", async () => {
    ts = await startTestServer({ botDelayMs: 5_000 });
    const timeoutSec = 2;
    const t = await startedTable(ts, {
      bots: [],
      settings: { turnTimeoutSec: timeoutSec, awayAfterMissedTurns: 10 },
    });
    await sleep(1_200);
    // Ben proposes while it is Anna's turn: his action does not push the turn deadline back
    t.b.act({ type: "propose-end-game" });
    const pending = await t.a.untilState((s) => s.endVote !== undefined);
    const expiresAt = pending.endVote?.expiresAt ?? 0;
    expect(expiresAt).toBeGreaterThan(Date.now());
    const cleared = await t.a.untilState((s) => s.endVote === undefined, 4_000);
    // the vote is dropped by its own wake-up, not by the next turn timeout (~0.8s later)
    expect(Date.now() - expiresAt).toBeLessThan(600);
    expect(cleared.status).toBe("running");
    expect(cleared.log.some((l) => l.msg?.key === "log.endVoteExpired")).toBe(true);
  }, 20_000);
});
