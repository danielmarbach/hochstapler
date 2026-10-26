// Wire protocol between client and server (JSON over WebSocket + REST).
import type { ChatRejectReason, ChatSettings, QuickChatId } from "./chat.ts";
import type {
  BotLevel,
  GameAction,
  GameEvent,
  GameSettings,
  GameState,
  PlayerId,
} from "./types.ts";

/** GameState with rng and deck order removed. */
export type PublicGameState = Omit<GameState, "rng" | "decks"> & {
  decks: { chance: number; community: number };
};

export interface LobbySeat {
  playerId: PlayerId;
  name: string;
  color: string;
  tokenId: string;
  kind: "human" | "bot";
  botLevel: BotLevel;
  connected: boolean;
  isHost: boolean;
}

export interface LobbyInfo {
  gameId: string;
  status: "lobby" | "running" | "finished";
  settings: GameSettings;
  seats: LobbySeat[];
  maxPlayers: number;
  createdAt: number;
  /** chat mode and muted players (public: spectators see the mode, never the lines) */
  chat: ChatSettings;
}

// ---- REST ----
// POST /api/games            body CreateGameRequest  -> JoinResponse (& inviteCode)
// GET  /api/games/:id        -> LobbyInfo
// POST /api/games/:id/join   body JoinGameRequest    -> JoinResponse
// POST /api/games/:id/bots   body { botLevel } header x-player-token (host) -> LobbyInfo
// DELETE /api/games/:id/seats/:playerId  (host, lobby only) -> LobbyInfo
// PATCH /api/games/:id/settings body Partial<GameSettings> (host, lobby only) -> LobbyInfo
// PATCH /api/games/:id/chat body ChatUpdateRequest (host, any time) -> LobbyInfo
// PATCH /api/games/:id/seats/me body SeatUpdateRequest (own seat, lobby only) -> LobbyInfo; 409 if the piece is taken
// POST /api/games/:id/start  header x-player-token (host) -> LobbyInfo
// POST /api/games/:id/seats/me/token  header x-player-token (own seat) -> RotateTokenResponse; the old token dies,
//      the seat's sockets are closed with 4001 "token rotated" (reconnect with the new token)
// GET  /api/themes           -> { id, name, flag }[]

export interface CreateGameRequest {
  hostName: string;
  settings: Partial<GameSettings>;
  bots: BotLevel[];
  maxPlayers: number;
  /** the host's game piece (an id of the chosen theme); omitted = the first one */
  tokenId?: string;
}

export interface JoinGameRequest {
  name: string;
  inviteCode: string;
  tokenId?: string;
}

export interface JoinResponse {
  gameId: string;
  playerId: PlayerId;
  playerToken: string;
  inviteCode: string;
}

/** Body of the piece change: the id of one of the theme's tokens (the seat is the one of the x-player-token header). */
export interface SeatUpdateRequest {
  tokenId: string;
}

/** Body of the token rotation: nothing (the seat is the one of the x-player-token header). */
export type RotateTokenRequest = Record<string, never>;

export interface RotateTokenResponse {
  playerToken: string;
}

/** WebSocket close code + reason for sockets of a seat whose token was rotated. */
export const WS_CLOSE_TOKEN_ROTATED = 4001;
export const WS_CLOSE_TOKEN_ROTATED_REASON = "token rotated";

/** WebSocket close code + reason for sockets of a game that was deleted by the data retention sweep (DESIGN #57). */
export const WS_CLOSE_GAME_EXPIRED = 4404;
export const WS_CLOSE_GAME_EXPIRED_REASON = "game expired";

/**
 * WebSocket close code + reason when this server instance stops serving because another one takes over the database
 * (writer-lease handover, DESIGN #89) or it lost the lease: reconnect shortly, nothing is wrong.
 */
export const WS_CLOSE_HANDOVER = 4503;
export const WS_CLOSE_HANDOVER_REASON = "handover, reconnect";

// ---- WebSocket: ws(s)://host/ws ----
export type ClientMessage =
  | { t: "hello"; gameId: string; playerToken: string | null }
  | { t: "action"; action: GameAction }
  | { t: "chat"; text: string }
  | { t: "quick-chat"; id: QuickChatId }
  | { t: "ping" };

export type ServerMessage =
  | {
      t: "welcome";
      you: PlayerId | null;
      lobby: LobbyInfo;
      state: PublicGameState | null;
      /** id of the deployed build (dist/version.json, "dev" in development); a client with another id reloads */
      build: string;
    }
  | { t: "lobby"; lobby: LobbyInfo }
  | { t: "update"; state: PublicGameState; events: GameEvent[] }
  | { t: "error"; message: string }
  | { t: "chat"; from: PlayerId; name: string; text: string; at: number }
  | { t: "quick-chat"; from: PlayerId; name: string; id: QuickChatId; at: number }
  | { t: "chat-rejected"; reason: ChatRejectReason }
  | { t: "presence"; connected: PlayerId[] }
  | { t: "pong" };
