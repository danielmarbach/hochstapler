// Pure logic of the game piece picker (docs/DESIGN.md #75).
import type { LobbySeat } from "@poly/engine";

/** token id -> name of the player holding it, for every seat except `exceptPlayerId` (the viewer). */
export function takenTokens(
  seats: readonly Pick<LobbySeat, "playerId" | "tokenId" | "name">[],
  exceptPlayerId?: string,
): Map<string, string> {
  return new Map(
    seats.filter((s) => s.playerId !== exceptPlayerId).map((s) => [s.tokenId, s.name]),
  );
}

/**
 * The piece to show as chosen: the wish if it is still possible (in the theme and not taken), otherwise the first
 * free piece. null only when every piece is taken (a full table of 8 viewed by a guest cannot happen: max 8 seats).
 */
export function effectiveToken(
  themeTokenIds: readonly string[],
  taken: ReadonlyMap<string, string>,
  wish: string | null,
): string | null {
  if (wish !== null && themeTokenIds.includes(wish) && !taken.has(wish)) return wish;
  return themeTokenIds.find((id) => !taken.has(id)) ?? null;
}
