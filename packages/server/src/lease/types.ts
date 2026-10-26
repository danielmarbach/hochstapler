// Writer lease (docs/DESIGN.md #89): exactly one process may have the SQLite file open for writing.
// Provider-neutral contract; the providers are `file.ts` (local disk), `azure-blob.ts` (Azure Blob lease), `single.ts`
// (in-process only) and `memory.ts` (tests). The state machine that uses it lives in `coordinator.ts`.

/** Outcome of one renewal. */
export type RenewResult =
  /** still ours, valid for another `durationMs` from the moment the renewal was sent */
  | "held"
  /** still ours until the break period ends, but another instance wants it: drain and release */
  | "handover-requested"
  /** not ours any more (or we cannot tell): stop writing NOW */
  | "lost";

export interface LeaseTiming {
  /** how long one acquisition or renewal keeps the lease, counted from when the request was sent */
  durationMs: number;
  /** how often the holder renews */
  renewIntervalMs: number;
  /**
   * Writes stop this long before the lease could have expired (renewal sent + durationMs). Covers clock drift between
   * the process and the lease store and a write that is already running when the deadline passes.
   */
  safetyMarginMs: number;
}

export interface WriterLease {
  /** provider name for logs and telemetry (`file`, `azure-blob`, ...); never an id */
  readonly kind: string;
  readonly timing: LeaseTiming;
  /**
   * Resolves once the lease is held. Waits (polls) while somebody else holds it; never breaks a lease by itself.
   * Rejects only when `signal` aborts.
   */
  acquire(signal: AbortSignal): Promise<void>;
  /** Only valid while held. Never throws: every failure that is not a handover request is "lost". */
  renew(): Promise<RenewResult>;
  /**
   * Ask the current holder (if any) to hand over: its next renewal answers "handover-requested". If the holder is dead,
   * the lease becomes free after the break period. Never throws (best effort).
   */
  requestHandover(): Promise<void>;
  /** Give the lease up (best effort, never throws). */
  release(): Promise<void>;
}

/** Thrown by the database guard when a write is attempted without a valid lease (fencing). */
export class LeaseFencedError extends Error {
  constructor() {
    super("writer lease not held: write refused");
    this.name = "LeaseFencedError";
  }
}

/** Abortable sleep; resolves false when aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((ok) => {
    if (signal?.aborted) return ok(false);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      ok(true);
    }, ms);
    t.unref(); // waiting for a lease never keeps the process alive on its own
    const onAbort = (): void => {
      clearTimeout(t);
      ok(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}
