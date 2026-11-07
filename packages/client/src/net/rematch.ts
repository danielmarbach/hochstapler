// The rematch call of the results screen. Opening the rematch lobby creates a game, so it carries a solved proof of
// work like the create form (docs/DESIGN.md #70, #102); taking a seat in a lobby that is already open needs none.
import { attempt } from "@poly/engine";
import type { JoinResponse } from "@poly/engine";
import { api } from "./api.ts";
import { isPowRefusal, startPow, withPow } from "./pow.ts";
import type { PowTicket } from "./pow.ts";

/**
 * `lobbyOpen`: the old game announced a rematch lobby. The join is tried without a proof first; when the server
 * asks for one anyway (the lobby it linked is gone, so this call creates a new one), it is solved and sent.
 */
export async function enterRematch(
  gameId: string,
  lobbyOpen: boolean,
  startTicket: () => PowTicket = startPow,
): Promise<JoinResponse> {
  if (lobbyOpen) {
    const joined = await attempt("rematch:join", () => api.rematch(gameId));
    if (joined.ok) return joined.value;
    if (!isPowRefusal(joined.error)) throw joined.error;
  }
  let ticket: PowTicket | null = null;
  return withPow(
    () => (ticket ??= startTicket()),
    () => {
      ticket?.cancel();
      ticket = null;
    },
    (header) => api.rematch(gameId, undefined, header),
  );
}
