// Writer state machine (docs/DESIGN.md #89):
//
//   standby --start--> acquiring --lease held + activate()--> active --handover requested--> draining --> standby
//                                                              |                                      (candidate)
//                                                              +--lost / deadline passed--> fence() --> standby
//
// - standby:   no database; HTTP static files and liveness work, everything else answers 503 / WS close 4503.
// - acquiring: waiting for the lease (polling). A fresh process (one that never held the lease) asks the holder to hand
//              over: at once (`requestHandover: true`) or on its first real request (`"on-traffic"`, DESIGN #91: the
//              deploy script shifts the traffic first, so the handover starts when the players already arrive here).
//              A former holder never asks: it only takes a free or expired lease (no ping-pong between two revisions).
// - active:    database open, renewing every `renewIntervalMs`. `canWrite()` is the fence: true only until
//              (send time of the last successful renewal) + durationMs - safetyMarginMs.
// - draining:  a newcomer asked for the lease. drain() stops accepting, finishes in-flight work, persists, pauses timers
//              and closes the database; then the lease is released and the clients are told to reconnect (4503).
//              Afterwards the process stays a candidate, so it takes over again if the newcomer dies; it waits
//              `rejoinDelayMs` first so it never races a live newcomer for the lease it just released.
// - lost:      a renewal that is not a handover request (or no answer before the deadline): fence() at once
//              (no more writes, database closed without persisting), clients reconnect, then try again.
// - activation failed: the lease is given back at once and the process waits, doubling the pause per failure in a row.
//              A failed write self-test (DESIGN #94) steps aside: the first pause is 2 x the rejoin delay, so a former
//              holder that just handed over (and rejoins after one) takes the lease back and keeps serving.
import { attempt } from "@poly/engine";
import { AbortedError, sleep } from "./types.ts";
import type { LeaseTiming, RenewResult, WriterLease } from "./types.ts";

export type WriterState = "standby" | "acquiring" | "active" | "draining";

export interface WriterHooks {
  /** The lease is held: open the database and start serving. A rejection gives the lease back and retries later. */
  activate(): Promise<void>;
  /** Handover (or shutdown): stop accepting, finish in-flight work, persist, pause timers, close the database. */
  drain(): Promise<void>;
  /** The lease is lost: stop at once. No write may follow; the database is closed WITHOUT persisting. */
  fence(): void;
  /** After a handover or a loss (not on shutdown): close client sockets so they reconnect to the new holder. */
  disconnect(reason: "handover" | "lost"): void;
}

/** What the coordinator reports to telemetry. Carries no lease id, ever. */
export type LeaseEvent =
  | { type: "state"; state: WriterState }
  | { type: "acquired"; waitedMs: number }
  | { type: "renew-failed"; result: "lost" | "timeout" }
  | { type: "handover-requested" }
  /** a fresh process got its first real request and asked the holder to hand over (on-traffic mode) */
  | { type: "handover-triggered" }
  | { type: "handover-completed"; drainMs: number }
  | { type: "lost" }
  /** `retryInMs`: how long this process waits before it competes for the lease again */
  | { type: "activate-failed"; error: Error; retryInMs: number };

export interface CoordinatorOptions {
  /** monotonic milliseconds (default performance.now) */
  clock?: () => number;
  /** a former holder waits this long before it competes again (default 2 x lease duration) */
  rejoinDelayMs?: number;
  /** pause after a lost lease, and the first pause after a failed activation (default 1 s; doubles per failure in a row) */
  retryDelayMs?: number;
  /** longest pause between failed activations (default 5 min; never shorter than the first pause) */
  maxRetryDelayMs?: number;
  /**
   * activation errors after which this process steps aside (DESIGN #94: the write self-test failed): it waits 2 x the
   * rejoin delay (doubling per failure in a row), so a former holder that just handed over takes the lease back first
   */
  stepAside?: (e: Error) => boolean;
  onEvent?: (e: LeaseEvent) => void;
  /** activation errors that must end the process instead of being retried (a failed schema migration) */
  isFatal?: (e: Error) => boolean;
}

/** The fence only works if a renewal fits comfortably into the window before writes stop. */
export function validateTiming(t: LeaseTiming): void {
  if (!(t.safetyMarginMs > 0) || t.safetyMarginMs >= t.durationMs)
    throw new Error("writer lease: the safety margin must be > 0 and shorter than the lease");
  if (!(t.renewIntervalMs > 0) || t.renewIntervalMs * 2 > t.durationMs - t.safetyMarginMs)
    throw new Error(
      "writer lease: renew at least twice within (lease duration - safety margin), e.g. 3 s for a 15 s lease",
    );
}

type HoldOutcome = "handover" | "lost" | "stop";

/**
 * When a fresh process asks the current holder to hand over: `true` = at once, `"on-traffic"` = on its first real
 * request (`noteTraffic()`), `false` = never (it waits for a free or expired lease).
 */
export type HandoverRequest = boolean | "on-traffic";

export class WriterCoordinator {
  private current: WriterState = "standby";
  private readonly lease: WriterLease;
  private readonly hooks: WriterHooks;
  private readonly clock: () => number;
  private readonly rejoinDelayMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly stepAside: (e: Error) => boolean;
  /** failed activations in a row (backoff) */
  private activateFailures = 0;
  private readonly onEvent: (e: LeaseEvent) => void;
  private readonly isFatal: (e: Error) => boolean;
  private waiters: { ok: () => void; fail: (e: Error) => void }[] = [];
  private fatal: Error | null = null;
  private readonly abort = new AbortController();
  /** writes are allowed until this clock value (exclusive); -Infinity when not holding */
  private validUntil = -Infinity;
  /** ends the hold loop early (stop, deadline passed) */
  private interrupt: ((o: HoldOutcome) => void) | null = null;
  private deadlineTimer: NodeJS.Timeout | undefined;
  private loop: Promise<void> | null = null;
  private stopping = false;
  private crashed = false;
  /** counts tenures, so a renewal loop of an earlier tenure can never renew a later one */
  private tenure = 0;
  /** on-traffic mode (set by start) */
  private onTraffic = false;
  /** this process has held the lease at least once: it never asks a holder to hand over again */
  private everHeld = false;
  /** the first real request has arrived (on-traffic mode) */
  private trafficSeen = false;
  /** the holder was asked already (once per process) */
  private handoverAsked = false;
  /** interrupts the current acquire wait so the loop can ask the holder first */
  private interruptAcquire: (() => void) | null = null;

  constructor(lease: WriterLease, hooks: WriterHooks, opts: CoordinatorOptions = {}) {
    validateTiming(lease.timing);
    this.lease = lease;
    this.hooks = hooks;
    this.clock = opts.clock ?? (() => performance.now());
    this.rejoinDelayMs = opts.rejoinDelayMs ?? 2 * lease.timing.durationMs;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
    this.maxRetryDelayMs = opts.maxRetryDelayMs ?? 5 * 60_000;
    this.stepAside = opts.stepAside ?? (() => false);
    this.onEvent = opts.onEvent ?? (() => undefined);
    this.isFatal = opts.isFatal ?? (() => false);
  }

  /** Resolves once this process serves (lease held, activate() done); rejects on a fatal activation error. */
  whenActive(): Promise<void> {
    if (this.fatal) return Promise.reject(this.fatal);
    if (this.current === "active" && this.interrupt) return Promise.resolve();
    return new Promise((ok, fail) => this.waiters.push({ ok, fail }));
  }

  private settleWaiters(error: Error | null): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      if (error) w.fail(error);
      else w.ok();
    }
  }

  get state(): WriterState {
    return this.current;
  }

  get kind(): string {
    return this.lease.kind;
  }

  /** The fence: may the database be written right now? Passing the deadline counts as losing the lease. */
  canWrite(): boolean {
    if (this.current !== "active" && this.current !== "draining") return false;
    if (this.clock() < this.validUntil) return true;
    this.expire();
    return false;
  }

  /** Start competing for the lease. `requestHandover`: if and when a fresh process asks the holder to hand over. */
  start(opts: { requestHandover: HandoverRequest }): void {
    if (this.loop) return;
    this.onTraffic = opts.requestHandover === "on-traffic";
    this.loop = this.run(opts.requestHandover === true).catch((e: unknown) => {
      if (!(e instanceof AbortedError)) throw e;
    });
  }

  /**
   * A real request reached this process (not a health probe). In on-traffic mode the first one makes a fresh process
   * ask the holder to hand over; otherwise (immediate mode, a former holder, already asked) it changes nothing.
   */
  noteTraffic(): void {
    if (this.trafficSeen) return;
    this.trafficSeen = true;
    if (this.handoverDue()) this.interruptAcquire?.();
  }

  private handoverDue(): boolean {
    return (
      this.onTraffic && this.trafficSeen && !this.everHeld && !this.handoverAsked && !this.stopping
    );
  }

  /**
   * lease.acquire(), interrupted once by the first real request in on-traffic mode: the wait is aborted, the holder is
   * asked, then the wait goes on. Never in parallel with a pending acquisition (it could break our own fresh lease).
   */
  private async acquireLease(): Promise<void> {
    for (;;) {
      if (this.handoverDue()) {
        this.handoverAsked = true;
        this.onEvent({ type: "handover-triggered" });
        await this.abortable(this.lease.requestHandover());
      }
      const round = new AbortController();
      this.interruptAcquire = () => round.abort();
      const acquired = await attempt("lease:acquire", () =>
        this.lease.acquire(AbortSignal.any([this.abort.signal, round.signal])),
      );
      this.interruptAcquire = null;
      if (acquired.ok) {
        this.everHeld = true;
        return;
      }
      // only the trigger's interruption goes round again; a stop (or anything else) ends the loop as before
      if (this.abort.signal.aborted || !round.signal.aborted) throw acquired.error;
    }
  }

  /** Graceful shutdown: drain and release when holding (no disconnect: the server closes its sockets itself). */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.interrupt) this.interrupt("stop");
    else this.abort.abort();
    await this.loop;
    this.abort.abort();
  }

  /** TESTS ONLY: simulate a crash: stop everything, run no hook, release nothing. */
  abandon(): void {
    this.stopping = true;
    this.crashed = true;
    this.abort.abort();
    this.interrupt?.("stop");
    this.interrupt = null;
    this.setValidUntil(-Infinity);
  }

  private setState(s: WriterState): void {
    if (this.current === s) return;
    this.current = s;
    this.onEvent({ type: "state", state: s });
  }

  private setValidUntil(t: number): void {
    this.validUntil = t;
    clearTimeout(this.deadlineTimer);
    if (Number.isFinite(t)) {
      // the deadline also fires without any write asking (a hung renewal must not keep the database open)
      this.deadlineTimer = setTimeout(() => this.canWrite(), Math.max(0, t - this.clock()) + 1);
      this.deadlineTimer.unref();
    }
  }

  private expire(): void {
    if (this.current === "active" && this.interrupt) {
      this.onEvent({ type: "renew-failed", result: "timeout" });
      this.interrupt("lost");
    }
  }

  /** `p`, unless the coordinator is aborted first */
  private abortable<T>(p: Promise<T>): Promise<T> {
    const signal = this.abort.signal;
    if (signal.aborted) return Promise.reject(new AbortedError());
    return new Promise<T>((ok, fail) => {
      const onAbort = (): void => fail(new AbortedError());
      signal.addEventListener("abort", onAbort, { once: true });
      p.then(
        (v) => {
          signal.removeEventListener("abort", onAbort);
          ok(v);
        },
        (e: unknown) => {
          signal.removeEventListener("abort", onAbort);
          fail(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private async pause(ms: number): Promise<void> {
    if (ms > 0 && !(await sleep(ms, this.abort.signal))) throw new AbortedError();
  }

  /** One renewal, bounded by the current deadline: no answer in time counts as lost. */
  private async renewOnce(): Promise<{ result: RenewResult | "timeout"; sentAt: number }> {
    const sentAt = this.clock();
    const { durationMs, safetyMarginMs } = this.lease.timing;
    const deadline = Math.min(this.validUntil, sentAt + durationMs - safetyMarginMs);
    let timer: NodeJS.Timeout | undefined;
    // an infinite lease (single instance) has no deadline; setTimeout(Infinity) would fire at once
    const timeout = new Promise<"timeout">((ok) => {
      if (Number.isFinite(deadline))
        timer = setTimeout(() => ok("timeout"), Math.max(0, deadline - sentAt));
    });
    const result = await this.abortable(Promise.race([this.lease.renew(), timeout])).finally(() =>
      clearTimeout(timer),
    );
    return { result, sentAt };
  }

  private async run(requestHandover: boolean): Promise<void> {
    let askHolder = requestHandover;
    let wait = 0;
    while (!this.stopping) {
      await this.pause(wait);
      this.setState("acquiring");
      if (askHolder && !this.everHeld) await this.abortable(this.lease.requestHandover());
      askHolder = false;
      const t0 = this.clock();
      await this.acquireLease();
      // learn when the lease was (re)confirmed: the fence counts from the moment that renewal was sent
      this.validUntil = Infinity; // budget for the confirming renewal = one lease duration
      const confirm = await this.renewOnce();
      if (confirm.result !== "held") {
        this.setValidUntil(-Infinity);
        await this.lease.release();
        this.setState("standby");
        wait = confirm.result === "handover-requested" ? this.rejoinDelayMs : this.retryDelayMs;
        continue;
      }
      this.setValidUntil(
        confirm.sentAt + this.lease.timing.durationMs - this.lease.timing.safetyMarginMs,
      );
      this.setState("active");
      const activated = await attempt("lease:activate", () => this.hooks.activate());
      if (!activated.ok) {
        wait = this.activationBackoff(activated.error);
        this.onEvent({ type: "activate-failed", error: activated.error, retryInMs: wait });
        this.setValidUntil(-Infinity);
        await this.lease.release();
        this.setState("standby");
        if (this.isFatal(activated.error)) {
          this.fatal = activated.error;
          this.settleWaiters(activated.error);
          return;
        }
        continue;
      }
      this.activateFailures = 0;
      this.onEvent({ type: "acquired", waitedMs: this.clock() - t0 });
      const outcome = await this.hold();
      if (this.crashed) return;
      wait = await this.leave(outcome);
    }
  }

  /** Pause after a failed activation: doubles per failure in a row, capped; a step-aside starts at 2 x rejoin delay. */
  private activationBackoff(error: Error): number {
    this.activateFailures++;
    const first = this.stepAside(error) ? 2 * this.rejoinDelayMs : this.retryDelayMs;
    const grown = first * 2 ** Math.min(this.activateFailures - 1, 20);
    return Math.max(first, Math.min(this.maxRetryDelayMs, grown));
  }

  /** Renew until something ends the tenure. */
  private async hold(): Promise<HoldOutcome> {
    const tenure = ++this.tenure;
    const over = (): boolean => this.tenure !== tenure || this.current !== "active";
    const ended = new Promise<HoldOutcome>((ok) => {
      this.interrupt = ok;
    });
    this.settleWaiters(null);
    const renewals = (async (): Promise<HoldOutcome> => {
      for (;;) {
        const slept = await sleep(this.lease.timing.renewIntervalMs, this.abort.signal);
        if (!slept || over()) return "stop";
        const { result, sentAt } = await this.renewOnce().catch(() => ({
          result: "timeout" as const,
          sentAt: 0,
        }));
        if (over()) return "stop";
        if (result === "held") {
          this.setValidUntil(
            sentAt + this.lease.timing.durationMs - this.lease.timing.safetyMarginMs,
          );
          continue;
        }
        if (result === "handover-requested") return "handover";
        this.onEvent({ type: "renew-failed", result });
        return "lost";
      }
    })();
    const outcome = await Promise.race([ended, renewals]);
    this.interrupt = null;
    this.tenure++;
    return outcome;
  }

  /** Leave the active state; returns how long to wait before competing again. */
  private async leave(outcome: HoldOutcome): Promise<number> {
    if (outcome === "lost") {
      this.onEvent({ type: "lost" });
      this.setValidUntil(-Infinity); // fence first: nothing may be written from here on
      this.hooks.fence();
      this.setState("standby");
      await this.lease.release();
      this.hooks.disconnect("lost");
      return this.retryDelayMs;
    }
    if (outcome === "handover") this.onEvent({ type: "handover-requested" });
    this.setState("draining");
    const t0 = this.clock();
    await attempt("lease:drain", () => this.hooks.drain());
    this.setValidUntil(-Infinity);
    this.setState("standby");
    await this.lease.release();
    if (outcome === "handover") {
      this.hooks.disconnect("handover");
      this.onEvent({ type: "handover-completed", drainMs: this.clock() - t0 });
    }
    return this.rejoinDelayMs;
  }
}
