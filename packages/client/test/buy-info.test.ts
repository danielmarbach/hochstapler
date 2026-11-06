// Buy offer: what the player needs to decide (rent, group progress, cash after buying), derived from the engine.
import { describe, expect, it } from "vitest";
import {
  BOARD,
  DEFAULT_SETTINGS,
  STATION_TILES,
  UTILITY_TILES,
  createGame,
  groupTiles,
  rentFor,
  type GameState,
} from "@poly/engine";
import { buyInfo } from "../src/ui/buy-info.ts";

function game(): GameState {
  const player = (id: string, name: string) => ({
    id,
    name,
    color: "#fff",
    tokenId: "a",
    controller: "human" as const,
    botLevel: "normal" as const,
  });
  return createGame("g", [player("p0", "Anna"), player("p1", "Ben")], DEFAULT_SETTINGS, 1, 1000)
    .state;
}

function own(state: GameState, playerId: string, tile: number): void {
  state.properties[tile] = { owner: playerId, level: 0, mortgaged: false };
}

function firstTile(group: number): number {
  const tile = groupTiles(group)[0];
  if (tile === undefined) {
    throw new Error("empty group");
  }
  return tile;
}

describe("buyInfo (buy offer)", () => {
  it("a street: base rent, first stamp of its group, cash after paying the price", () => {
    const state = game();
    const tile = firstTile(0);
    const info = buyInfo(state, "p0", tile);
    expect(info).toMatchObject({
      kind: "street",
      rent: BOARD[tile]?.rent?.[0],
      owned: 1,
      total: groupTiles(0).length,
      complete: false,
      cashAfter: 2000 - (BOARD[tile]?.price ?? 0),
    });
  });

  it("a street that completes the colour set counts the stamps already held and shows the bonus rent", () => {
    const state = game();
    const tiles = groupTiles(0);
    for (const t of tiles.slice(1)) {
      own(state, "p0", t);
    }
    const tile = firstTile(0);
    const info = buyInfo(state, "p0", tile);
    expect(info?.owned).toBe(tiles.length);
    expect(info?.complete).toBe(true);
    expect(info?.rent).toBe((BOARD[tile]?.rent?.[0] ?? 0) * 2);
  });

  it("stamps of other players do not count", () => {
    const state = game();
    const tiles = groupTiles(0);
    for (const t of tiles.slice(1)) {
      own(state, "p1", t);
    }
    expect(buyInfo(state, "p0", firstTile(0))).toMatchObject({ owned: 1, complete: false });
  });

  it("a station: the rent grows with the stations already owned", () => {
    const state = game();
    const [first, second] = STATION_TILES;
    if (first === undefined || second === undefined) {
      throw new Error("no stations");
    }
    own(state, "p0", first);
    const info = buyInfo(state, "p0", second);
    expect(info).toMatchObject({ kind: "station", owned: 2, total: STATION_TILES.length });
    const after = structuredClone(state);
    own(after, "p0", second);
    expect(info?.rent).toBe(rentFor(after, second, 0));
  });

  it("a utility: the rent is a multiple of the dice roll", () => {
    const state = game();
    const tile = UTILITY_TILES[0];
    if (tile === undefined) {
      throw new Error("no utilities");
    }
    const info = buyInfo(state, "p0", tile);
    expect(info).toMatchObject({ kind: "utility", owned: 1, total: UTILITY_TILES.length });
    const after = structuredClone(state);
    own(after, "p0", tile);
    expect(info?.rent).toBe(rentFor(after, tile, 1));
  });

  it("is null for a tile that cannot be bought and for an unknown player", () => {
    const state = game();
    expect(buyInfo(state, "p0", 0)).toBeNull();
    expect(buyInfo(state, "nobody", firstTile(0))).toBeNull();
  });

  it("does not change the game state", () => {
    const state = game();
    const before = structuredClone(state);
    buyInfo(state, "p0", firstTile(0));
    expect(state).toEqual(before);
  });
});
