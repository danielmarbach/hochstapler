// Azure Blob writer lease against a stubbed HTTP layer: the lease REST calls carry the right headers, a renewal answered
// with 409 LeaseIsBreaking... is the handover signal, everything else is "lost". Token from the Container Apps identity
// endpoint, cached, never in a URL or an error.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AzureBlobLease,
  ManagedIdentityToken,
  AZURE_LEASE_TIMING,
  type FetchLike,
} from "../src/lease/azure-blob.ts";

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/** A tiny Blob service: one blob, the lease state table of the Lease Blob docs (only what we use). */
function fakeBlobService() {
  const seen: Seen[] = [];
  const state = {
    exists: false,
    lease: null as string | null,
    breaking: false,
    /** the break period ran out: the lease is broken (renewals fail the same way, only Get Blob Properties tells apart) */
    broken: false,
    /** next lease responses to force, e.g. a 500 */
    forced: [] as { status: number; code?: string }[],
  };
  const reply = (status: number, code?: string): Response =>
    new Response(null, { status, headers: code ? { "x-ms-error-code": code } : {} });
  const fetch: FetchLike = (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    seen.push({ method: init?.method ?? "GET", url, headers });
    const forced = state.forced.shift();
    if (forced) return Promise.resolve(reply(forced.status, forced.code));
    if (!url.includes("comp=lease") && init?.method === "HEAD") {
      if (!state.exists) return Promise.resolve(reply(404, "BlobNotFound"));
      const leaseState = state.broken
        ? "broken"
        : state.breaking
          ? "breaking"
          : state.lease === null
            ? "available"
            : "leased";
      return Promise.resolve(
        new Response(null, { status: 200, headers: { "x-ms-lease-state": leaseState } }),
      );
    }
    if (!url.includes("comp=lease")) {
      if (headers["if-none-match"] !== "*") return Promise.resolve(reply(400));
      if (state.exists) return Promise.resolve(reply(409, "BlobAlreadyExists"));
      state.exists = true;
      return Promise.resolve(reply(201));
    }
    if (!state.exists) return Promise.resolve(reply(404, "BlobNotFound"));
    const id = headers["x-ms-lease-id"];
    switch (headers["x-ms-lease-action"]) {
      case "acquire": {
        const proposed = headers["x-ms-proposed-lease-id"] ?? "";
        if (state.breaking)
          return Promise.resolve(reply(409, "LeaseIsBreakingAndCannotBeAcquired"));
        if (state.lease !== null && state.lease !== proposed)
          return Promise.resolve(reply(409, "LeaseAlreadyPresent"));
        state.lease = proposed;
        return Promise.resolve(reply(201));
      }
      case "renew":
        if (state.lease !== id)
          return Promise.resolve(reply(409, "LeaseIdMismatchWithLeaseOperation"));
        // what Azure answers while the lease is breaking AND once it is broken (seen live on 2026-10-26)
        if (state.breaking || state.broken)
          return Promise.resolve(reply(409, "LeaseIsBrokenAndCannotBeRenewed"));
        return Promise.resolve(reply(200));
      case "release":
        if (state.lease !== id)
          return Promise.resolve(reply(409, "LeaseIdMismatchWithLeaseOperation"));
        state.lease = null;
        state.breaking = false;
        return Promise.resolve(reply(200));
      case "break":
        if (state.lease === null)
          return Promise.resolve(reply(409, "LeaseNotPresentWithLeaseOperation"));
        state.breaking = true;
        return Promise.resolve(reply(202));
      default:
        return Promise.resolve(reply(400));
    }
  };
  return { fetch, seen, state };
}

const ACCOUNT = "https://stexample.blob.core.windows.net";

function lease(svc: ReturnType<typeof fakeBlobService>, issues: string[] = []) {
  return new AzureBlobLease({
    accountUrl: `${ACCOUNT}/`,
    container: "leases",
    token: { get: () => Promise.resolve("TOKEN-SECRET") },
    fetch: svc.fetch,
    pollMs: 100,
    onIssue: (op, detail) => issues.push(`${op}:${detail.status ?? "-"}:${detail.code ?? "-"}`),
  });
}

describe("AzureBlobLease", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the documented timing: 15 s lease, renew every 3 s, writes stop 5 s early", () => {
    expect(AZURE_LEASE_TIMING).toEqual({
      durationMs: 15_000,
      renewIntervalMs: 3000,
      safetyMarginMs: 5000,
    });
  });

  it("creates the blob once, acquires with a 15 s duration and a proposed id, renews and releases with it", async () => {
    const svc = fakeBlobService();
    const l = lease(svc);
    await l.acquire(new AbortController().signal);
    const ops = svc.seen.map((s) => `${s.method} ${s.headers["x-ms-lease-action"] ?? "create"}`);
    expect(ops).toEqual(["PUT acquire", "PUT create", "PUT acquire"]);
    const acquire = svc.seen[2];
    expect(acquire?.url).toBe(`${ACCOUNT}/leases/writer.lease?comp=lease`);
    expect(acquire?.headers["x-ms-lease-duration"]).toBe("15");
    expect(acquire?.headers["x-ms-proposed-lease-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(acquire?.headers["authorization"]).toBe("Bearer TOKEN-SECRET");
    expect(acquire?.headers["x-ms-version"]).toMatch(/^20\d\d-\d\d-\d\d$/);
    expect(acquire?.headers["x-ms-date"]).toBeTruthy();
    const create = svc.seen[1];
    expect(create?.headers["x-ms-blob-type"]).toBe("BlockBlob");
    expect(create?.headers["if-none-match"]).toBe("*");
    const id = acquire?.headers["x-ms-proposed-lease-id"];
    expect(await l.renew()).toBe("held");
    await l.release();
    const [renew, release] = svc.seen.slice(3);
    expect(renew?.headers["x-ms-lease-action"]).toBe("renew");
    expect(renew?.headers["x-ms-lease-id"]).toBe(id);
    expect(release?.headers["x-ms-lease-action"]).toBe("release");
    expect(release?.headers["x-ms-lease-id"]).toBe(id);
    // the token and lease id are only ever headers, never part of a URL
    for (const s of svc.seen) {
      expect(s.url).not.toContain("TOKEN");
      expect(s.url).not.toContain(id);
    }
  });

  it("requestHandover breaks with a 15 s break period; the holder's renewal then reports handover-requested", async () => {
    const svc = fakeBlobService();
    const holder = lease(svc);
    await holder.acquire(new AbortController().signal);
    const newcomer = lease(svc);
    await newcomer.requestHandover();
    const br = svc.seen.at(-1);
    expect(br?.headers["x-ms-lease-action"]).toBe("break");
    expect(br?.headers["x-ms-lease-break-period"]).toBe("15");
    expect(br?.headers["x-ms-lease-id"]).toBeUndefined();
    expect(await holder.renew()).toBe("handover-requested");
    // the newcomer waits (409 breaking) until the holder releases
    let done = false;
    void newcomer.acquire(new AbortController().signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    await holder.release();
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });

  it("a renewal refused because the break period already ran out is lost, not a handover", async () => {
    const svc = fakeBlobService();
    const holder = lease(svc);
    await holder.acquire(new AbortController().signal);
    await lease(svc).requestHandover();
    svc.state.breaking = false;
    svc.state.broken = true;
    expect(await holder.renew()).toBe("lost");
  });

  it("break on a free blob is fine (nobody to ask)", async () => {
    const svc = fakeBlobService();
    svc.state.exists = true;
    const issues: string[] = [];
    await lease(svc, issues).requestHandover();
    expect(issues).toEqual([]);
  });

  it.each([
    [409, "LeaseIdMismatchWithLeaseOperation"],
    [409, "LeaseIsBrokenAndCannotBeRenewed"],
    [409, "LeaseNotPresentWithLeaseOperation"],
    [412, "LeaseLost"],
    [403, "AuthorizationPermissionMismatch"],
    [500, "InternalError"],
    [503, "ServerBusy"],
  ])("a renewal answered %i %s is lost", async (status, code) => {
    const svc = fakeBlobService();
    const issues: string[] = [];
    const l = lease(svc, issues);
    await l.acquire(new AbortController().signal);
    svc.state.forced.push({ status, code });
    expect(await l.renew()).toBe("lost");
    expect(issues).toEqual([`renew:${status}:${code}`]);
  });

  it("a network error or a timeout during renewal is lost", async () => {
    const svc = fakeBlobService();
    const l = lease(svc);
    await l.acquire(new AbortController().signal);
    const failing = new AzureBlobLease({
      accountUrl: ACCOUNT,
      container: "leases",
      token: { get: () => Promise.resolve("t") },
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    expect(await failing.renew()).toBe("lost");
    const hanging = new AzureBlobLease({
      accountUrl: ACCOUNT,
      container: "leases",
      token: { get: () => Promise.resolve("t") },
      requestTimeoutMs: 1000,
      fetch: (_url, init) =>
        new Promise((_ok, fail) =>
          init?.signal?.addEventListener("abort", () => fail(new Error("timeout"))),
        ),
    });
    const r = hanging.renew();
    await vi.advanceTimersByTimeAsync(1100);
    expect(await r).toBe("lost");
  });

  it("acquire keeps trying through errors (e.g. a role assignment that is not active yet) and reports them", async () => {
    const svc = fakeBlobService();
    svc.state.exists = true;
    svc.state.forced.push({ status: 403, code: "AuthorizationPermissionMismatch" });
    const issues: string[] = [];
    const l = lease(svc, issues);
    const p = l.acquire(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(issues).toEqual(["acquire:403:AuthorizationPermissionMismatch"]);
    expect(await l.renew()).toBe("held");
  });

  it("acquire stops when aborted", async () => {
    const svc = fakeBlobService();
    svc.state.exists = true;
    svc.state.lease = "someone-else";
    const abort = new AbortController();
    const p = lease(svc).acquire(abort.signal);
    await vi.advanceTimersByTimeAsync(1000);
    abort.abort();
    await expect(p).rejects.toThrow(/abort/);
  });
});

describe("ManagedIdentityToken (Container Apps identity endpoint)", () => {
  it("asks for a storage token for the user-assigned identity with the identity header and caches it", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    let now = 1_000_000;
    const fetch: FetchLike = (url, init) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return Promise.resolve(
        Response.json({
          access_token: `tok-${calls.length}`,
          expires_on: String(Math.floor(now / 1000) + 3600),
        }),
      );
    };
    const tokens = new ManagedIdentityToken(
      { endpoint: "http://localhost:42356/msi/token", header: "hdr", clientId: "cid-1" },
      fetch,
      () => now,
    );
    expect(await tokens.get()).toBe("tok-1");
    expect(await tokens.get()).toBe("tok-1");
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]?.url ?? "");
    expect(u.searchParams.get("resource")).toBe("https://storage.azure.com/");
    expect(u.searchParams.get("api-version")).toBe("2019-08-01");
    expect(u.searchParams.get("client_id")).toBe("cid-1");
    expect(calls[0]?.headers["X-IDENTITY-HEADER"]).toBe("hdr");
    // refreshed well before it expires
    now += 3600_000 - 4 * 60_000;
    expect(await tokens.get()).toBe("tok-2");
  });

  it("an error answer is an error without the body in the message", async () => {
    const tokens = new ManagedIdentityToken(
      { endpoint: "http://localhost:1/msi/token", header: "hdr" },
      () => Promise.resolve(new Response("secret-ish body", { status: 400 })),
    );
    await expect(tokens.get()).rejects.toThrow(/identity endpoint answered 400$/);
  });
});
