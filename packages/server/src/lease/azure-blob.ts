// Azure Blob writer lease (docs/DESIGN.md #89). Everything Azure-specific lives in this module.
//
// One blob (`<container>/writer.lease`, created empty on first use). Lease Blob REST (`PUT ?comp=lease`):
//   acquire  x-ms-lease-duration: 15, x-ms-proposed-lease-id: <per-process uuid>          -> 201
//   renew    x-ms-lease-id                                                                 -> 200
//   release  x-ms-lease-id                                                                 -> 200
//   break    x-ms-lease-break-period: 15 (no lease id: any authorised caller may break)    -> 202
// A newcomer breaks the lease; the holder's next renewal fails with 409 "LeaseIsBreaking..." = handover requested.
// If the holder is dead the break period runs out and the newcomer's acquire succeeds.
// Auth: Microsoft Entra token of the app's user-assigned managed identity from the Container Apps identity endpoint
// (IDENTITY_ENDPOINT / IDENTITY_HEADER); role "Storage Blob Data Contributor" on this one container only. No account key,
// no SAS. The token and the lease id travel only in headers and are never logged.
// Hand-written instead of @azure/storage-blob + @azure/identity (66 packages, ~85 MB; evaluation in DESIGN.md).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { attempt } from "@poly/engine";
import { AbortedError, sleep } from "./types.ts";
import type { LeaseTiming, RenewResult, WriterLease } from "./types.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Lease Blob allows 15-60 s; 15 s keeps a dead holder's outage short. Renew every 3 s, stop writing 5 s early. */
export const AZURE_LEASE_TIMING: LeaseTiming = {
  durationMs: 15_000,
  renewIntervalMs: 3000,
  safetyMarginMs: 5000,
};
const BREAK_PERIOD_SEC = 15;
const API_VERSION = "2023-11-03";
const LEASE_BLOB = "writer.lease";

export interface TokenSource {
  get(): Promise<string>;
}

export type LeaseOp = "acquire" | "renew" | "release" | "break" | "create" | "token";
/** status and Azure error code (a closed set from the service) only: never a body, URL, token or lease id */
export interface LeaseIssue {
  status?: number;
  code?: string;
  error?: Error;
}

export interface AzureBlobLeaseOptions {
  /** https://<account>.blob.core.windows.net (a trailing slash is fine) */
  accountUrl: string;
  container: string;
  token: TokenSource;
  fetch?: FetchLike;
  pollMs?: number;
  requestTimeoutMs?: number;
  onIssue?: (op: LeaseOp, issue: LeaseIssue) => void;
}

const SAFE_CODE = /^[A-Za-z0-9]{1,64}$/;

export class AzureBlobLease implements WriterLease {
  readonly kind = "azure-blob";
  readonly timing = AZURE_LEASE_TIMING;
  private readonly id = randomUUID();
  private readonly blobUrl: string;
  private readonly token: TokenSource;
  private readonly fetch: FetchLike;
  private readonly pollMs: number;
  private readonly requestTimeoutMs: number;
  private readonly onIssue: (op: LeaseOp, issue: LeaseIssue) => void;

  constructor(opts: AzureBlobLeaseOptions) {
    this.blobUrl = `${opts.accountUrl.replace(/\/+$/, "")}/${encodeURIComponent(opts.container)}/${LEASE_BLOB}`;
    this.token = opts.token;
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.pollMs = opts.pollMs ?? 500;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 2500;
    this.onIssue = opts.onIssue ?? (() => undefined);
  }

  async acquire(signal: AbortSignal): Promise<void> {
    let delay = this.pollMs;
    for (;;) {
      if (signal.aborted) throw new AbortedError();
      const r = await this.lease("acquire", {
        "x-ms-lease-duration": String(AZURE_LEASE_TIMING.durationMs / 1000),
        "x-ms-proposed-lease-id": this.id,
      });
      if (r.status === 201) return;
      if (r.status === 404) {
        await this.createBlob();
        continue;
      }
      // held by somebody / breaking: the normal wait; anything else (403 while a role assignment propagates, 5xx,
      // network) is reported and retried with backoff
      const busy = r.status === 409 && /^Lease(AlreadyPresent|IsBreaking)/.test(r.code ?? "");
      if (busy) delay = this.pollMs;
      else {
        this.report("acquire", r);
        delay = Math.min(delay * 2, 5000);
      }
      if (!(await sleep(delay, signal))) throw new AbortedError();
    }
  }

  async renew(): Promise<RenewResult> {
    const r = await this.lease("renew", { "x-ms-lease-id": this.id });
    if (r.status === 200) return "held";
    // renew on a breaking lease fails with 409 LeaseIsBreaking...: somebody asked for a handover
    if (r.status === 409 && (r.code ?? "").startsWith("LeaseIsBreaking"))
      return "handover-requested";
    this.report("renew", r);
    return "lost";
  }

  async requestHandover(): Promise<void> {
    const r = await this.lease("break", { "x-ms-lease-break-period": String(BREAK_PERIOD_SEC) });
    // 409 LeaseNotPresent: nobody holds it, nothing to ask; 404: no blob yet
    if (r.status === 202 || r.status === 404 || r.code === "LeaseNotPresentWithLeaseOperation")
      return;
    this.report("break", r);
  }

  async release(): Promise<void> {
    const r = await this.lease("release", { "x-ms-lease-id": this.id });
    if (r.status !== 200) this.report("release", r);
  }

  private report(op: LeaseOp, r: Outcome): void {
    const issue: LeaseIssue = {};
    if (r.status !== 0) issue.status = r.status;
    if (r.code !== undefined && SAFE_CODE.test(r.code)) issue.code = r.code;
    if (r.error) issue.error = r.error;
    this.onIssue(op, issue);
  }

  private async createBlob(): Promise<void> {
    const r = await this.request(this.blobUrl, {
      "x-ms-blob-type": "BlockBlob",
      "if-none-match": "*",
    });
    if (r.status !== 201 && r.code !== "BlobAlreadyExists") this.report("create", r);
  }

  private lease(action: string, headers: Record<string, string>): Promise<Outcome> {
    return this.request(`${this.blobUrl}?comp=lease`, { "x-ms-lease-action": action, ...headers });
  }

  private async request(url: string, headers: Record<string, string>): Promise<Outcome> {
    const token = await attempt("lease:token", () => this.token.get());
    if (!token.ok) {
      this.onIssue("token", { error: token.error });
      return { status: 0, error: token.error };
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.requestTimeoutMs);
    const sent = await attempt("lease:http", () =>
      this.fetch(url, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token.value}`,
          "x-ms-version": API_VERSION,
          "x-ms-date": new Date().toUTCString(),
          "content-length": "0",
          ...headers,
        },
        signal: timeout.signal,
      }),
    ).finally(() => clearTimeout(timer));
    if (!sent.ok) return { status: 0, error: sent.error };
    const res = sent.value;
    await res.body?.cancel();
    const code = res.headers.get("x-ms-error-code") ?? undefined;
    return code === undefined ? { status: res.status } : { status: res.status, code };
  }
}

interface Outcome {
  /** 0 = no HTTP answer (network error, timeout) */
  status: number;
  code?: string;
  error?: Error;
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_on: z.coerce.number(),
});

/**
 * Token of the managed identity from the Container Apps identity endpoint (IDENTITY_ENDPOINT + X-IDENTITY-HEADER;
 * `client_id` selects the user-assigned identity). Cached until 5 minutes before it expires.
 */
export class ManagedIdentityToken implements TokenSource {
  private cached: { token: string; refreshAt: number } | null = null;
  private readonly cfg: { endpoint: string; header: string; clientId?: string };
  private readonly fetch: FetchLike;
  private readonly now: () => number;

  constructor(
    cfg: { endpoint: string; header: string; clientId?: string },
    fetchImpl: FetchLike = (input, init) => fetch(input, init),
    now: () => number = Date.now,
  ) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.now = now;
  }

  async get(): Promise<string> {
    if (this.cached && this.now() < this.cached.refreshAt) return this.cached.token;
    const url = new URL(this.cfg.endpoint);
    url.searchParams.set("api-version", "2019-08-01");
    url.searchParams.set("resource", "https://storage.azure.com/");
    if (this.cfg.clientId) url.searchParams.set("client_id", this.cfg.clientId);
    const res = await this.fetch(url.toString(), {
      headers: { "X-IDENTITY-HEADER": this.cfg.header },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`identity endpoint answered ${res.status}`);
    }
    const body = TokenResponseSchema.parse(await res.json());
    this.cached = { token: body.access_token, refreshAt: body.expires_on * 1000 - 5 * 60_000 };
    return body.access_token;
  }
}
