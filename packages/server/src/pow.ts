// Proof-of-work challenge for creating games (docs/DESIGN.md #70). ALTCHA v2 via `altcha-lib`: the server issues signed
// challenges (deterministic mode: the counter is picked at random up to `difficulty`, so the work is bounded and the
// variance small) and verifies solutions through the key signature. The browser solves with engine/src/pow.ts.
//
// Replay protection is a reservation store: every issued challenge is remembered by its nonce until it expires.
// Redeeming flips `issued` to `used` in one synchronous step (no await between the check and the write), so a nonce
// works exactly once. A nonce that is not in the store (unknown, expired, lost in a restart) is refused. The store never
// evicts a live entry: when it is full of live entries no new challenge is issued (fail closed, 503 + Retry-After).
import { randomBytes, randomInt } from "node:crypto";
import { HmacAlgorithm, createChallenge, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/sha";
import { z } from "zod";
import { PowChallengeSchema, attempt, decodePowPayload } from "@poly/engine";
import type { PowAction, PowChallenge } from "@poly/engine";

/** In production a challenge must be worth some work; test mode and the test options may go below. */
export const MIN_PRODUCTION_DIFFICULTY = 5_000;
export const TEST_MODE_DIFFICULTY = 16;
export const DEFAULT_DIFFICULTY = 100_000;

const Int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const PowEnvSchema = z.object({
  POW_DIFFICULTY: Int(1, 50_000_000).optional(),
  POW_TTL_SEC: Int(30, 3_600).default(300),
  POW_CAPACITY: Int(10, 1_000_000).default(10_000),
  POW_HMAC_KEY: z.string().min(32).max(256).optional(),
});

export interface PowConfig {
  /** largest counter a challenge can need; the solver needs about difficulty * 0.75 hashes on average */
  difficulty: number;
  ttlSec: number;
  /** live reservations (issued + used, until they expire) */
  capacity: number;
  /** HMAC secret; random per process unless POW_HMAC_KEY is set. Never logged or sent. */
  hmacKey: string;
}

/**
 * `POW_DIFFICULTY` (default 100000), `POW_TTL_SEC` (300), `POW_CAPACITY` (10000), `POW_HMAC_KEY` (random per process).
 * Below MIN_PRODUCTION_DIFFICULTY the start is refused unless `testMode` (which itself is refused in production,
 * isTestModeEnabled): there is no production switch that weakens or removes the challenge.
 */
export function loadPowConfig(
  env: NodeJS.ProcessEnv,
  testMode: boolean,
  override: Partial<PowConfig> = {},
): PowConfig {
  const e = PowEnvSchema.parse({
    POW_DIFFICULTY: env["POW_DIFFICULTY"],
    POW_TTL_SEC: env["POW_TTL_SEC"],
    POW_CAPACITY: env["POW_CAPACITY"],
    POW_HMAC_KEY: env["POW_HMAC_KEY"] === "" ? undefined : env["POW_HMAC_KEY"],
  });
  const difficulty = e.POW_DIFFICULTY ?? (testMode ? TEST_MODE_DIFFICULTY : DEFAULT_DIFFICULTY);
  if (!testMode && difficulty < MIN_PRODUCTION_DIFFICULTY) {
    throw new Error(
      `POW_DIFFICULTY=${difficulty} is below ${MIN_PRODUCTION_DIFFICULTY}; low values exist for test mode only.`,
    );
  }
  return {
    difficulty,
    ttlSec: e.POW_TTL_SEC,
    capacity: e.POW_CAPACITY,
    hmacKey: e.POW_HMAC_KEY ?? randomBytes(32).toString("base64url"),
    ...override,
  };
}

export type PowIssue = { ok: true; challenge: PowChallenge } | { ok: false; retryAfterSec: number };
export type PowFailure = "missing" | "invalid" | "expired";
export type PowRedeem = { ok: true } | { ok: false; reason: PowFailure };

type Slot = { state: "issued" | "used"; expiresAtMs: number };

export class PowService {
  private readonly cfg: PowConfig;
  private readonly clock: () => number;
  /** nonce -> slot; insertion order is expiry order (one TTL for all), so pruning walks from the front */
  private readonly slots = new Map<string, Slot>();
  /** key signatures are HMACs of the derived key: a second secret, so a leaked challenge reveals nothing */
  private readonly keySecret: string;

  constructor(cfg: PowConfig, clock: () => number = Date.now) {
    this.cfg = cfg;
    this.clock = clock;
    this.keySecret = randomBytes(32).toString("base64url");
  }

  /** live reservations (tests, telemetry) */
  get size(): number {
    this.prune();
    return this.slots.size;
  }

  private prune(): void {
    const now = this.clock();
    for (const [nonce, slot] of this.slots) {
      if (slot.expiresAtMs > now) break;
      this.slots.delete(nonce);
    }
  }

  async issue(action: PowAction): Promise<PowIssue> {
    this.prune();
    if (this.slots.size >= this.cfg.capacity) {
      const oldest = this.slots.values().next();
      const wait = oldest.done ? 1 : Math.ceil((oldest.value.expiresAtMs - this.clock()) / 1000);
      return { ok: false, retryAfterSec: Math.max(1, wait) };
    }
    const expiresAtMs = this.clock() + this.cfg.ttlSec * 1000;
    // the capacity check and the reservation below must not be separated by an await
    const nonce = randomBytes(16).toString("hex");
    this.slots.set(nonce, { state: "issued", expiresAtMs });
    const created = await attempt("pow:create", () =>
      createChallenge({
        algorithm: "SHA-256",
        cost: 1,
        // uniform in [difficulty/2, difficulty]: bounded work, every challenge is worth at least half the difficulty
        counter: randomInt(Math.ceil(this.cfg.difficulty / 2), this.cfg.difficulty + 1),
        deriveKey,
        expiresAt: Math.floor(expiresAtMs / 1000),
        keyLength: 32,
        keyPrefixLength: 8,
        hmacAlgorithm: HmacAlgorithm.SHA_256,
        hmacSignatureSecret: this.cfg.hmacKey,
        hmacKeySignatureSecret: this.keySecret,
        data: { action },
      }),
    );
    // validated: the browser gets exactly the shape its solver and our verification expect
    const challenge = created.ok ? PowChallengeSchema.safeParse(created.value) : null;
    if (!challenge?.success) {
      this.slots.delete(nonce);
      throw created.ok ? new Error("altcha-lib returned an unexpected challenge") : created.error;
    }
    this.rekey(nonce, challenge.data.parameters.nonce);
    return { ok: true, challenge: challenge.data };
  }

  /**
   * altcha-lib picks its own nonce. The slot is reserved before the await (so concurrent issuance cannot overshoot the
   * capacity) under a placeholder and moves to the real nonce afterwards.
   */
  private rekey(placeholder: string, nonce: string): void {
    const slot = this.slots.get(placeholder);
    this.slots.delete(placeholder);
    if (slot) this.slots.set(nonce, slot);
  }

  /** Checks a header value for `action`; consumes the challenge when (and only when) the solution is right. */
  async redeem(header: string | undefined, action: PowAction): Promise<PowRedeem> {
    if (header === undefined || header === "") return { ok: false, reason: "missing" };
    const payload = decodePowPayload(header);
    if (!payload) return { ok: false, reason: "invalid" };
    const { challenge, solution } = payload;
    if (challenge.parameters.data.action !== action) return { ok: false, reason: "invalid" };
    this.prune();
    const nonce = challenge.parameters.nonce;
    // cheap refusals first: unknown, expired or already used challenges never reach the HMAC
    if (this.slots.get(nonce)?.state !== "issued") return { ok: false, reason: "expired" };
    const verdict = await verifySolution({
      challenge,
      solution,
      deriveKey,
      hmacAlgorithm: HmacAlgorithm.SHA_256,
      hmacSignatureSecret: this.cfg.hmacKey,
      hmacKeySignatureSecret: this.keySecret,
    });
    if (verdict.expired) return { ok: false, reason: "expired" };
    if (!verdict.verified) return { ok: false, reason: "invalid" };
    // check and consume without an await in between: a replayed solution (even a concurrent one) finds `used`
    const slot = this.slots.get(nonce);
    if (slot?.state !== "issued" || slot.expiresAtMs <= this.clock()) {
      return { ok: false, reason: "expired" };
    }
    slot.state = "used";
    return { ok: true };
  }
}
