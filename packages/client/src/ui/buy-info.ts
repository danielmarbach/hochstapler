// What the buy offer shows next to the price (docs/DESIGN.md): the rent, the stamp progress and the cash left.
// The numbers come from the engine on a copy of the state in which the player already owns the tile.
import {
  BOARD,
  STATION_TILES,
  UTILITY_TILES,
  groupTiles,
  priceOf,
  rentFor,
  type GameState,
} from "@poly/engine";

export interface BuyInfo {
  kind: "street" | "station" | "utility";
  /** street/station: rent a visitor pays once the tile is bought (colour-set bonus included); utility: multiple of the dice roll */
  rent: number;
  /** colour group (street) or kind (station, utility); the number of stamps of it the player holds after buying */
  group: number | null;
  owned: number;
  total: number;
  /** the player holds every tile of the group after buying */
  complete: boolean;
  cashAfter: number;
}

export function buyInfo(state: GameState, playerId: string, tile: number): BuyInfo | null {
  const def = BOARD[tile];
  const me = state.players.find((p) => p.id === playerId);
  if (!def || !me || (def.kind !== "street" && def.kind !== "station" && def.kind !== "utility")) {
    return null;
  }
  const after: GameState = {
    ...state,
    properties: {
      ...state.properties,
      [tile]: { owner: playerId, level: 0, mortgaged: false },
    },
  };
  const tiles =
    def.kind === "street"
      ? groupTiles(def.group ?? 0)
      : def.kind === "station"
        ? STATION_TILES
        : UTILITY_TILES;
  const owned = tiles.filter((i) => after.properties[i]?.owner === playerId).length;
  return {
    kind: def.kind,
    // one die pip: a utility's rent is its multiplier times the dice total
    rent: rentFor(after, tile, 1),
    group: def.kind === "street" ? (def.group ?? 0) : null,
    owned,
    total: tiles.length,
    complete: owned === tiles.length,
    cashAfter: me.cash - priceOf(def),
  };
}
