import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, createGame, netWorthBreakdown, redactState } from "@poly/engine";
import type { GameState, NewPlayer, PublicGameState } from "@poly/engine";
import { breakdownLines, resultsOf } from "../src/game/results.ts";

const seats: NewPlayer[] = ["Anna", "Ben"].map((name, i) => ({
  id: `p${i}`,
  name,
  color: "#fff",
  tokenId: `t${i}`,
  controller: "human",
  botLevel: "normal",
}));

function finished(withResults: boolean): PublicGameState {
  const s: GameState = createGame("g", seats, DEFAULT_SETTINGS, 1, 1000).state;
  const ben = s.players[1];
  if (ben) {
    ben.cash = 5000;
  }
  s.status = "finished";
  s.phase = withResults
    ? {
        type: "game-over",
        winner: "p1",
        reason: "vote",
        results: [
          { playerId: "p1", rank: 1, bankrupt: false, ...netWorthBreakdown(s, "p1") },
          { playerId: "p0", rank: 2, bankrupt: false, ...netWorthBreakdown(s, "p0") },
        ],
      }
    : { type: "game-over", winner: "p1" };
  return redactState(s);
}

describe("resultsOf", () => {
  it("returns the ranking the engine stored", () => {
    expect(resultsOf(finished(true)).map((r) => r.playerId)).toEqual(["p1", "p0"]);
  });

  it("ranks games that finished before results existed by net worth", () => {
    const r = resultsOf(finished(false));
    expect(r.map((x) => [x.playerId, x.rank])).toEqual([
      ["p1", 1],
      ["p0", 2],
    ]);
    expect(r[0]?.total).toBe(5000);
  });

  it("is empty while the game is running", () => {
    const s = createGame("g", seats, DEFAULT_SETTINGS, 1, 1000).state;
    expect(resultsOf(redactState(s))).toEqual([]);
  });
});

describe("net worth breakdown lines on the results screen", () => {
  const base = {
    playerId: "p0",
    rank: 1,
    bankrupt: false,
    cash: 100,
    properties: 200,
    buildings: 50,
    mortgages: -30,
    total: 320,
  };

  it("shows cash, properties, buildings and mortgages", () => {
    expect(breakdownLines(base).map(([key]) => key)).toEqual([
      "results.cash",
      "results.properties",
      "results.buildings",
      "results.mortgages",
    ]);
  });

  it("adds the securities line when the game had the securities mode on", () => {
    const lines = breakdownLines({ ...base, securities: 800, total: 1120 });
    expect(lines).toContainEqual(["results.securities", 800]);
  });
});
