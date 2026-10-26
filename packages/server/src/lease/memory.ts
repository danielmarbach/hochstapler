// In-memory writer lease for tests: several `MemoryLease` instances share one `MemoryLeaseStore`, which follows the
// Azure Blob lease semantics (duration, break period, "breaking" answered as handover-requested, release). Time comes
// from the store's clock (Date.now by default, so vitest fake timers drive it). Never used in production.
import { randomUUID } from "node:crypto";
import { AbortedError, sleep } from "./types.ts";
import type { LeaseTiming, RenewResult, WriterLease } from "./types.ts";

export const MEMORY_TIMING: LeaseTiming = {
  durationMs: 15_000,
  renewIntervalMs: 3000,
  safetyMarginMs: 5000,
};

export class MemoryLeaseStore {
  holder: string | null = null;
  expiresAt = 0;
  /** end of the break period while the lease is breaking */
  breakingUntil: number | null = null;
  readonly now: () => number;
  readonly durationMs: number;
  readonly breakPeriodMs: number;
  /** every operation, in order (tests assert on it) */
  readonly log: string[] = [];

  constructor(opts: { now?: () => number; durationMs?: number; breakPeriodMs?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.durationMs = opts.durationMs ?? MEMORY_TIMING.durationMs;
    this.breakPeriodMs = opts.breakPeriodMs ?? this.durationMs;
  }

  /** who holds it right now (null when free, expired or broken) */
  current(): string | null {
    const now = this.now();
    if (this.holder === null || now >= this.expiresAt) return null;
    if (this.breakingUntil !== null && now >= this.breakingUntil) return null;
    return this.holder;
  }

  tryAcquire(id: string): boolean {
    const cur = this.current();
    if (cur !== null && cur !== id) return false;
    if (cur === id && this.breakingUntil !== null) return false; // a breaking lease cannot be re-acquired
    this.holder = id;
    this.expiresAt = this.now() + this.durationMs;
    this.breakingUntil = null;
    this.log.push(`acquire:${id}`);
    return true;
  }

  renew(id: string): RenewResult {
    if (this.current() !== id) return "lost";
    if (this.breakingUntil !== null) return "handover-requested";
    this.expiresAt = this.now() + this.durationMs;
    return "held";
  }

  breakLease(): void {
    if (this.current() === null) return;
    const until = Math.min(this.expiresAt, this.now() + this.breakPeriodMs);
    this.breakingUntil = this.breakingUntil === null ? until : Math.min(this.breakingUntil, until);
    this.log.push("break");
  }

  release(id: string): void {
    if (this.holder !== id) return;
    this.holder = null;
    this.breakingUntil = null;
    this.log.push(`release:${id}`);
  }
}

export type RenewBehaviour = "normal" | "fail" | "hang";

export class MemoryLease implements WriterLease {
  readonly kind = "memory";
  readonly timing: LeaseTiming;
  readonly id = randomUUID();
  /** tests: make the next renewals fail ("lost") or never answer */
  renewBehaviour: RenewBehaviour = "normal";
  private readonly store: MemoryLeaseStore;
  private readonly pollMs: number;

  constructor(store: MemoryLeaseStore, timing: Partial<LeaseTiming> = {}, pollMs = 100) {
    this.store = store;
    this.timing = { ...MEMORY_TIMING, durationMs: store.durationMs, ...timing };
    this.pollMs = pollMs;
  }

  async acquire(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new AbortedError();
      if (this.store.tryAcquire(this.id)) return;
      if (!(await sleep(this.pollMs, signal))) throw new AbortedError();
    }
  }

  renew(): Promise<RenewResult> {
    if (this.renewBehaviour === "hang") return new Promise<RenewResult>(() => undefined);
    if (this.renewBehaviour === "fail") return Promise.resolve("lost");
    return Promise.resolve(this.store.renew(this.id));
  }

  requestHandover(): Promise<void> {
    this.store.breakLease();
    return Promise.resolve();
  }

  release(): Promise<void> {
    this.store.release(this.id);
    return Promise.resolve();
  }
}
