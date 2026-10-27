// What the server persists per game next to the engine state: the lobby (settings, seats, hashed
// tokens). Validated on every load (docs/DESIGN.md #13/#43); drift-checked against the interfaces.
import { z } from "zod";
import { ChatSettingsSchema, DEFAULT_CHAT_SETTINGS } from "./chat.ts";
import type { ChatSettings } from "./chat.ts";
import { GameSettingsSchema } from "./schemas.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import type { BotLevel, GameSettings, PlayerId } from "./types.ts";

export interface StoredSeat {
  playerId: PlayerId;
  name: string;
  color: string;
  tokenId: string;
  kind: "human" | "bot";
  botLevel: BotLevel;
  isHost: boolean;
  /** sha256 hex of the player token (empty for bots) */
  tokenHash: string;
}

export interface StoredLobby {
  gameId: string;
  inviteCode: string;
  status: "lobby" | "running" | "finished";
  settings: GameSettings;
  seats: StoredSeat[];
  maxPlayers: number;
  createdAt: number;
  /** host's chat controls (docs/DESIGN.md #69) */
  chat: ChatSettings;
}

export const StoredSeatSchema = z.object({
  playerId: z.string().min(1).max(16),
  name: z.string().max(100),
  color: z.string().max(32),
  tokenId: z.string().max(64),
  kind: z.enum(["human", "bot"]),
  botLevel: z.enum(["easy", "normal", "hard"]),
  isHost: z.boolean(),
  tokenHash: z.string().max(128),
});

export const StoredLobbySchema = z.object({
  gameId: z.string().min(1).max(64),
  inviteCode: z.string().min(1).max(32),
  status: z.enum(["lobby", "running", "finished"]),
  // lobbies stored before the securities mode lack its two settings: they default (additive field)
  settings: GameSettingsSchema.extend({
    securities: GameSettingsSchema.shape.securities.default(DEFAULT_SETTINGS.securities),
    securitiesLockRounds: GameSettingsSchema.shape.securitiesLockRounds.default(
      DEFAULT_SETTINGS.securitiesLockRounds,
    ),
    // lobbies stored before the dividends: on, like for a new game (nothing has been played yet)
    securitiesDividends: GameSettingsSchema.shape.securitiesDividends.default(
      DEFAULT_SETTINGS.securitiesDividends,
    ),
    // lobbies stored before the show-off mode: off, the default of a new game
    loans: GameSettingsSchema.shape.loans.default(DEFAULT_SETTINGS.loans),
  }),
  seats: z.array(StoredSeatSchema).max(8),
  maxPlayers: z.number().int().min(2).max(8),
  createdAt: z.number(),
  // lobbies stored before the chat controls existed: free chat, nobody muted (additive field)
  chat: ChatSettingsSchema.default(() => ({ ...DEFAULT_CHAT_SETTINGS, muted: [] })),
});

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type StoredSchemaContractChecks = [
  Assert<Equals<z.infer<typeof StoredSeatSchema>, StoredSeat>>,
  Assert<Equals<z.infer<typeof StoredLobbySchema>, StoredLobby>>,
];
