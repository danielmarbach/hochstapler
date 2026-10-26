import { BOARD } from "../src/board.ts";
import { createGame, applyAction } from "../src/game.ts";
import { rollDie } from "../src/rng.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { GameAction, GameSettings, GameState, NewPlayer } from "../src/types.ts";

export function players(n: number, controller: "human" | "bot" = "human"): NewPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    color: "#fff",
    tokenId: `t${i}`,
    controller,
    botLevel: "normal" as const,
  }));
}

export function mk(
  n = 3,
  over: Partial<GameSettings> = {},
  controller: "human" | "bot" = "human",
): GameState {
  return createGame("g", players(n, controller), { ...DEFAULT_SETTINGS, ...over }, 12345, 1000)
    .state;
}

/** Set the rng so that the next roll yields (a, b). */
export function rig(s: GameState, a: number, b: number): GameState {
  const c = structuredClone(s);
  for (let r = 1; r < 200000; r++) {
    const x = rollDie(r);
    if (x.value !== a) {
      continue;
    }
    const y = rollDie(x.rng);
    if (y.value === b) {
      c.rng = r;
      return c;
    }
  }
  throw new Error("no rng found");
}

export function act(s: GameState, pid: string, a: GameAction, now = 2000): GameState {
  return applyAction(s, pid, a, now).state;
}

/** Give `pid` all street tiles of `group`. */
export function give(s: GameState, pid: string, tiles: number[]): void {
  for (const t of tiles) {
    s.properties[t]!.owner = pid;
  }
}

export function groupOf(g: number): number[] {
  return BOARD.filter((t) => t.group === g).map((t) => t.index);
}
