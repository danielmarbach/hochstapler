// Rules every trade offer (original or counteroffer) must satisfy. Shared by the reducer (game.ts)
// and the bots (bot.ts), which must not propose anything the reducer would refuse.
import { makeMsg } from "./i18n/index.ts";
import type { EngineMsg } from "./i18n/index.ts";
import { groupHasBuildings, isBuyable, propState, tileDef } from "./helpers.ts";
import type { GameState, PlayerId, TradeOffer } from "./types.ts";

export function mortgageInterest(tile: number): number {
  return Math.ceil((tileDef(tile).mortgage ?? 0) / 10);
}

/** Returns the problem as structured message or null. checkCash=false skips affordability (used for sweeping). */
export function tradeProblem(
  s: GameState,
  t: TradeOffer & { from: PlayerId },
  checkCash: boolean,
): EngineMsg | null {
  const from = s.players.find((p) => p.id === t.from);
  const to = s.players.find((p) => p.id === t.to);
  if (!from || !to || from.bankrupt || to.bankrupt) {
    return makeMsg("err.playerInactive");
  }
  if (from.id === to.id) {
    return makeMsg("err.tradeSelf");
  }
  const ints = [t.giveCash, t.wantCash, t.giveJailCards, t.wantJailCards];
  if (ints.some((n) => !Number.isInteger(n) || n < 0)) {
    return makeMsg("err.tradeInvalidAmount");
  }
  if (
    t.giveTiles.length +
      t.wantTiles.length +
      t.giveCash +
      t.wantCash +
      t.giveJailCards +
      t.wantJailCards ===
    0
  ) {
    return makeMsg("err.tradeEmpty");
  }
  const checkTiles = (tiles: number[], owner: PlayerId): EngineMsg | null => {
    if (new Set(tiles).size !== tiles.length) {
      return makeMsg("err.tradeDuplicateTile");
    }
    for (const i of tiles) {
      if (!Number.isInteger(i) || !isBuyable(i)) {
        return makeMsg("err.tradeInvalidTile");
      }
      if (propState(s, i).owner !== owner) {
        return makeMsg("err.tradeNotOwner");
      }
      const g = tileDef(i).group;
      if (g !== undefined && groupHasBuildings(s, g)) {
        return makeMsg("err.tradeGroupBuilt");
      }
    }
    return null;
  };
  const e = checkTiles(t.giveTiles, from.id) ?? checkTiles(t.wantTiles, to.id);
  if (e) {
    return e;
  }
  if (t.giveJailCards > from.jailCards.length || t.wantJailCards > to.jailCards.length) {
    return makeMsg("err.tradeMissingJailCard");
  }
  if (checkCash) {
    const fromInterest = t.wantTiles
      .filter((i) => propState(s, i).mortgaged)
      .reduce((a, i) => a + mortgageInterest(i), 0);
    const toInterest = t.giveTiles
      .filter((i) => propState(s, i).mortgaged)
      .reduce((a, i) => a + mortgageInterest(i), 0);
    if (from.cash - t.giveCash + t.wantCash - fromInterest < 0) {
      return makeMsg("err.tradeProposerCash");
    }
    if (to.cash + t.giveCash - t.wantCash - toInterest < 0) {
      return makeMsg("err.tradeRecipientCash");
    }
  }
  return null;
}
