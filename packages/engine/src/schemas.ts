// Runtime validation (zod) for everything that crosses the trust boundary client → server.
// The compile-time checks at the bottom guarantee the schemas match the TS contract in types.ts/protocol.ts.
import { z } from "zod";
import { MAX_CHAT_LENGTH, QuickChatIdSchema } from "./chat.ts";
import { MAX_LOCK_ROUNDS, MIN_LOCK_ROUNDS } from "./securities.ts";
import type { GameAction, GameSettings, TradeOffer } from "./types.ts";
import type {
  ClientMessage,
  CreateGameRequest,
  JoinGameRequest,
  RotateTokenRequest,
  SeatUpdateRequest,
  RotateTokenResponse,
} from "./protocol.ts";

const MAX_TILE = 51;
const MAX_CASH = 1_000_000;
const MAX_TIMEOUT_SEC = 7 * 24 * 60 * 60;
/** Floors for what a host may set (docs/DESIGN.md #61): 0 = off, otherwise at least this many seconds */
export const MIN_TURN_TIMEOUT_SEC = 30;
export const MIN_AWAY_AFTER_MISSED_TURNS = 2;
const MAX_NAME_LENGTH = 24;
/** generous bounds on the wire; the engine enforces the real limits (securities.ts) */
const MAX_SHARES_ORDER = 1_000;
const MAX_LOT_INDEX = 10_000;

const tile = z.number().int().min(0).max(MAX_TILE);
const cash = z.number().int().min(0).max(MAX_CASH);
const id = z.string().min(1).max(64);
const botLevel = z.enum(["easy", "normal", "hard"]);
const playerName = z.string().trim().min(1).max(MAX_NAME_LENGTH);

export const TradeOfferSchema = z.object({
  to: id,
  giveCash: cash,
  giveTiles: z.array(tile).max(32),
  giveJailCards: z.number().int().min(0).max(2),
  wantCash: cash,
  wantTiles: z.array(tile).max(32),
  wantJailCards: z.number().int().min(0).max(2),
});

export const GameActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll") }),
  z.object({ type: z.literal("pay-jail-fine") }),
  z.object({ type: z.literal("use-jail-card") }),
  z.object({ type: z.literal("buy") }),
  z.object({ type: z.literal("decline-buy") }),
  z.object({ type: z.literal("bid"), amount: cash }),
  z.object({ type: z.literal("pass-auction") }),
  z.object({ type: z.literal("set-auto-bid"), max: cash.nullable() }),
  z.object({ type: z.literal("build"), tile }),
  z.object({ type: z.literal("sell-building"), tile }),
  z.object({ type: z.literal("mortgage"), tile }),
  z.object({ type: z.literal("unmortgage"), tile }),
  z.object({ type: z.literal("propose-trade"), offer: TradeOfferSchema }),
  z.object({ type: z.literal("respond-trade"), tradeId: id, accept: z.boolean() }),
  z.object({ type: z.literal("counter-trade"), tradeId: id, offer: TradeOfferSchema }),
  z.object({ type: z.literal("cancel-trade"), tradeId: id }),
  z.object({
    type: z.literal("buy-securities"),
    secId: id,
    shares: z.number().int().min(1).max(MAX_SHARES_ORDER),
  }),
  z.object({
    type: z.literal("sell-securities"),
    secId: id,
    lot: z.union([z.number().int().min(0).max(MAX_LOT_INDEX), z.literal("all")]),
  }),
  z.object({ type: z.literal("end-turn") }),
  z.object({ type: z.literal("declare-bankruptcy") }),
  z.object({ type: z.literal("propose-end-game") }),
  z.object({ type: z.literal("vote-end-game"), accept: z.boolean() }),
]);

export const GameSettingsSchema = z.object({
  themeId: z.string().min(1).max(16),
  startingCash: z.number().int().min(500).max(10_000),
  goSalary: z.number().int().min(0).max(1_000),
  doubleOnGoLanding: z.boolean(),
  turnTimeoutSec: z.number().int().min(0).max(MAX_TIMEOUT_SEC),
  awayAfterMissedTurns: z.number().int().min(1).max(10),
  auctions: z.boolean(),
  freeParkingJackpot: z.boolean(),
  evenBuild: z.boolean(),
  buildingLimits: z.object({
    houses: z.number().int().min(0).max(200),
    hotels: z.number().int().min(0).max(100),
    skyscrapers: z.number().int().min(0).max(50),
  }),
  maxRounds: z.number().int().min(0).max(1_000),
  securities: z.boolean(),
  securitiesLockRounds: z.number().int().min(MIN_LOCK_ROUNDS).max(MAX_LOCK_ROUNDS),
  securitiesDividends: z.boolean(),
});

/**
 * Settings as a client may send them: `GameSettingsSchema` plus the floors. The plain schema stays lenient on purpose,
 * it validates games stored before the floors existed (they are clamped on load, see clampSettingsFloors).
 */
export const GameSettingsInputSchema = GameSettingsSchema.extend({
  turnTimeoutSec: z
    .number()
    .int()
    .max(MAX_TIMEOUT_SEC)
    .refine((v) => v === 0 || v >= MIN_TURN_TIMEOUT_SEC, {
      message: `turnTimeoutSec must be 0 (off) or at least ${MIN_TURN_TIMEOUT_SEC}`,
    }),
  awayAfterMissedTurns: z.number().int().min(MIN_AWAY_AFTER_MISSED_TURNS).max(10),
});

export const PartialGameSettingsSchema = GameSettingsInputSchema.partial();

/** Raises settings of an older stored game to the floors (off stays off). */
export function clampSettingsFloors(s: GameSettings): GameSettings {
  return {
    ...s,
    turnTimeoutSec:
      s.turnTimeoutSec > 0 ? Math.max(s.turnTimeoutSec, MIN_TURN_TIMEOUT_SEC) : s.turnTimeoutSec,
    awayAfterMissedTurns: Math.max(s.awayAfterMissedTurns, MIN_AWAY_AFTER_MISSED_TURNS),
  };
}

export const CreateGameRequestSchema = z.object({
  hostName: playerName,
  settings: PartialGameSettingsSchema,
  bots: z.array(botLevel).max(7),
  maxPlayers: z.number().int().min(2).max(8),
  tokenId: z.string().max(32).optional(),
});

/** Same request without the settings floors; only the server's test mode / test options use it. */
export const UnflooredCreateGameRequestSchema = CreateGameRequestSchema.extend({
  settings: GameSettingsSchema.partial(),
});

export const JoinGameRequestSchema = z.object({
  name: playerName,
  inviteCode: z.string().min(1).max(32),
  tokenId: z.string().max(32).optional(),
});

export const SeatUpdateRequestSchema = z.strictObject({ tokenId: z.string().min(1).max(32) });

export const RotateTokenRequestSchema = z.strictObject({});

export const RotateTokenResponseSchema = z.object({ playerToken: z.string().min(16).max(128) });

export const ClientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), gameId: id, playerToken: z.string().max(128).nullable() }),
  z.object({ t: z.literal("action"), action: GameActionSchema }),
  // UTF-16 units on the wire, code points are re-checked by the server after cleaning (4 units per emoji at most)
  z.object({
    t: z.literal("chat"),
    text: z
      .string()
      .min(1)
      .max(MAX_CHAT_LENGTH * 2),
  }),
  z.object({ t: z.literal("quick-chat"), id: QuickChatIdSchema }),
  z.object({ t: z.literal("ping") }),
]);

// ---- compile-time drift checks: schemas must produce exactly the contract types ----
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type SchemaContractChecks = [
  Assert<Equals<z.infer<typeof TradeOfferSchema>, TradeOffer>>,
  Assert<Equals<z.infer<typeof GameActionSchema>, GameAction>>,
  Assert<Equals<z.infer<typeof GameSettingsSchema>, GameSettings>>,
  Assert<Equals<z.infer<typeof CreateGameRequestSchema>, CreateGameRequest>>,
  Assert<Equals<z.infer<typeof JoinGameRequestSchema>, JoinGameRequest>>,
  Assert<Equals<z.infer<typeof ClientMessageSchema>, ClientMessage>>,
  Assert<Equals<z.infer<typeof RotateTokenResponseSchema>, RotateTokenResponse>>,
  Assert<Equals<z.infer<typeof RotateTokenRequestSchema>, RotateTokenRequest>>,
  Assert<Equals<z.infer<typeof SeatUpdateRequestSchema>, SeatUpdateRequest>>,
];
