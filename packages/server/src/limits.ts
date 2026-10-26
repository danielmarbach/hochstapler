// Abuse limits (docs/DESIGN.md #59, #68): per-client rate limits (rate-limiter-flexible), global caps and per-client socket counts. All state is
// in memory and bounded; keys are client addresses (see client-ip.ts) and are never logged or exported.
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { z } from "zod";

const Count = z.coerce.number().int().min(0).max(1_000_000);
const EnvSchema = z.object({
  GAME_CREATE_PER_HOUR: Count.default(10),
  GAME_CREATE_BURST: Count.default(5),
  GAME_JOIN_PER_HOUR: Count.default(30),
  GAME_JOIN_BURST: Count.default(10),
  MAX_RUNNING_GAMES: Count.default(50),
  MAX_OPEN_LOBBIES: Count.default(200),
  WS_MAX_PER_IP: Count.default(20),
  POW_CHALLENGE_BURST: Count.default(20),
  POW_CHALLENGES_PER_HOUR: Count.default(120),
  CHAT_BURST: Count.default(5),
  CHAT_PER_HOUR: Count.default(1800),
});

export interface LimitsConfig {
  /** sustained POST /api/games per client and hour, and how many may come at once */
  createPerHour: number;
  createBurst: number;
  /** same for POST /api/games/:id/join */
  joinPerHour: number;
  joinBurst: number;
  /** server-wide: games in status running / lobby (stored games, not only loaded rooms) */
  maxRunningGames: number;
  maxOpenLobbies: number;
  /** concurrent WebSockets per client address, pre-hello sockets included */
  wsPerIp: number;
  /** challenges per client for the game-creation proof of work (docs/DESIGN.md #70) */
  powBurst: number;
  powPerHour: number;
  /** chat messages per player: how many at once, and the sustained rate (default 5 per 10 s; docs/DESIGN.md #69) */
  chatBurst: number;
  chatPerHour: number;
}

export function loadLimits(
  env: NodeJS.ProcessEnv,
  override: Partial<LimitsConfig> = {},
): LimitsConfig {
  const e = EnvSchema.parse({
    GAME_CREATE_PER_HOUR: env["GAME_CREATE_PER_HOUR"],
    GAME_CREATE_BURST: env["GAME_CREATE_BURST"],
    GAME_JOIN_PER_HOUR: env["GAME_JOIN_PER_HOUR"],
    GAME_JOIN_BURST: env["GAME_JOIN_BURST"],
    MAX_RUNNING_GAMES: env["MAX_RUNNING_GAMES"],
    MAX_OPEN_LOBBIES: env["MAX_OPEN_LOBBIES"],
    WS_MAX_PER_IP: env["WS_MAX_PER_IP"],
    POW_CHALLENGE_BURST: env["POW_CHALLENGE_BURST"],
    POW_CHALLENGES_PER_HOUR: env["POW_CHALLENGES_PER_HOUR"],
    CHAT_BURST: env["CHAT_BURST"],
    CHAT_PER_HOUR: env["CHAT_PER_HOUR"],
  });
  return {
    createPerHour: e.GAME_CREATE_PER_HOUR,
    createBurst: e.GAME_CREATE_BURST,
    joinPerHour: e.GAME_JOIN_PER_HOUR,
    joinBurst: e.GAME_JOIN_BURST,
    maxRunningGames: e.MAX_RUNNING_GAMES,
    maxOpenLobbies: e.MAX_OPEN_LOBBIES,
    wsPerIp: e.WS_MAX_PER_IP,
    powBurst: e.POW_CHALLENGE_BURST,
    powPerHour: e.POW_CHALLENGES_PER_HOUR,
    chatBurst: e.CHAT_BURST,
    chatPerHour: e.CHAT_PER_HOUR,
    ...override,
  };
}

export type Take = { ok: true } | { ok: false; retryAfterSec: number };

const DAY_SEC = 86_400;

/**
 * Per-key rate limit on top of `rate-limiter-flexible` (RateLimiterMemory, docs/DESIGN.md #68). Config keeps its
 * token-bucket names: `burst` requests may come at once, `perHour` is the sustained rate. The library counts per
 * fixed window, so the window is chosen such that the average equals `perHour`: `burst` points per
 * `3600 * burst / perHour` seconds (burst 5 at 10/h = 5 per 30 min). A client can at most double the burst across a
 * window boundary; that is fine for abuse limiting.
 *
 * The library expires its keys itself (one unref'd timer per key) but has no cap. `tracked` mirrors the keys in
 * insertion order. All windows are equally long, so insertion order is expiry order: expired keys are dropped from the
 * front, and if `maxKeys` clients are still live the longest-known one is evicted (and forgotten by the library).
 */
export class KeyedLimiter {
  private readonly limiter: RateLimiterMemory;
  private readonly tracked = new Map<string, number>();
  private readonly maxKeys: number;
  private readonly windowMs: number;
  private readonly blocked: boolean;

  constructor(o: { burst: number; perHour: number; maxKeys?: number }) {
    this.maxKeys = o.maxKeys ?? 10_000;
    this.blocked = o.burst <= 0;
    const windowSec =
      o.perHour > 0 ? Math.max(1, Math.ceil((3600 * Math.max(1, o.burst)) / o.perHour)) : DAY_SEC;
    this.windowMs = windowSec * 1000;
    this.limiter = new RateLimiterMemory({ points: Math.max(0, o.burst), duration: windowSec });
  }

  get size(): number {
    return this.tracked.size;
  }

  async take(key: string): Promise<Take> {
    if (this.blocked) {
      return { ok: false, retryAfterSec: 3600 };
    }
    this.track(key);
    // the library rejects (instead of resolving) once the points are used up: turn that into a value
    const rejected = await this.limiter.consume(key).then(
      () => null,
      (reason: unknown) => reason,
    );
    if (rejected === null) {
      return { ok: true };
    }
    const wait = rejected instanceof RateLimiterRes ? rejected.msBeforeNext : this.windowMs;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(wait / 1000)) };
  }

  /** Forget keys whose window is over (the library has dropped them as well). */
  prune(): void {
    const now = Date.now();
    for (const [k, since] of this.tracked) {
      if (now - since < this.windowMs) break; // insertion order = expiry order
      this.tracked.delete(k);
    }
  }

  private track(key: string): void {
    const now = Date.now();
    const since = this.tracked.get(key);
    if (since !== undefined && now - since < this.windowMs) {
      return; // live window, the library keeps counting
    }
    this.tracked.delete(key);
    this.prune();
    if (this.tracked.size >= this.maxKeys) {
      const oldest = this.tracked.keys().next();
      if (!oldest.done) {
        this.tracked.delete(oldest.value);
        void this.limiter.delete(oldest.value);
      }
    }
    this.tracked.set(key, now);
  }
}

/** Concurrent connections per key; keys disappear at zero, so the map is bounded by the number of open sockets. */
export class ConnectionCounter {
  private readonly counts = new Map<string, number>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get size(): number {
    return this.counts.size;
  }

  acquire(key: string): boolean {
    const n = this.counts.get(key) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(key, n + 1);
    return true;
  }

  release(key: string): void {
    const n = this.counts.get(key) ?? 0;
    if (n <= 1) this.counts.delete(key);
    else this.counts.set(key, n - 1);
  }
}
