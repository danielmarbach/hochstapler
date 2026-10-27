// Full runtime schema for the persisted GameState (the server stores it as JSON and validates it on
// every load, docs/DESIGN.md #13/#43). The compile-time check at the bottom makes the schema and the
// `GameState` type drift-proof: change one without the other and `npm run typecheck` fails.
// Changing the stored shape additionally needs a state migration, see migrations.ts.
import { z } from "zod";
import { GameSettingsSchema } from "./schemas.ts";
import { HISTORY_LENGTH, MAX_PRICE, SECURITY_SECTORS } from "./securities.ts";
import { ENGINE_MSG_KEYS } from "./i18n/index.ts";
import type { EngineMsgKey } from "./i18n/index.ts";
import { MAX_COUNTERS } from "./types.ts";
import type {
  Auction,
  BuildingLevel,
  GameState,
  Holding,
  LoanTranche,
  LogEntry,
  Market,
  MarketActivity,
  MarketHeadline,
  PlayerState,
  PropertyState,
  Trade,
  TurnPhase,
} from "./types.ts";

const MAX_TILE = 51;
/** bankruptcy transfers can pile up lots beyond the buy limit; this only bounds the stored size */
const MAX_HOLDING_LOTS = 400;
const playerId = z.string().min(1).max(64);
const tileIndex = z.number().int().min(0).max(MAX_TILE);
const money = z.number().int();
const counter = z.number().int().min(0);
const epochMs = z.number();

const PlayerResultSchema = z.object({
  playerId,
  rank: z.number().int().min(1),
  bankrupt: z.boolean(),
  cash: money,
  properties: money,
  buildings: money,
  mortgages: money,
  securities: money.optional(),
  loans: money.optional(),
  total: money,
});

const MSG_KEYS: ReadonlySet<string> = new Set(ENGINE_MSG_KEYS);
const msgKey = z.custom<EngineMsgKey>((v) => typeof v === "string" && MSG_KEYS.has(v), {
  message: "unknown engine message key",
});

const secId = z.string().min(1).max(64);
const HoldingSchema = z.object({
  secId,
  shares: z.number().int().min(1),
  buyPrice: z.number().int().min(1).max(MAX_PRICE),
  boughtRound: z.number().int().min(1),
});
const price = z.number().int().min(1).max(MAX_PRICE);
const MarketActivitySchema = z.object({
  builds: counter,
  scenicBuilds: counter,
  rentPaid: counter,
  stationRents: counter,
  utilityRents: counter,
  bankruptcies: counter,
});
const MarketHeadlineSchema = z.object({
  secId,
  sector: z.enum(SECURITY_SECTORS),
  kind: z.enum(["boom", "crash"]),
  pct: z.number().int().min(1).max(100),
  round: z.number().int().min(1),
});
const MarketSchema = z.object({
  prices: z.record(secId, price),
  history: z.record(secId, z.array(price).min(1).max(HISTORY_LENGTH)),
  headline: MarketHeadlineSchema.optional(),
  activity: MarketActivitySchema,
});

/** tranches merge per rate, so there are at most as many as whole-percent rates */
const MAX_LOAN_TRANCHES = 100;
const LoanTrancheSchema = z.object({
  amount: z.number().int().min(1),
  ratePct: z.number().int().min(1).max(100),
});

const PlayerStateSchema = z.object({
  id: playerId,
  name: z.string().max(100),
  color: z.string().max(32),
  tokenId: z.string().max(64),
  controller: z.enum(["human", "bot", "away"]),
  botLevel: z.enum(["easy", "normal", "hard"]),
  cash: money,
  position: tileIndex,
  inJail: z.boolean(),
  jailTurns: counter,
  jailCards: z.array(z.string().max(64)).max(8),
  bankrupt: z.boolean(),
  missedTurns: counter,
  holdings: z.array(HoldingSchema).max(MAX_HOLDING_LOTS).optional(),
  dividends: counter.optional(),
  loans: z.array(LoanTrancheSchema).max(MAX_LOAN_TRANCHES).optional(),
});

const buildingLevel = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const PropertyStateSchema = z.object({
  owner: playerId.nullable(),
  level: buildingLevel,
  mortgaged: z.boolean(),
});

const StoredTradeSchema = z.object({
  id: z.string().min(1).max(64),
  from: playerId,
  to: playerId,
  giveCash: counter,
  giveTiles: z.array(tileIndex).max(64),
  giveJailCards: counter,
  wantCash: counter,
  wantTiles: z.array(tileIndex).max(64),
  wantJailCards: counter,
  status: z.enum([
    "pending",
    "accepted",
    "rejected",
    "cancelled",
    "invalid",
    "expired",
    "countered",
  ]),
  createdAt: epochMs,
  expiresAt: epochMs.nullable(),
  counterOf: z.string().min(1).max(64).optional(),
  counterDepth: z.number().int().min(1).max(MAX_COUNTERS).optional(),
});

const AuctionSchema = z.object({
  tile: tileIndex,
  highestBid: counter,
  highestBidder: playerId.nullable(),
  bidders: z.array(playerId).max(8),
  turn: playerId,
  autoBids: z.record(playerId, counter).optional(),
});

const TurnPhaseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("await-roll") }),
  z.object({ type: z.literal("await-buy"), tile: tileIndex }),
  z.object({ type: z.literal("auction"), auction: AuctionSchema }),
  z.object({ type: z.literal("await-end-turn"), canRollAgain: z.boolean() }),
  z.object({
    type: z.literal("debt"),
    debtor: playerId,
    creditor: playerId.nullable(),
    amount: counter,
    auctionTile: tileIndex.optional(),
    loanInterest: z.literal(true).optional(),
  }),
  z.object({
    type: z.literal("game-over"),
    winner: playerId.nullable(),
    reason: z.enum(["vote", "round-limit", "last-player"]).optional(),
    results: z.array(PlayerResultSchema).optional(),
  }),
]);

const LogEntrySchema = z.object({
  at: epochMs,
  text: z.string(),
  msg: z
    .object({ key: msgKey, params: z.record(z.string(), z.union([z.string(), z.number()])) })
    .optional(),
});

const die = z.number().int().min(1).max(6);
const buildingStock = z.object({ houses: counter, hotels: counter, skyscrapers: counter });

const EndVoteSchema = z.object({
  by: playerId,
  votes: z.record(playerId, z.boolean()),
  createdAt: epochMs,
  expiresAt: epochMs.nullable(),
});

export const GameStateSchema = z.object({
  id: z.string().min(1).max(64),
  version: counter,
  status: z.enum(["running", "finished"]),
  settings: GameSettingsSchema,
  players: z.array(PlayerStateSchema).min(1).max(8),
  current: counter,
  round: counter,
  phase: TurnPhaseSchema,
  properties: z.record(tileIndex, PropertyStateSchema),
  dice: z.tuple([die, die]).nullable(),
  doublesCount: counter,
  decks: z.object({ chance: z.array(z.string().max(64)), community: z.array(z.string().max(64)) }),
  bank: buildingStock,
  market: MarketSchema.optional(),
  freeParkingPot: counter,
  trades: z.array(StoredTradeSchema),
  deadline: epochMs.nullable(),
  rng: z.number().int(),
  log: z.array(LogEntrySchema),
  endVote: EndVoteSchema.optional(),
  endVoteCooldown: z.record(playerId, counter).optional(),
});

// ---- compile-time drift checks: schemas must produce exactly the contract types ----
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type StateSchemaContractChecks = [
  Assert<Equals<z.infer<typeof PlayerStateSchema>, PlayerState>>,
  Assert<Equals<z.infer<typeof PropertyStateSchema>, PropertyState>>,
  Assert<Equals<z.infer<typeof HoldingSchema>, Holding>>,
  Assert<Equals<z.infer<typeof LoanTrancheSchema>, LoanTranche>>,
  Assert<Equals<z.infer<typeof MarketActivitySchema>, MarketActivity>>,
  Assert<Equals<z.infer<typeof MarketHeadlineSchema>, MarketHeadline>>,
  Assert<Equals<z.infer<typeof MarketSchema>, Market>>,
  Assert<Equals<z.infer<typeof buildingLevel>, BuildingLevel>>,
  Assert<Equals<z.infer<typeof StoredTradeSchema>, Trade>>,
  Assert<Equals<z.infer<typeof AuctionSchema>, Auction>>,
  Assert<Equals<z.infer<typeof TurnPhaseSchema>, TurnPhase>>,
  Assert<Equals<z.infer<typeof LogEntrySchema>, LogEntry>>,
  Assert<Equals<z.infer<typeof GameStateSchema>, GameState>>,
];
