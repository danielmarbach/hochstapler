// Single-instance "lease": always held. Only where exactly one in-process instance is guaranteed (unit tests, an
// in-memory database). `WRITER_LEASE=none` is refused in production (config.ts).
import type { LeaseTiming, RenewResult, WriterLease } from "./types.ts";

export class SingleInstanceLease implements WriterLease {
  readonly kind = "single";
  readonly timing: LeaseTiming = {
    durationMs: Number.POSITIVE_INFINITY,
    renewIntervalMs: 60_000,
    safetyMarginMs: 1,
  };
  acquire(): Promise<void> {
    return Promise.resolve();
  }
  renew(): Promise<RenewResult> {
    return Promise.resolve("held");
  }
  requestHandover(): Promise<void> {
    return Promise.resolve();
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
}
