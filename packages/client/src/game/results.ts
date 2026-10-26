import { rankPlayers } from "@poly/engine";
import type { GameState, PlayerResult, PublicGameState } from "@poly/engine";

/**
 * The final ranking, best first. The engine stores it on the game-over phase; games that finished
 * before that field existed are ranked from their final state (same rules). Empty while running.
 */
export function resultsOf(state: PublicGameState): PlayerResult[] {
  const ph = state.phase;
  if (ph.type !== "game-over") {
    return [];
  }
  // the ranking only reads players and properties, which the public state carries in full
  return ph.results ?? rankPlayers(state as unknown as GameState);
}

/** Lines of the net worth breakdown on the results screen; securities only when the mode was on. */
export type BreakdownKey =
  | "results.cash"
  | "results.properties"
  | "results.buildings"
  | "results.mortgages"
  | "results.securities";

export function breakdownLines(result: PlayerResult): (readonly [BreakdownKey, number])[] {
  const lines: (readonly [BreakdownKey, number])[] = [
    ["results.cash", result.cash],
    ["results.properties", result.properties],
    ["results.buildings", result.buildings],
    ["results.mortgages", result.mortgages],
  ];
  if (result.securities !== undefined) {
    lines.push(["results.securities", result.securities]);
  }
  return lines;
}
