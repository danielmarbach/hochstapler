// Random (schema-valid, mostly illegal) action fuzz through the real WebSocket path.
// Properties: the server never crashes, illegal actions leave the state byte-identical, legal ones advance the version
// by exactly one, errors are proper game messages (no leaked JS exceptions) and every state satisfies the invariants.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GameAction, PublicGameState, TradeOffer } from "@poly/engine";
import {
  Brain,
  TestClient,
  invariantViolations,
  mulberry,
  startTestServer,
  startedTable,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
});

const LEAK =
  /undefined|TypeError|ReferenceError|RangeError|Cannot read|is not a function|NaN|\[object|null\b/;

function randomAction(
  rnd: () => number,
  s: PublicGameState,
  me: string,
  other: string,
): GameAction {
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T>(xs: T[]): T => xs[int(xs.length)]!;
  const mine = s.players.find((p) => p.id === me)!;
  const amount = () => pick([0, 1, 5, 50, mine.cash, mine.cash + 1, 999_999, int(300)]);
  const tile = () => pick([int(52), int(52), 0, 13, 39, 51]);
  const tiles = () => Array.from({ length: int(3) }, tile);
  const tradeId = () =>
    s.trades.length && rnd() < 0.8 ? pick(s.trades).id : pick(["t1", "x", "t999"]);
  const offer = (): TradeOffer => ({
    to: rnd() < 0.9 ? other : pick([me, "p9", "bank"]),
    giveCash: amount(),
    giveTiles: tiles(),
    giveJailCards: int(3),
    wantCash: amount(),
    wantTiles: tiles(),
    wantJailCards: int(3),
  });
  const kinds: GameAction[] = [
    { type: "roll" },
    { type: "pay-jail-fine" },
    { type: "use-jail-card" },
    { type: "buy" },
    { type: "decline-buy" },
    { type: "bid", amount: amount() },
    { type: "pass-auction" },
    { type: "build", tile: tile() },
    { type: "sell-building", tile: tile() },
    { type: "mortgage", tile: tile() },
    { type: "unmortgage", tile: tile() },
    { type: "propose-trade", offer: offer() },
    { type: "respond-trade", tradeId: tradeId(), accept: rnd() < 0.5 },
    { type: "counter-trade", tradeId: tradeId(), offer: offer() },
    { type: "cancel-trade", tradeId: tradeId() },
    { type: "end-turn" },
    { type: "declare-bankruptcy" },
  ];
  return pick(kinds);
}

async function roundTrip(
  c: TestClient,
  action: GameAction,
): Promise<{ error: string | null; update: boolean }> {
  const m = c.mark();
  c.act(action);
  // quick message as the fence: the room answers a socket's messages in order, and its content cannot trip the filters
  c.send({ t: "quick-chat", id: "e-smile" });
  await c.until((x) => x.t === "quick-chat" && x.from === c.you, 5000, m);
  const msgs = c.msgs.slice(m);
  const err = msgs.find((x) => x.t === "error");
  return {
    error: err && err.t === "error" ? err.message : null,
    update: msgs.some((x) => x.t === "update"),
  };
}

describe("action fuzz", () => {
  for (const seed of [1, 2, 3]) {
    it(`random actions, seed ${seed}`, async () => {
      const t = await startedTable(ts, { bots: [], settings: { startingCash: 700 } });
      const rnd = mulberry(seed * 977);
      const smartA = new Brain(t.host.playerId, seed, { extraRate: 0.6 });
      const smartB = new Brain(t.friend.playerId, seed + 100, { extraRate: 0.6 });
      const messages = new Set<string>();
      let applied = 0;
      for (let i = 0; i < 700 && t.a.state!.status === "running"; i++) {
        const [me, other, c, smart] =
          i % 2 === 0
            ? [t.host.playerId, t.friend.playerId, t.a, smartA]
            : [t.friend.playerId, t.host.playerId, t.b, smartB];
        const before = JSON.stringify(c.state);
        const v = c.state!.version;
        const action =
          rnd() < 0.5
            ? (smart.decide(c.state!) ?? randomAction(rnd, c.state!, me, other))
            : randomAction(rnd, c.state!, me, other);
        const r = await roundTrip(c, action);
        // both clients converge on the same state before the next step
        await t.a.untilState((s) => s.version === (r.update ? v + 1 : v), 2000);
        await t.b.untilState((s) => s.version === (r.update ? v + 1 : v), 2000);
        if (r.error !== null) {
          messages.add(r.error);
          expect(r.update, `${JSON.stringify(action)} errored but produced an update`).toBe(false);
          expect(
            JSON.stringify(c.state),
            `${JSON.stringify(action)} errored but changed the state`,
          ).toBe(before);
        } else {
          expect(r.update, `${JSON.stringify(action)} neither errored nor updated`).toBe(true);
          applied++;
        }
        expect(t.a.state).toEqual(t.b.state);
      }
      expect(applied).toBeGreaterThan(30);
      expect([...messages].filter((m) => LEAK.test(m))).toEqual([]);
      expect(
        t.a
          .updates()
          .flatMap((u) => invariantViolations(u.state))
          .slice(0, 5),
      ).toEqual([]);
      await Promise.all([t.a.close(), t.b.close()]);
    }, 60_000);
  }
});
