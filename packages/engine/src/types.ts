// Core contract shared by engine, server and client. See docs/DESIGN.md.
// Changes here affect all packages — record them in the decision log.
import { formatMessage, makeMsg } from "./i18n/index.ts";
import type { EngineMsg, EngineMsgKey, MsgArgs, MsgParamValues } from "./i18n/index.ts";

export type PlayerId = string;

export const BOARD_SIZE = 52;
export const JAIL_INDEX = 13;
export const FREE_PARKING_INDEX = 26;
export const GO_TO_JAIL_INDEX = 39;

/** 0 empty, 1-4 houses, 5 hotel, 6 skyscraper */
export type BuildingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const HOTEL_LEVEL = 5;
export const SKYSCRAPER_LEVEL = 6;

/** Auto-bid (proxy bidding): the increment over the highest bid placed on a player's behalf. */
export const AUTO_BID_STEP = 10;

/**
 * After a refused or expired end-game vote the proposer may only ask again this many full rounds
 * later (anti-spam).
 */
export const END_VOTE_COOLDOWN_ROUNDS = 1;

export type TileKind =
  | "go"
  | "street"
  | "station"
  | "utility"
  | "chance"
  | "community"
  | "tax"
  | "jail"
  | "free-parking"
  | "go-to-jail";

export interface TileDef {
  index: number;
  kind: TileKind;
  /** street colour group 0..9 */
  group?: number;
  price?: number;
  /**
   * street: 7 values indexed by BuildingLevel [base, 1h, 2h, 3h, 4h, hotel, skyscraper]
   *         (base rent is doubled when the owner holds the whole group and level 0)
   * station: rent by number of stations owned [1,2,3,4]
   * utility: dice multiplier by number of utilities owned [1,2,3]
   */
  rent?: number[];
  /** cost per building level (skyscraper costs 2x) */
  buildCost?: number;
  mortgage?: number;
  taxAmount?: number;
}

export type BotLevel = "easy" | "normal" | "hard";
/** human = plays himself, bot = always bot, away = human temporarily replaced by bot */
export type Controller = "human" | "bot" | "away";

/** Sectors of the securities mode; companies of a theme belong to one (docs/DESIGN.md #48). */
export type SecuritySector =
  "tourism" | "food" | "rail" | "bank" | "energy" | "tech" | "realestate";

/** One lot in a portfolio: `shares` bought together at `buyPrice` in round `boughtRound`. */
export interface Holding {
  secId: string;
  shares: number;
  buyPrice: number;
  boughtRound: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** css colour */
  color: string;
  /** theme token id */
  tokenId: string;
  controller: Controller;
  botLevel: BotLevel;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  /** card ids of held get-out-of-jail cards */
  jailCards: string[];
  bankrupt: boolean;
  missedTurns: number;
  /** securities portfolio (only when the mode is on and the player ever bought something) */
  holdings?: Holding[];
  /** dividends received so far in total (only when the securities dividends paid at least once) */
  dividends?: number;
  /** show-off mode: open bank loans, most expensive first (absent = no debt; docs/DESIGN.md #93) */
  loans?: LoanTranche[];
}

/** One bank loan tranche of the show-off mode: `amount` owed at `ratePct` interest per round. */
export interface LoanTranche {
  amount: number;
  ratePct: number;
}

export interface PropertyState {
  owner: PlayerId | null;
  level: BuildingLevel;
  mortgaged: boolean;
}

export interface GameSettings {
  themeId: string;
  startingCash: number;
  goSalary: number;
  doubleOnGoLanding: boolean;
  /** 0 = no limit */
  turnTimeoutSec: number;
  awayAfterMissedTurns: number;
  auctions: boolean;
  freeParkingJackpot: boolean;
  evenBuild: boolean;
  buildingLimits: { houses: number; hotels: number; skyscrapers: number };
  /** 0 = unlimited; otherwise richest player wins after this many rounds */
  maxRounds: number;
  /** optional "Wertpapiere" mode (docs/DESIGN.md #48) */
  securities: boolean;
  /** rounds a bought lot is locked (1-10); locked lots can only be sold in an emergency (debt) */
  securitiesLockRounds: number;
  /** pay dividends on securities at every round end (only with `securities`; docs/DESIGN.md #83) */
  securitiesDividends: boolean;
  /** "Protzmodus": players may take bank loans with a wealth-based interest (docs/DESIGN.md #93) */
  loans: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  themeId: "ch",
  startingCash: 2000,
  goSalary: 200,
  doubleOnGoLanding: false,
  turnTimeoutSec: 120,
  awayAfterMissedTurns: 2,
  auctions: true,
  freeParkingJackpot: false,
  evenBuild: true,
  buildingLimits: { houses: 48, hotels: 16, skyscrapers: 8 },
  maxRounds: 0,
  securities: false,
  securitiesLockRounds: 3,
  securitiesDividends: true,
  loans: false,
};

/** What happened in the game since the last market update; drives the coupling (securities.ts). */
export interface MarketActivity {
  /** buildings built (any group) */
  builds: number;
  /** buildings built in the theme's scenic groups */
  scenicBuilds: number;
  /** total rent paid between players */
  rentPaid: number;
  /** rent payments on stations */
  stationRents: number;
  /** rent payments on utilities */
  utilityRents: number;
  bankruptcies: number;
}

/** The headline of the latest market update (a rare boom or crash of one sector). */
export interface MarketHeadline {
  /** the company the headline is about (its whole sector moved) */
  secId: string;
  sector: SecuritySector;
  kind: "boom" | "crash";
  /** size of the move in percent, 15..35 */
  pct: number;
  /** the round in which it happened */
  round: number;
}

export interface Market {
  /** current price per security id, integers >= 1 */
  prices: Record<string, number>;
  /** the last prices per security id (oldest first, at most HISTORY_LENGTH, newest = current) */
  history: Record<string, number[]>;
  headline?: MarketHeadline;
  activity: MarketActivity;
}

export interface TradeOffer {
  to: PlayerId;
  giveCash: number;
  giveTiles: number[];
  giveJailCards: number;
  wantCash: number;
  wantTiles: number[];
  wantJailCards: number;
}

export type TradeStatus =
  "pending" | "accepted" | "rejected" | "cancelled" | "invalid" | "expired" | "countered";

/** A negotiation may contain at most this many counteroffers (then only accept/decline remain). */
export const MAX_COUNTERS = 3;

export interface Trade extends TradeOffer {
  id: string;
  from: PlayerId;
  status: TradeStatus;
  createdAt: number;
  /** epoch ms; after this the trade expires (if target is human with timeout) */
  expiresAt: number | null;
  /** id of the offer this one answers (counteroffer); absent for an original offer */
  counterOf?: string;
  /** how many counteroffers the negotiation holds up to and including this one (absent = 0) */
  counterDepth?: number;
}

export interface Auction {
  tile: number;
  highestBid: number;
  highestBidder: PlayerId | null;
  /** players still in the auction, in bidding order */
  bidders: PlayerId[];
  /** whose turn it is to bid or pass */
  turn: PlayerId;
  /**
   * Auto-bid maximums by player (proxy bidding, see AUTO_BID_STEP). Private: `redactState` shows
   * every viewer only their own entry. Only players in `bidders` have one.
   */
  autoBids?: Record<PlayerId, number>;
}

export type TurnPhase =
  /** current player must roll (or, if in jail, may pay / use card first) */
  | { type: "await-roll" }
  /** landed on unowned buyable tile */
  | { type: "await-buy"; tile: number }
  | { type: "auction"; auction: Auction }
  /** after moving: build, mortgage, trade, then end turn (or roll again on doubles) */
  | { type: "await-end-turn"; canRollAgain: boolean }
  /** player owes money they do not have: raise funds or declare bankruptcy */
  | {
      type: "debt";
      debtor: PlayerId;
      creditor: PlayerId | null;
      amount: number;
      /** set when the debt is the winning bid of an auction (the debtor need not be the current player) */
      auctionTile?: number;
      /** set when the debt is the loan interest due at the start of the turn (settled -> await-roll) */
      loanInterest?: true;
    }
  | {
      type: "game-over";
      winner: PlayerId | null;
      /** why the game ended; absent in games finished before the field existed */
      reason?: GameOverReason;
      /** final ranking, best first; absent in games finished before the field existed */
      results?: PlayerResult[];
    };

/** How a game ended: all agreed on a vote, the round limit hit, or only one player was left. */
export type GameOverReason = "vote" | "round-limit" | "last-player";

/** What a player is worth: cash + properties + buildings - mortgage debt. */
export interface NetWorthBreakdown {
  cash: number;
  /** full price of all owned properties (mortgaged ones included) */
  properties: number;
  /** money invested in buildings (build cost per level) */
  buildings: number;
  /** negative: the mortgage debt of mortgaged properties */
  mortgages: number;
  /** holdings at market price; only present when the securities mode is on */
  securities?: number;
  /** negative: the open bank loans; only present when the show-off mode is on */
  loans?: number;
  total: number;
}

/** One line of the final ranking. */
export interface PlayerResult extends NetWorthBreakdown {
  playerId: PlayerId;
  /** 1 = winner; ties are already broken (more cash, then earlier seat), so ranks are unique */
  rank: number;
  bankrupt: boolean;
}

/**
 * Vote to end the game early: every non-bankrupt player has to agree. Bots and `away` players
 * agree automatically. A single "no" cancels it; so does the expiry (missing votes count as no).
 */
export interface EndVote {
  by: PlayerId;
  /** every vote cast so far (the proposer agrees implicitly); only `true` stays pending */
  votes: Record<PlayerId, boolean>;
  createdAt: number;
  /** epoch ms; null when the game has no turn timeout */
  expiresAt: number | null;
}

export type GameStatus = "running" | "finished";

export interface LogEntry {
  at: number;
  /** German fallback text (same as formatMessage('de', msg)) */
  text: string;
  /** language-neutral form; render with formatMessage(lang, msg, resolver) */
  msg?: EngineMsg;
}

export interface GameState {
  id: string;
  /** increments with every applied action */
  version: number;
  status: GameStatus;
  settings: GameSettings;
  players: PlayerState[];
  /** index into players */
  current: number;
  round: number;
  phase: TurnPhase;
  /** keyed by tile index (only buyable tiles) */
  properties: Record<number, PropertyState>;
  dice: [number, number] | null;
  doublesCount: number;
  /** remaining draw order of card ids (redacted for clients) */
  decks: { chance: string[]; community: string[] };
  bank: { houses: number; hotels: number; skyscrapers: number };
  /** securities market; present exactly when settings.securities is on */
  market?: Market;
  freeParkingPot: number;
  trades: Trade[];
  /** epoch ms when the player who must act times out; null = no limit */
  deadline: number | null;
  /** mulberry32 state (redacted for clients) */
  rng: number;
  log: LogEntry[];
  /** pending vote to end the game; pending votes never block normal play */
  endVote?: EndVote;
  /** proposer -> first round in which they may propose again (after a refused/expired vote) */
  endVoteCooldown?: Record<PlayerId, number>;
}

export type GameAction =
  | { type: "roll" }
  | { type: "pay-jail-fine" }
  | { type: "use-jail-card" }
  | { type: "buy" }
  | { type: "decline-buy" }
  | { type: "bid"; amount: number }
  | { type: "pass-auction" }
  /** proxy bidding: bid automatically on my turn up to `max` (null = cancel); any time in an auction */
  | { type: "set-auto-bid"; max: number | null }
  | { type: "build"; tile: number }
  | { type: "sell-building"; tile: number }
  | { type: "mortgage"; tile: number }
  | { type: "unmortgage"; tile: number }
  | { type: "propose-trade"; offer: TradeOffer }
  | { type: "respond-trade"; tradeId: string; accept: boolean }
  | { type: "counter-trade"; tradeId: string; offer: TradeOffer }
  | { type: "cancel-trade"; tradeId: string }
  /** securities: buy `shares` pieces at the current price (own turn, like building) */
  | { type: "buy-securities"; secId: string; shares: number }
  /** securities: sell the lot at portfolio index `lot` (or all lots of `secId`) */
  | { type: "sell-securities"; secId: string; lot: number | "all" }
  /** show-off mode: borrow `amount` from the bank at the rate locked now (own turn) */
  | { type: "take-loan"; amount: number }
  /** show-off mode: pay `amount` of the loans back (own turn) */
  | { type: "repay-loan"; amount: number }
  | { type: "end-turn" }
  | { type: "declare-bankruptcy" }
  /** ask everybody to end the game now; the richest player wins */
  | { type: "propose-end-game" }
  | { type: "vote-end-game"; accept: boolean };

export type CashReason =
  | "go"
  | "rent"
  | "tax"
  | "card"
  | "buy"
  | "build"
  | "sell-building"
  | "mortgage"
  | "unmortgage"
  | "jail-fine"
  | "trade"
  | "auction"
  | "free-parking"
  | "securities"
  | "loan"
  | "loan-interest"
  | "bankruptcy";

/** Events describe what happened, in order — used by the client for animation and the log. */
export type GameEvent =
  | { type: "turn-start"; playerId: PlayerId; round: number }
  | { type: "dice"; playerId: PlayerId; dice: [number, number]; doubles: boolean }
  | {
      type: "move";
      playerId: PlayerId;
      from: number;
      to: number;
      mode: "walk" | "walk-back" | "teleport";
      passedGo: boolean;
    }
  | { type: "card"; playerId: PlayerId; deck: "chance" | "community"; cardId: string }
  | {
      type: "cash";
      playerId: PlayerId;
      delta: number;
      reason: CashReason;
      counterparty: PlayerId | null;
    }
  | { type: "property-bought"; playerId: PlayerId; tile: number; price: number }
  | { type: "rent"; payer: PlayerId; owner: PlayerId; tile: number; amount: number }
  | { type: "building"; tile: number; level: BuildingLevel; playerId: PlayerId }
  | { type: "mortgage"; tile: number; mortgaged: boolean; playerId: PlayerId }
  | { type: "jail"; playerId: PlayerId; inJail: boolean }
  | { type: "auction-start"; tile: number }
  | { type: "auction-bid"; playerId: PlayerId; amount: number }
  | { type: "auction-end"; tile: number; winner: PlayerId | null; amount: number }
  | {
      type: "securities-trade";
      playerId: PlayerId;
      secId: string;
      shares: number;
      /** price per share used for the trade */
      price: number;
      /** emergency-sell = locked lot sold in debt with a discount; bankruptcy-sale = holdings to the bank */
      side: "buy" | "sell" | "emergency-sell" | "bankruptcy-sale";
    }
  | { type: "market"; round: number; headline: MarketHeadline | null }
  /** show-off mode: a loan taken (positive) or repaid (negative), with the rate locked for it */
  | { type: "loan"; playerId: PlayerId; amount: number; ratePct: number }
  /** dividends credited to a player at the end of `round` (one event per paid player) */
  | { type: "dividend"; playerId: PlayerId; amount: number; round: number }
  | { type: "trade"; trade: Trade }
  | { type: "controller"; playerId: PlayerId; controller: Controller }
  | { type: "bankrupt"; playerId: PlayerId; creditor: PlayerId | null }
  | { type: "game-over"; winner: PlayerId | null };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/** Action/validation error. `message` is the German text; `code` + `params` are language-neutral. */
export class GameError extends Error {
  readonly code: EngineMsgKey;
  readonly params: MsgParamValues;

  constructor(
    message: string,
    code: EngineMsgKey = "err.generic",
    params: MsgParamValues = { text: message },
  ) {
    super(message);
    this.code = code;
    this.params = params;
  }

  /** Error from a structured message; `message` becomes the German rendering. */
  static fromMsg(msg: EngineMsg): GameError {
    return new GameError(formatMessage("de", msg), msg.key, msg.params);
  }

  /** Typed shortcut: `GameError.of("err.playerCount", { min: 2, max: 8 })`. */
  static of<K extends EngineMsgKey>(key: K, ...args: MsgArgs<K>): GameError {
    return GameError.fromMsg(makeMsg(key, ...args));
  }
}

/** Player info needed to create a game (lobby → running). */
export interface NewPlayer {
  id: PlayerId;
  name: string;
  color: string;
  tokenId: string;
  controller: "human" | "bot";
  botLevel: BotLevel;
}
