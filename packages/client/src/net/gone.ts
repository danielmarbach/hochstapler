// A game that was deleted by the retention sweep (docs/DESIGN.md #57) or never existed: recognised from the
// WebSocket close code of the sweep or from the server's "game not found" answer (hello / REST).
import { WS_CLOSE_GAME_EXPIRED } from "@poly/engine";
import { UI_MESSAGES } from "../i18n/index.ts";

export const isGameGoneClose = (code: number): boolean => code === WS_CLOSE_GAME_EXPIRED;

/** The server sends the German text; it is matched verbatim (same convention as the other srv.* messages). */
export const isGameNotFoundMessage = (message: string): boolean =>
  message === UI_MESSAGES.de["srv.gameNotFound"];
