// File writer lease for LOCAL disks (dev, LAN compose, tests). Same semantics as the Azure Blob lease, so the same
// handover state machine runs locally:
//   writer.lease        exclusive create (O_EXCL, "wx"); holds {holder, host, pid, boot, renewedAt}; a heartbeat
//                       (atomic rewrite) every renewal. Stale = not renewed for one lease duration.
//   writer.lease.break  a newcomer's handover request; the holder's next renewal answers "handover-requested".
//                       If the holder is dead, the lease is free once the break period is over.
// A crashed earlier process on the same host (dead pid, or a restarted container where the pid is reused) is detected
// at once, so a dev restart does not wait for the lease to run out.
// NEVER on SMB/NFS shares (e.g. the Azure Files mount): rename/exclusive create and mtimes are not reliable there.
// Hand-written (docs/DESIGN.md #89): proper-lockfile was evaluated and rejected (no release since 2021,
// no handover signal).
/* eslint-disable security/detect-non-literal-fs-filename -- every path is DATA_DIR (operator config) + a constant name */
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { attemptSync } from "@poly/engine";
import { AbortedError, sleep } from "./types.ts";
import type { LeaseTiming, RenewResult, WriterLease } from "./types.ts";

export const LEASE_FILE = "writer.lease";
export const BREAK_FILE = "writer.lease.break";

/** one random id per process: two leases inside one process (tests) never declare each other dead */
const PROCESS_BOOT = randomUUID();

const RecordSchema = z.object({
  holder: z.string(),
  host: z.string(),
  pid: z.number().int(),
  boot: z.string(),
  renewedAt: z.number(),
});
type LeaseRecord = z.infer<typeof RecordSchema>;
const BreakSchema = z.object({ by: z.string(), requestedAt: z.number() });
type BreakRecord = z.infer<typeof BreakSchema>;

export interface FileLeaseOptions {
  timing: LeaseTiming;
  /** how long a handover request waits for a silent holder (default: the lease duration) */
  breakPeriodMs?: number;
  /** poll interval while waiting for the lease */
  pollMs?: number;
  /** wall clock (several processes compare it) */
  now?: () => number;
  host?: string;
  pid?: number;
  boot?: string;
  isAlive?: (pid: number) => boolean;
}

function pidAlive(pid: number): boolean {
  const r = attemptSync("lease:pid", () => process.kill(pid, 0));
  // EPERM: the process exists but belongs to someone else
  return r.ok || (r.error as NodeJS.ErrnoException).code === "EPERM";
}

function readJson<T>(path: string, schema: z.ZodType<T>): T | null {
  const text = attemptSync("lease:read", () => readFileSync(path, "utf8"));
  if (!text.ok) return null;
  const parsed = attemptSync("lease:parse", () => schema.parse(JSON.parse(text.value)));
  return parsed.ok ? parsed.value : null;
}

export class FileLease implements WriterLease {
  readonly kind = "file";
  readonly timing: LeaseTiming;
  readonly id = randomUUID();
  private readonly leasePath: string;
  private readonly breakPath: string;
  private readonly breakPeriodMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;
  private readonly host: string;
  private readonly pid: number;
  private readonly boot: string;
  private readonly isAlive: (pid: number) => boolean;

  constructor(dir: string, opts: FileLeaseOptions) {
    this.leasePath = join(dir, LEASE_FILE);
    this.breakPath = join(dir, BREAK_FILE);
    this.timing = opts.timing;
    this.breakPeriodMs = opts.breakPeriodMs ?? opts.timing.durationMs;
    this.pollMs = opts.pollMs ?? 250;
    this.now = opts.now ?? Date.now;
    this.host = opts.host ?? hostname();
    this.pid = opts.pid ?? process.pid;
    this.boot = opts.boot ?? PROCESS_BOOT;
    this.isAlive = opts.isAlive ?? pidAlive;
  }

  async acquire(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new AbortedError();
      if (this.tryCreate() || (this.takeOverIfStale() && this.tryCreate())) {
        this.clearBreak();
        return;
      }
      if (!(await sleep(this.pollMs, signal))) throw new AbortedError();
    }
  }

  renew(): Promise<RenewResult> {
    return Promise.resolve(this.renewSync());
  }

  requestHandover(): Promise<void> {
    const request: BreakRecord = { by: this.id, requestedAt: this.now() };
    attemptSync("lease:break", () => writeFileSync(this.breakPath, JSON.stringify(request)));
    return Promise.resolve();
  }

  release(): Promise<void> {
    if (readJson(this.leasePath, RecordSchema)?.holder === this.id)
      attemptSync("lease:release", () => unlinkSync(this.leasePath));
    return Promise.resolve();
  }

  private renewSync(): RenewResult {
    const rec = readJson(this.leasePath, RecordSchema);
    if (rec?.holder !== this.id) return "lost";
    const now = this.now();
    if (now >= rec.renewedAt + this.timing.durationMs) return "lost";
    const request = readJson(this.breakPath, BreakSchema);
    if (request && request.by !== this.id) return "handover-requested";
    const tmp = `${this.leasePath}.${this.id}.tmp`;
    const written = attemptSync("lease:heartbeat", () => {
      writeFileSync(tmp, JSON.stringify(this.record(now)));
      renameSync(tmp, this.leasePath);
    });
    return written.ok ? "held" : "lost";
  }

  private record(now: number): LeaseRecord {
    return { holder: this.id, host: this.host, pid: this.pid, boot: this.boot, renewedAt: now };
  }

  /** O_EXCL create: exactly one process wins */
  private tryCreate(): boolean {
    const created = attemptSync("lease:create", () => {
      const fd = openSync(this.leasePath, "wx", 0o600);
      writeSync(fd, JSON.stringify(this.record(this.now())));
      closeSync(fd);
    });
    return created.ok;
  }

  private isStale(rec: LeaseRecord | null, mtimeMs: number): boolean {
    const now = this.now();
    if (rec === null) return now >= mtimeMs + this.timing.durationMs; // half written: judge by its age
    if (now >= rec.renewedAt + this.timing.durationMs) return true;
    const request = readJson(this.breakPath, BreakSchema);
    if (request && request.by !== rec.holder && now >= request.requestedAt + this.breakPeriodMs)
      return true;
    if (rec.host === this.host && rec.boot !== this.boot)
      return rec.pid === this.pid || !this.isAlive(rec.pid);
    return false;
  }

  /**
   * Moves a stale lease file aside (rename is atomic: of two candidates only one moves a given file). If what was moved
   * is not the stale file that was judged (somebody took over in between), it is put back untouched.
   */
  private takeOverIfStale(): boolean {
    const stat = attemptSync("lease:stat", () => statSync(this.leasePath));
    if (!stat.ok) return true; // gone meanwhile: just try to create it
    const seen = readJson(this.leasePath, RecordSchema);
    if (!this.isStale(seen, stat.value.mtimeMs)) return false;
    const aside = `${this.leasePath}.${this.id}.stale`;
    if (!attemptSync("lease:aside", () => renameSync(this.leasePath, aside)).ok) return false;
    const moved = readJson(aside, RecordSchema);
    const same =
      seen === null
        ? moved === null
        : moved !== null && moved.holder === seen.holder && moved.renewedAt === seen.renewedAt;
    // link() fails if a new lease file exists already; either way the aside copy goes
    if (!same) attemptSync("lease:restore", () => linkSync(aside, this.leasePath));
    attemptSync("lease:cleanup", () => unlinkSync(aside));
    return same;
  }

  /** the request that brought us here (or a stale one) is answered */
  private clearBreak(): void {
    const request = readJson(this.breakPath, BreakSchema);
    if (!request) return;
    if (request.by === this.id || this.now() >= request.requestedAt + this.breakPeriodMs)
      attemptSync("lease:clear-break", () => unlinkSync(this.breakPath));
  }
}
