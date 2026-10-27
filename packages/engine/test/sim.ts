import { chooseBotAction, chooseBotTradeResponses } from "../src/bot.ts";
import {
  applyAction,
  applyBotAction,
  createGame,
  handleTimeout,
  legalActions,
  setController,
  whoMustAct,
} from "../src/game.ts";
import { groupTiles } from "../src/helpers.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type {
  BotLevel,
  Controller,
  GameAction,
  GameSettings,
  GameState,
  NewPlayer,
  PlayerId,
  TradeOffer,
} from "../src/types.ts";
import { BOARD } from "../src/board.ts";
import { assertInvariants, assertLegalActionsConsistent, candidates } from "./invariants.ts";

/** How fake humans behave. */
export type HumanStyle = "never" | "sometimes" | "always";

export interface SimConfig {
  seed: number;
  /** controller per seat; length = player count */
  seats: ("bot" | "human")[];
  settings: Partial<GameSettings>;
  humanStyle: HumanStyle;
  /** probability per step that a fake human proposes a (random, possibly invalid) trade */
  tradeRate: number;
  /** probability per step that an away human sends an action (returns) */
  returnRate: number;
  /** check legalActions consistency every N steps (0 = never) */
  legalEvery: number;
  /** stop once this round is exceeded (counts as terminated) */
  roundCap: number;
  /** bot level per seat (default: cycles easy/normal/hard by seed) */
  levels?: BotLevel[];
  /** false = bots only accept or refuse trades (the behaviour before counteroffers) */
  botCounters?: boolean;
  /** fake humans may answer offers with random counteroffers (default true) */
  humanCounters?: boolean;
  /** replaces the random actions of human seats (e.g. a competent player for balance runs) */
  humanAction?: (s: GameState, pid: PlayerId) => GameAction | null;
  /** replaces the random trade answers of human seats */
  humanTrade?: (s: GameState, pid: PlayerId) => GameAction[];
  /** observer of every committed step (measurements, e.g. the balance runs) */
  onStep?: (prev: GameState, next: GameState) => void;
}

export interface SimResult {
  finished: boolean;
  rounds: number;
  steps: number;
  state: GameState;
  accepted: number;
  rejectedRandom: number;
  awayEvents: number;
  returns: number;
  /** trades that were closed with a counteroffer */
  countered: number;
  /** accepted trades that were counteroffers */
  counterAccepted: number;
  /** longest counter chain seen */
  maxChain: number;
  /** rounds in which a colour group first belonged completely to one player */
  fullSetRounds: number[];
}

/** tiny seeded RNG (independent of the engine's) */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEVELS: BotLevel[] = ["easy", "normal", "hard"];

export function seatPlayers(
  seats: SimConfig["seats"],
  seed: number,
  levels?: BotLevel[],
): NewPlayer[] {
  return seats.map((kind, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    color: "#fff",
    tokenId: `t${i}`,
    controller: kind,
    botLevel: levels?.[i] ?? LEVELS[(seed + i) % 3]!,
  }));
}

function pick<T>(rnd: () => number, xs: T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

function randomTrade(s: GameState, pid: PlayerId, rnd: () => number): TradeOffer {
  const others = s.players.filter((p) => p.id !== pid);
  // deliberately include unknown players and nonsense values
  const to = rnd() < 0.05 ? "nobody" : pick(rnd, others).id;
  const tile = (): number =>
    rnd() < 0.1 ? Math.floor(rnd() * 60) - 4 : Math.floor(rnd() * BOARD.length);
  const cashAmt = (): number =>
    rnd() < 0.05 ? -5 : rnd() < 0.05 ? 1.5 : rnd() < 0.5 ? 0 : Math.floor(rnd() * 400);
  const tiles = (): number[] => (rnd() < 0.5 ? [] : [tile()]);
  // half of the time build a plausible trade out of real holdings
  if (rnd() < 0.5) {
    const mine = BOARD.filter((t) => s.properties[t.index]?.owner === pid).map((t) => t.index);
    const theirs = BOARD.filter((t) => s.properties[t.index]?.owner === to).map((t) => t.index);
    return {
      to,
      giveCash: Math.floor(rnd() * 200),
      giveTiles: mine.length > 0 && rnd() < 0.5 ? [pick(rnd, mine)] : [],
      giveJailCards: 0,
      wantCash: 0,
      wantTiles: theirs.length > 0 && rnd() < 0.7 ? [pick(rnd, theirs)] : [],
      wantJailCards: 0,
    };
  }
  return {
    to,
    giveCash: cashAmt(),
    giveTiles: tiles(),
    giveJailCards: rnd() < 0.1 ? 1 : 0,
    wantCash: cashAmt(),
    wantTiles: tiles(),
    wantJailCards: rnd() < 0.1 ? 1 : 0,
  };
}

/** A random action that applyAction accepts (or null). Biased towards advancing the game. */
export function randomLegalAction(
  s: GameState,
  pid: PlayerId,
  rnd: () => number,
): GameAction | null {
  const types = legalActions(s, pid);
  if (types.length === 0) {
    return null;
  }
  const progress = types.filter((t) =>
    [
      "roll",
      "buy",
      "decline-buy",
      "end-turn",
      "pass-auction",
      "bid",
      "pay-jail-fine",
      "use-jail-card",
    ].includes(t),
  );
  const order: GameAction["type"][] = [];
  const pool = [...types];
  if (progress.length > 0 && rnd() < 0.6) {
    order.push(pick(rnd, progress));
  }
  while (pool.length > 0) {
    order.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  }
  for (const type of order) {
    const cs = candidates(s, pid, type);
    for (let i = cs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [cs[i], cs[j]] = [cs[j]!, cs[i]!];
    }
    for (const a of cs) {
      try {
        applyAction(s, pid, a, 0);
        return a;
      } catch {
        // try the next candidate
      }
    }
  }
  return null;
}

export function runSim(cfg: SimConfig): SimResult {
  const rnd = makeRng(cfg.seed * 2654435761);
  const settings: GameSettings = {
    ...DEFAULT_SETTINGS,
    ...cfg.settings,
    buildingLimits: { ...DEFAULT_SETTINGS.buildingLimits, ...(cfg.settings.buildingLimits ?? {}) },
  };
  let now = 1_000;
  let s = createGame(
    `sim${cfg.seed}`,
    seatPlayers(cfg.seats, cfg.seed, cfg.levels),
    settings,
    cfg.seed * 7919 + 13,
    now,
  ).state;
  let lastNow = now;
  assertInvariants(s, { lastNow });
  let steps = 0;
  let accepted = 0;
  let rejectedRandom = 0;
  let awayEvents = 0;
  let returns = 0;
  let countered = 0;
  let counterAccepted = 0;
  let maxChain = 0;
  const fullSetRounds: number[] = [];
  const completedSets = new Set<number>();
  const timeout = settings.turnTimeoutSec > 0;
  let idle = 0;

  const commit = (next: GameState, prev: GameState, at: number): void => {
    if (next !== prev) {
      lastNow = at;
      assertInvariants(next, { lastNow, prevVersion: prev.version });
      cfg.onStep?.(prev, next);
    }
    for (const t of next.trades) {
      const was = prev.trades.find((x) => x.id === t.id);
      if (t.status === "accepted" && was?.status !== "accepted") {
        accepted++;
        if (t.counterOf !== undefined) {
          counterAccepted++;
        }
      }
      if (t.status === "countered" && was?.status !== "countered") {
        countered++;
      }
      maxChain = Math.max(maxChain, t.counterDepth ?? 0);
    }
    for (let g = 0; g < 10; g++) {
      if (!completedSets.has(g)) {
        const tiles = groupTiles(g);
        const owner = next.properties[tiles[0] ?? 0]?.owner;
        if (owner && tiles.every((i) => next.properties[i]?.owner === owner)) {
          completedSets.add(g);
          fullSetRounds.push(next.round);
        }
      }
    }
    s = next;
  };

  const humanAct = (pid: PlayerId): boolean => {
    const a = cfg.humanAction?.(s, pid) ?? randomLegalAction(s, pid, rnd);
    if (!a) {
      return false;
    }
    const was = s.players.find((p) => p.id === pid)!.controller;
    const r = applyAction(s, pid, a, now);
    if (was === "away") {
      returns++;
    }
    commit(r.state, s, now);
    return true;
  };

  while (s.status === "running" && s.round <= cfg.roundCap) {
    if (++steps > 60_000) {
      throw new Error(`stuck: seed ${cfg.seed} round ${s.round} phase ${s.phase.type}`);
    }
    now += 1 + Math.floor(rnd() * 3_000);
    const prevStep = s;

    // fake humans: random (possibly invalid) trade proposals
    if (cfg.tradeRate > 0 && rnd() < cfg.tradeRate) {
      const humans = s.players.filter((p) => p.controller !== "bot" && !p.bankrupt);
      if (humans.length > 0) {
        const h = pick(rnd, humans);
        try {
          commit(
            applyAction(s, h.id, { type: "propose-trade", offer: randomTrade(s, h.id, rnd) }, now)
              .state,
            s,
            now,
          );
        } catch {
          rejectedRandom++;
        }
      }
    }
    // fake humans respond to trades sometimes (random), bots answer through the bot logic
    for (const t of s.trades.filter((x) => x.status === "pending")) {
      const target = s.players.find((p) => p.id === t.to);
      if (!target || target.bankrupt) {
        continue;
      }
      if (target.controller === "bot") {
        const options = { counters: cfg.botCounters !== false };
        for (const a of chooseBotTradeResponses(s, target.id, options)) {
          if ((a.type === "respond-trade" || a.type === "counter-trade") && a.tradeId === t.id) {
            commit(applyBotAction(s, target.id, a, now).state, s, now);
          }
        }
      } else if (cfg.humanTrade) {
        for (const a of cfg.humanTrade(s, target.id)) {
          if ((a.type === "respond-trade" || a.type === "counter-trade") && a.tradeId === t.id) {
            commit(applyAction(s, target.id, a, now).state, s, now);
          }
        }
      } else if (cfg.humanStyle !== "never" && rnd() < 0.3) {
        try {
          const counter = cfg.humanCounters !== false && rnd() < 0.3;
          const action: GameAction = counter
            ? {
                type: "counter-trade",
                tradeId: t.id,
                offer: {
                  to: t.from,
                  giveCash: t.wantCash,
                  giveTiles: [...t.wantTiles],
                  giveJailCards: t.wantJailCards,
                  wantCash: t.giveCash + 10 * Math.floor(rnd() * 10),
                  wantTiles: [...t.giveTiles],
                  wantJailCards: t.giveJailCards,
                },
              }
            : { type: "respond-trade", tradeId: t.id, accept: rnd() < 0.5 };
          commit(applyAction(s, target.id, action, now).state, s, now);
        } catch {
          rejectedRandom++;
        }
      }
      if (s.status !== "running") {
        break;
      }
    }
    if (s.status !== "running") {
      break;
    }
    if (cfg.legalEvery > 0 && steps % cfg.legalEvery === 0) {
      assertLegalActionsConsistent(s, whoMustAct(s)[0]!);
      const other = s.players.find((p) => !p.bankrupt && p.id !== whoMustAct(s)[0]);
      if (other) {
        assertLegalActionsConsistent(s, other.id);
      }
    }

    const pid = whoMustAct(s)[0]!;
    const actor = s.players.find((p) => p.id === pid)!;
    // an away human occasionally comes back
    if (actor.controller === "away" && rnd() < cfg.returnRate) {
      humanAct(pid);
    } else if (actor.controller === "bot") {
      const a = chooseBotAction(s, pid);
      if (!a) {
        throw new Error(`bot has no action in ${s.phase.type}`);
      }
      commit(applyBotAction(s, pid, a, now).state, s, now);
    } else if (!timeout) {
      // no time limit: a human must act; they cannot be idle
      if (!humanAct(pid)) {
        throw new Error("human has no legal action");
      }
    } else if (actor.controller === "human") {
      const acts = cfg.humanStyle === "always" || (cfg.humanStyle === "sometimes" && rnd() < 0.5);
      if (acts) {
        if (!humanAct(pid)) {
          throw new Error("human has no legal action");
        }
      } else {
        // human stays idle: jump to the deadline and let the server timeout handler run
        const dl = s.deadline;
        if (dl === null) {
          throw new Error(`human actor without deadline in ${s.phase.type}`);
        }
        now = Math.max(now, dl + 1 + Math.floor(rnd() * 500));
      }
    }
    // the server runs handleTimeout continuously
    const beforeAway = s.players.filter((p) => p.controller === "away").length;
    const to = handleTimeout(s, now);
    commit(to.state, s, now);
    awayEvents += Math.max(0, s.players.filter((p) => p.controller === "away").length - beforeAway);
    // occasionally the server flips a non-acting away player back (reconnect)
    if (rnd() < cfg.returnRate * 0.5) {
      const away = s.players.filter((p) => p.controller === "away" && !p.bankrupt);
      if (away.length > 0) {
        const r = setController(s, pick(rnd, away).id, "human" as Controller);
        // setController does not touch the deadline of someone else's decision; use now-based check only on shape
        commit(r.state, s, now);
        returns++;
      }
    }
    if (s === prevStep) {
      if (++idle > 5_000) {
        throw new Error(`no progress: seed ${cfg.seed} phase ${s.phase.type} actor ${pid}`);
      }
    } else {
      idle = 0;
    }
  }
  return {
    finished: s.status === "finished",
    rounds: s.round,
    steps,
    state: s,
    accepted,
    rejectedRandom,
    awayEvents,
    returns,
    countered,
    counterAccepted,
    maxChain,
    fullSetRounds,
  };
}
