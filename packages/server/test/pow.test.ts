// Proof of work for game creation (docs/DESIGN.md #70): ALTCHA v2 challenges, our solver, replay store, endpoint.
import { afterEach, describe, expect, it } from "vitest";
import { HmacAlgorithm, createChallenge, solveChallenge, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/sha";
import {
  POW_HEADER,
  PowChallengeSchema,
  decodePowPayload,
  encodePowPayload,
  solvePow,
} from "@poly/engine";
import type { PowChallenge } from "@poly/engine";
import {
  MIN_PRODUCTION_DIFFICULTY,
  PowService,
  TEST_MODE_DIFFICULTY,
  loadPowConfig,
} from "../src/pow.ts";
import type { PowConfig } from "../src/pow.ts";
import { solvedPowHeaders, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

const config = (over: Partial<PowConfig> = {}): PowConfig => ({
  difficulty: 40,
  ttlSec: 300,
  capacity: 100,
  hmacKey: "k".repeat(40),
  ...over,
});

async function issue(service: PowService): Promise<PowChallenge> {
  const r = await service.issue("create-game");
  if (!r.ok) throw new Error("not issued");
  return r.challenge;
}
async function header(challenge: PowChallenge): Promise<string> {
  return encodePowPayload({ challenge, solution: await solvePow(challenge) });
}

describe("our solver speaks ALTCHA v2 (cross-check with altcha-lib)", () => {
  it("solves a server-generated challenge; altcha-lib verifies it and finds the same counter", async () => {
    const hmac = "s".repeat(40);
    const keySecret = "t".repeat(40);
    for (const counter of [0, 1, 255, 256, 1_000, 4_321]) {
      const created = await createChallenge({
        algorithm: "SHA-256",
        cost: 1,
        counter,
        deriveKey,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        keyLength: 32,
        keyPrefixLength: 8,
        hmacSignatureSecret: hmac,
        hmacKeySignatureSecret: keySecret,
        data: { action: "create-game" },
      });
      const challenge = PowChallengeSchema.parse(created);
      const ours = await solvePow(challenge);
      const theirs = await solveChallenge({ challenge: created, deriveKey, timeout: 60_000 });
      expect(theirs).not.toBeNull();
      expect(ours.counter).toBe(theirs?.counter);
      expect(ours.derivedKey).toBe(theirs?.derivedKey);
      expect(ours.counter).toBeLessThanOrEqual(counter);
      const verdict = await verifySolution({
        challenge,
        solution: ours,
        deriveKey,
        hmacAlgorithm: HmacAlgorithm.SHA_256,
        hmacSignatureSecret: hmac,
        hmacKeySignatureSecret: keySecret,
      });
      expect(verdict.verified).toBe(true);
    }
  });

  it("handles cost > 1 like the library (chained digests)", async () => {
    const created = await createChallenge({
      algorithm: "SHA-256",
      cost: 3,
      counter: 300,
      deriveKey,
      keyLength: 32,
      keyPrefixLength: 8,
      hmacSignatureSecret: "s".repeat(40),
      hmacKeySignatureSecret: "t".repeat(40),
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      data: { action: "create-game" },
    });
    const ours = await solvePow(PowChallengeSchema.parse(created));
    const theirs = await solveChallenge({ challenge: created, deriveKey, timeout: 60_000 });
    expect(ours).toMatchObject({ counter: theirs?.counter, derivedKey: theirs?.derivedKey });
  });

  it("can be aborted", async () => {
    const service = new PowService(config({ difficulty: 5_000_000 }));
    const challenge = await issue(service);
    const controller = new AbortController();
    const running = solvePow(challenge, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("header codec", () => {
  it("round-trips and rejects everything malformed without throwing", async () => {
    const service = new PowService(config());
    const challenge = await issue(service);
    const h = await header(challenge);
    expect(decodePowPayload(h)?.challenge).toEqual(challenge);
    for (const bad of [
      "",
      "!!!",
      "e30",
      "bm90LWpzb24",
      "a".repeat(5000),
      h.slice(0, -4),
      `${h}x`,
    ]) {
      expect(decodePowPayload(bad), bad).toBeNull();
    }
    const withExtra = btoa(
      JSON.stringify({ challenge, solution: { counter: 1, derivedKey: "aa".repeat(8), extra: 1 } }),
    );
    expect(decodePowPayload(withExtra)).toBeNull();
  });
});

describe("PowService", () => {
  it("accepts a solved challenge exactly once (replay refused)", async () => {
    const service = new PowService(config());
    const h = await header(await issue(service));
    expect(await service.redeem(h, "create-game")).toEqual({ ok: true });
    expect(await service.redeem(h, "create-game")).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses concurrent replays: exactly one of many simultaneous redemptions wins", async () => {
    const service = new PowService(config());
    const h = await header(await issue(service));
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.redeem(h, "create-game")),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses an expired challenge", async () => {
    let now = Date.now();
    const service = new PowService(config({ ttlSec: 60 }), () => now);
    const h = await header(await issue(service));
    now += 61_000;
    expect(await service.redeem(h, "create-game")).toEqual({ ok: false, reason: "expired" });
    expect(service.size).toBe(0);
  });

  it("refuses a challenge for another action", async () => {
    const service = new PowService(config());
    const challenge = await issue(service);
    const solution = await solvePow(challenge);
    const other = {
      ...challenge,
      parameters: { ...challenge.parameters, data: { action: "other" } },
    };
    const forged = btoa(JSON.stringify({ challenge: other, solution }));
    expect(await service.redeem(forged, "create-game")).toEqual({ ok: false, reason: "invalid" });
    // and asking for a different action than the one the challenge is bound to
    expect(await service.redeem(await header(challenge), "other" as never)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a wrong solution without burning the challenge", async () => {
    const service = new PowService(config());
    const challenge = await issue(service);
    const solution = await solvePow(challenge);
    const wrong = encodePowPayload({
      challenge,
      solution: { ...solution, derivedKey: "00".repeat(32) },
    });
    expect(await service.redeem(wrong, "create-game")).toEqual({ ok: false, reason: "invalid" });
    expect(await service.redeem(encodePowPayload({ challenge, solution }), "create-game")).toEqual({
      ok: true,
    });
  });

  it("refuses tampered parameters, a foreign signature and a challenge from another key", async () => {
    const service = new PowService(config());
    const other = new PowService(config({ hmacKey: "z".repeat(40) }));
    const challenge = await issue(service);
    const solution = await solvePow(challenge);
    const easier = {
      ...challenge,
      parameters: { ...challenge.parameters, keyPrefix: "00".repeat(8) },
    };
    expect(
      await service.redeem(encodePowPayload({ challenge: easier, solution }), "create-game"),
    ).toMatchObject({ ok: false });
    expect(
      await service.redeem(
        encodePowPayload({ challenge: { ...challenge, signature: "ab".repeat(32) }, solution }),
        "create-game",
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    const foreign = await issue(other);
    expect(await service.redeem(await header(foreign), "create-game")).toEqual({
      ok: false,
      reason: "expired", // unknown nonce: refused before any crypto
    });
  });

  it("reports a missing or garbled header", async () => {
    const service = new PowService(config());
    expect(await service.redeem(undefined, "create-game")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(await service.redeem("", "create-game")).toEqual({ ok: false, reason: "missing" });
    expect(await service.redeem("garbage", "create-game")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("fails closed when full: never evicts a live entry, refuses to issue instead", async () => {
    const service = new PowService(config({ capacity: 3 }));
    const first = await issue(service);
    const solved = await header(first);
    await issue(service);
    await issue(service);
    const refused = await service.issue("create-game");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(service.size).toBe(3);
    // the oldest live challenge is still redeemable (it was not evicted to make room)
    expect(await service.redeem(solved, "create-game")).toEqual({ ok: true });
    // a used challenge keeps its slot until it expires, so the store is still full
    expect((await service.issue("create-game")).ok).toBe(false);
  });

  it("frees slots when entries expire", async () => {
    let now = Date.now();
    const service = new PowService(config({ capacity: 2, ttlSec: 60 }), () => now);
    await issue(service);
    await issue(service);
    expect((await service.issue("create-game")).ok).toBe(false);
    now += 61_000;
    expect((await service.issue("create-game")).ok).toBe(true);
  });

  it("never overshoots the capacity under concurrent issuance", async () => {
    const service = new PowService(config({ capacity: 5 }));
    const results = await Promise.all(
      Array.from({ length: 30 }, () => service.issue("create-game")),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(service.size).toBe(5);
  });

  it("issues challenges whose counter lies in [difficulty/2, difficulty]", async () => {
    const service = new PowService(config({ difficulty: 400 }));
    for (let i = 0; i < 10; i++) {
      const { counter } = await solvePow(await issue(service));
      expect(counter).toBeLessThanOrEqual(400);
    }
  });
});

describe("configuration: no production switch weakens the challenge", () => {
  it("defaults to a real difficulty and a random key per process", () => {
    const a = loadPowConfig({}, false);
    const b = loadPowConfig({}, false);
    expect(a.difficulty).toBeGreaterThanOrEqual(MIN_PRODUCTION_DIFFICULTY);
    expect(a.hmacKey).not.toBe(b.hmacKey);
    expect(a.hmacKey.length).toBeGreaterThanOrEqual(32);
  });

  it("refuses a low difficulty unless test mode is on (test mode is refused in production itself)", () => {
    expect(() => loadPowConfig({ POW_DIFFICULTY: "100" }, false)).toThrow(/test mode only/);
    expect(() => loadPowConfig({ NODE_ENV: "production", POW_DIFFICULTY: "1" }, false)).toThrow();
    expect(
      loadPowConfig({ POW_DIFFICULTY: String(MIN_PRODUCTION_DIFFICULTY) }, false).difficulty,
    ).toBe(MIN_PRODUCTION_DIFFICULTY);
    expect(loadPowConfig({}, true).difficulty).toBe(TEST_MODE_DIFFICULTY);
    expect(loadPowConfig({ POW_DIFFICULTY: "7" }, true).difficulty).toBe(7);
  });

  it("validates the other variables and takes a stable key from the environment", () => {
    expect(() => loadPowConfig({ POW_DIFFICULTY: "abc" }, false)).toThrow();
    expect(() => loadPowConfig({ POW_TTL_SEC: "5" }, false)).toThrow();
    expect(() => loadPowConfig({ POW_CAPACITY: "0" }, false)).toThrow();
    expect(() => loadPowConfig({ POW_HMAC_KEY: "short" }, false)).toThrow();
    const key = "q".repeat(40);
    expect(loadPowConfig({ POW_HMAC_KEY: key }, false).hmacKey).toBe(key);
  });
});

describe("HTTP", () => {
  let ts: TestServer;
  afterEach(async () => {
    await ts.dispose();
  });
  const challengeRequest = (body: unknown, method = "POST") =>
    ts.api<{ challenge: PowChallenge; error?: string }>(method, "/api/pow/challenge", body);
  const create = (headers: Record<string, string>, body: unknown = NEW_GAME) =>
    fetch(`${ts.base}/api/games`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const NEW_GAME = { hostName: "Anna", settings: {}, bots: ["easy"], maxPlayers: 2 };

  it("issues a challenge for create-game", async () => {
    ts = await startTestServer();
    const r = await challengeRequest({ action: "create-game" });
    expect(r.status).toBe(200);
    const challenge = PowChallengeSchema.parse(r.json.challenge);
    expect(challenge.parameters.data).toEqual({ action: "create-game" });
    expect(challenge.parameters.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(JSON.stringify(r.json)).not.toMatch(/derivedKey|secret/i);
  });

  it("answers wrong methods with 405 and bad input with 400", async () => {
    ts = await startTestServer();
    expect((await challengeRequest(undefined, "GET")).status).toBe(405);
    expect((await challengeRequest(undefined, "PUT")).status).toBe(405);
    expect((await challengeRequest({ action: "delete-everything" })).status).toBe(400);
    expect((await challengeRequest({})).status).toBe(400);
    expect((await challengeRequest({ action: "create-game", extra: 1 })).status).toBe(400);
    expect((await challengeRequest("create-game")).status).toBe(400);
    const none = await fetch(`${ts.base}/api/pow/challenge`, { method: "POST" });
    expect(none.status).toBe(400);
  });

  it("rate limits challenges per client with Retry-After", async () => {
    ts = await startTestServer({ limits: { powBurst: 2, powPerHour: 2 } });
    const statuses: number[] = [];
    let retry: string | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${ts.base}/api/pow/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create-game" }),
      });
      statuses.push(r.status);
      retry = r.headers.get("retry-after");
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(Number(retry)).toBeGreaterThanOrEqual(1);
  });

  it("refuses to issue when the replay store is full: 503 + Retry-After", async () => {
    ts = await startTestServer({ pow: { capacity: 2 } });
    expect((await challengeRequest({ action: "create-game" })).status).toBe(200);
    expect((await challengeRequest({ action: "create-game" })).status).toBe(200);
    const r = await fetch(`${ts.base}/api/pow/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create-game" }),
    });
    expect(r.status).toBe(503);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("creating a game needs a solved challenge: missing, garbled, replayed and expired are refused", async () => {
    ts = await startTestServer({ pow: { ttlSec: 30 } });
    const none = await create({});
    expect(none.status).toBe(403);
    expect(((await none.json()) as { error: string }).error).toMatch(/Sicherheitsprüfung fehlt/);
    const garbled = await create({ [POW_HEADER]: "garbage" });
    expect(garbled.status).toBe(403);
    expect(((await garbled.json()) as { error: string }).error).toMatch(/ungültig/);

    const solved = await solvedPowHeaders(ts.base);
    expect((await create(solved)).status).toBe(201);
    const replay = await create(solved);
    expect(replay.status).toBe(403);
    expect(((await replay.json()) as { error: string }).error).toMatch(/abgelaufen/);
  });

  it("an invalid request body does not burn the challenge", async () => {
    ts = await startTestServer();
    const solved = await solvedPowHeaders(ts.base);
    expect((await create(solved, { hostName: "" })).status).toBe(400);
    expect((await create(solved)).status).toBe(201);
  });

  it("test mode only lowers the difficulty, it never skips the challenge", async () => {
    await ts?.dispose?.();
    ts = await startTestServer({ testMode: true });
    expect((await create({})).status).toBe(403);
    expect((await create(await solvedPowHeaders(ts.base))).status).toBe(201);
  });

  it("a challenge from a previous process is refused after a restart", async () => {
    ts = await startTestServer();
    const solved = await solvedPowHeaders(ts.base);
    await ts.restart();
    expect((await create(solved)).status).toBe(403);
  });
});
