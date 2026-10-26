// Deterministic test mode for the browser E2E suite (docs/DESIGN.md #23).
//
// Active ONLY when the server starts with POLY_TEST_MODE=1 (or `ServerOptions.testMode`, which only code can pass)
// and never together with NODE_ENV=production. Without it none of the /api/test routes exist (404).
//
// Dice determinism without touching the (pure) engine: `doRoll` draws two dice from `state.rng` (mulberry32). Before
// every action is applied the rig overwrites `state.rng` with a seed that is known to produce the next queued roll;
// once a `dice` event shows up in the result the roll is removed from the queue. The seed table is computed from a
// local copy of mulberry32; `test/test-mode.test.ts` proves the copy still matches the engine.
import {
  BOARD,
  CARDS,
  GameError,
  HISTORY_LENGTH,
  MAX_PRICE,
  MAX_SHARES_PER_SECURITY,
  attemptSync,
  getTheme,
} from "@poly/engine";
import type { GameEvent, GameState } from "@poly/engine";
import { z } from "zod";
import type { Hub } from "./rooms.ts";

export type DicePair = readonly [number, number];

/** Hook used by `GameRoom` to steer the dice (see header comment). */
export interface DiceRig {
  /** returns the state to apply the next action to (rng primed for the next queued roll) */
  prepare(gameId: string, state: GameState): GameState;
  /** consumes queued rolls that were actually thrown */
  settle(gameId: string, events: readonly GameEvent[]): void;
}

export function isTestModeEnabled(env: NodeJS.ProcessEnv, override?: boolean): boolean {
  const wanted = override ?? env["POLY_TEST_MODE"] === "1";
  if (wanted && env["NODE_ENV"] === "production") {
    throw new Error("POLY_TEST_MODE must not run together with NODE_ENV=production.");
  }
  return wanted;
}

// ---------- seed table (local mulberry32, same algorithm as packages/engine/src/rng.ts) ----------
function nextRandom(rng: number): { rng: number; value: number } {
  const next = (rng + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { rng: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}
const die = (value: number): number => Math.floor(value * 6) + 1;

let seedTable: Map<string, number> | null = null;
const pairKey = (a: number, b: number): string => `${a},${b}`;

/** an rng state whose next two dice are exactly (a, b) */
export function seedForDice(a: number, b: number): number {
  if (!seedTable) {
    const table = new Map<string, number>();
    for (let seed = 1; table.size < 36; seed++) {
      const first = nextRandom(seed);
      const second = nextRandom(first.rng);
      const key = pairKey(die(first.value), die(second.value));
      if (!table.has(key)) {
        table.set(key, seed);
      }
    }
    seedTable = table;
  }
  const seed = seedTable.get(pairKey(a, b));
  if (seed === undefined) {
    throw new GameError(`Invalid dice roll ${a}+${b}.`);
  }
  return seed;
}

export class QueuedDiceRig implements DiceRig {
  private queues = new Map<string, DicePair[]>();

  enqueue(gameId: string, rolls: readonly DicePair[]): number {
    const queue = this.queues.get(gameId) ?? [];
    queue.push(...rolls);
    this.queues.set(gameId, queue);
    return queue.length;
  }

  clear(gameId: string): void {
    this.queues.delete(gameId);
  }

  pending(gameId: string): readonly DicePair[] {
    return this.queues.get(gameId) ?? [];
  }

  prepare(gameId: string, state: GameState): GameState {
    const next = this.queues.get(gameId)?.[0];
    return next ? { ...state, rng: seedForDice(next[0], next[1]) } : state;
  }

  settle(gameId: string, events: readonly GameEvent[]): void {
    const queue = this.queues.get(gameId);
    if (!queue) {
      return;
    }
    for (const e of events) {
      if (e.type === "dice") {
        queue.shift();
      }
    }
  }
}

// ---------- fixture patches ----------
const DieSchema = z.number().int().min(1).max(6);
const DiceRequestSchema = z.strictObject({
  sequence: z.array(z.tuple([DieSchema, DieSchema])).max(200),
  /** drop already queued rolls first */
  replace: z.boolean().optional(),
});

const HoldingPatchSchema = z.strictObject({
  secId: z.string().min(1).max(64),
  shares: z.number().int().min(1).max(MAX_SHARES_PER_SECURITY),
  buyPrice: z.number().int().min(1).max(MAX_PRICE),
  boughtRound: z.number().int().min(1),
});

/** Securities mode fixtures: market prices (appended to the history so the change shows). */
const MarketPatchSchema = z.strictObject({
  prices: z.record(z.string(), z.number().int().min(1).max(MAX_PRICE)).optional(),
  /** the headline of the current round (the sector follows from the company) */
  headline: z
    .strictObject({
      secId: z.string().min(1).max(64),
      kind: z.enum(["boom", "crash"]),
      pct: z.number().int().min(15).max(35),
    })
    .optional(),
});

const PlayerPatchSchema = z.strictObject({
  holdings: z.array(HoldingPatchSchema).max(20).optional(),
  cash: z.number().int().min(0).max(1_000_000).optional(),
  position: z
    .number()
    .int()
    .min(0)
    .max(BOARD.length - 1)
    .optional(),
  inJail: z.boolean().optional(),
  jailTurns: z.number().int().min(0).max(3).optional(),
  jailCards: z.array(z.string()).max(4).optional(),
  bankrupt: z.boolean().optional(),
  controller: z.enum(["human", "bot", "away"]).optional(),
  missedTurns: z.number().int().min(0).max(10).optional(),
});

const PropertyPatchSchema = z.strictObject({
  owner: z.string().nullable(),
  level: z.literal([0, 1, 2, 3, 4, 5, 6]).default(0),
  mortgaged: z.boolean().default(false),
});

const PhasePatchSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("await-roll") }),
  z.strictObject({ type: z.literal("await-end-turn"), canRollAgain: z.boolean() }),
  z.strictObject({
    type: z.literal("await-buy"),
    tile: z
      .number()
      .int()
      .min(0)
      .max(BOARD.length - 1),
  }),
  z.strictObject({
    type: z.literal("debt"),
    debtor: z.string(),
    creditor: z.string().nullable(),
    amount: z.number().int().min(1),
  }),
]);

export const StatePatchSchema = z.strictObject({
  players: z.record(z.string(), PlayerPatchSchema).optional(),
  /** tile index -> property; `null` returns the tile to the bank */
  properties: z.record(z.string(), PropertyPatchSchema.nullable()).optional(),
  current: z.string().optional(),
  phase: PhasePatchSchema.optional(),
  round: z.number().int().min(1).optional(),
  market: MarketPatchSchema.optional(),
  doublesCount: z.number().int().min(0).max(2).optional(),
  freeParkingPot: z.number().int().min(0).optional(),
  /** card id that is drawn next from the respective deck */
  nextCard: z
    .strictObject({ chance: z.string().optional(), community: z.string().optional() })
    .optional(),
  /** deadline relative to now (ms); `null` removes it. Lets a test run into the turn timeout quickly. */
  deadlineInMs: z.number().int().min(0).nullable().optional(),
  /** a pending vote to end the game: the proposer and `agreed` already said yes, everybody else is asked */
  endVote: z
    .strictObject({
      by: z.string(),
      agreed: z.array(z.string()).max(8),
      expiresInMs: z.number().int().min(1).nullable().optional(),
    })
    .optional(),
});
export type StatePatch = z.infer<typeof StatePatchSchema>;

function fail(message: string): never {
  throw new GameError(`Invalid fixture: ${message}`);
}

/** Applies a patch to a copy of `state`, recomputes the bank stock and checks the cheap structural invariants. */
export function applyStatePatch(state: GameState, patch: StatePatch, now: number): GameState {
  const next: GameState = structuredClone(state);

  for (const [id, p] of Object.entries(patch.players ?? {})) {
    const player = next.players.find((x) => x.id === id) ?? fail(`Player ${id} does not exist`);
    Object.assign(player, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  }
  for (const [key, prop] of Object.entries(patch.properties ?? {})) {
    const tile = Number(key);
    if (!Number.isInteger(tile) || BOARD[tile]?.price === undefined) {
      fail(`Space ${key} is not purchasable`);
    }
    if (prop === null) {
      next.properties[tile] = { owner: null, level: 0, mortgaged: false };
    } else {
      next.properties[tile] = prop;
    }
  }
  if (patch.current !== undefined) {
    const idx = next.players.findIndex((x) => x.id === patch.current);
    if (idx < 0) {
      fail(`Player ${patch.current} does not exist`);
    }
    next.current = idx;
  }
  if (patch.phase) {
    next.phase = patch.phase;
  }
  if (patch.round !== undefined) {
    next.round = patch.round;
  }
  for (const player of next.players) {
    for (const h of player.holdings ?? []) {
      if (!next.market || next.market.prices[h.secId] === undefined) {
        fail(`Security ${h.secId} does not exist in this game`);
      }
      if (h.boughtRound > next.round) {
        fail(`Position of ${player.id} is from the future`);
      }
    }
  }
  if (patch.market) {
    const market = next.market ?? fail("Securities mode is not active in this game");
    const { headline } = patch.market;
    if (headline) {
      const company = getTheme(next.settings.themeId).securities.find(
        (c) => c.id === headline.secId,
      );
      if (!company) {
        fail(`Security ${headline.secId} does not exist in this game`);
      }
      market.headline = { ...headline, sector: company.sector, round: next.round };
    }
    for (const [secId, price] of Object.entries(patch.market.prices ?? {})) {
      if (market.prices[secId] === undefined) {
        fail(`Security ${secId} does not exist in this game`);
      }
      market.prices[secId] = price;
      market.history[secId] = [...(market.history[secId] ?? []), price].slice(-HISTORY_LENGTH);
    }
  }
  if (patch.doublesCount !== undefined) {
    next.doublesCount = patch.doublesCount;
  }
  if (patch.freeParkingPot !== undefined) {
    next.freeParkingPot = patch.freeParkingPot;
  }
  for (const deck of ["chance", "community"] as const) {
    const id = patch.nextCard?.[deck];
    if (id === undefined) {
      continue;
    }
    if (!CARDS.some((c) => c.id === id && c.deck === deck)) {
      fail(`Card ${id} does not belong to deck ${deck}`);
    }
    next.decks[deck] = [id, ...next.decks[deck].filter((x) => x !== id)];
  }
  if (patch.deadlineInMs !== undefined) {
    next.deadline = patch.deadlineInMs === null ? null : now + patch.deadlineInMs;
  }

  if (patch.endVote) {
    const { by, agreed, expiresInMs } = patch.endVote;
    for (const id of [by, ...agreed]) {
      if (!next.players.some((x) => x.id === id && !x.bankrupt)) {
        fail(`Player ${id} cannot vote`);
      }
    }
    next.endVote = {
      by,
      votes: Object.fromEntries([by, ...agreed].map((id) => [id, true])),
      createdAt: now,
      expiresAt: expiresInMs === undefined || expiresInMs === null ? null : now + expiresInMs,
    };
  }

  // bank stock follows from the buildings on the board
  const { houses, hotels, skyscrapers } = next.settings.buildingLimits;
  const used = { houses: 0, hotels: 0, skyscrapers: 0 };
  for (const [key, pr] of Object.entries(next.properties)) {
    const kind = BOARD[Number(key)]?.kind;
    if (pr.level > 0 && kind !== "street") {
      fail(`Space ${key} is not a street and cannot be built on`);
    }
    if (pr.mortgaged && pr.level > 0) {
      fail(`Space ${key} is mortgaged and built on`);
    }
    if (pr.owner !== null && !next.players.some((x) => x.id === pr.owner)) {
      fail(`Owner ${pr.owner} of space ${key} does not exist`);
    }
    if (pr.owner === null && (pr.level > 0 || pr.mortgaged)) {
      fail(`Space ${key} has no owner but is built on/mortgaged`);
    }
    if (pr.level >= 1 && pr.level <= 4) {
      used.houses += pr.level;
    } else if (pr.level === 5) {
      used.hotels += 1;
    } else if (pr.level === 6) {
      used.skyscrapers += 1;
    }
  }
  next.bank = {
    houses: houses - used.houses,
    hotels: hotels - used.hotels,
    skyscrapers: skyscrapers - used.skyscrapers,
  };
  if (next.bank.houses < 0 || next.bank.hotels < 0 || next.bank.skyscrapers < 0) {
    fail("more buildings than the bank supply");
  }
  const current = next.players[next.current];
  if (!current) {
    fail("current player is missing");
  }
  const phase = next.phase;
  if (phase.type === "debt" && !next.players.some((x) => x.id === phase.debtor)) {
    fail("debtor does not exist");
  }
  next.version += 1;
  return next;
}

// ---------- HTTP surface ----------
export interface TestRequest {
  method: string;
  /** path below /api/test, e.g. ["games", "<id>", "dice"] */
  parts: string[];
  body: unknown;
}
export interface TestResponse {
  status: number;
  body: unknown;
}

const GAME_ID = /^[A-Za-z0-9]{1,32}$/;

export class TestMode {
  readonly rig = new QueuedDiceRig();

  /** `null` = no such test route (caller answers 404) */
  async handle(hub: Hub, req: TestRequest): Promise<TestResponse | null> {
    const [resource, gameId, action] = req.parts;
    if (
      resource !== "games" ||
      !gameId ||
      !action ||
      req.parts.length !== 3 ||
      req.method !== "POST"
    ) {
      return null;
    }
    const room = GAME_ID.test(gameId) ? hub.get(gameId) : null;
    if (!room) {
      return { status: 404, body: { error: "Spiel nicht gefunden." } };
    }
    const reject = (message: string): TestResponse => ({ status: 400, body: { error: message } });

    if (action === "dice") {
      const parsed = DiceRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reject(parsed.error.issues[0]?.message ?? "Ungültige Eingabe.");
      }
      if (parsed.data.replace) {
        this.rig.clear(gameId);
      }
      const queued = this.rig.enqueue(gameId, parsed.data.sequence);
      return { status: 200, body: { queued } };
    }
    if (action === "expire") {
      // pretend nobody has played for a year, then sweep (e2e: the "expired game" message)
      hub.db.touchActivity(gameId, Date.now() - 366 * 24 * 60 * 60 * 1000);
      return { status: 200, body: { expired: hub.runRetention().games } };
    }
    if (action === "state") {
      const parsed = StatePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reject(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? "Ungültige Eingabe."}`);
      }
      const patch = parsed.data;
      return room.enqueue(() => {
        const current = room.state;
        if (!current) {
          return reject("Das Spiel läuft noch nicht.");
        }
        const patched = attemptSync("fixture", () => applyStatePatch(current, patch, Date.now()));
        if (!patched.ok) {
          return reject(patched.error.message);
        }
        room.loadFixture(patched.value);
        return { status: 200, body: { version: patched.value.version } };
      });
    }
    return null;
  }
}
