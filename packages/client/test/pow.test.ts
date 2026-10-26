import { afterEach, describe, expect, it, vi } from "vitest";
import { PowChallengeSchema, decodePowPayload, solvePow } from "@poly/engine";
import type { PowChallenge } from "@poly/engine";
import { UI_MESSAGES, UiError } from "../src/i18n/index.ts";
import { isPowRefusal, startPow, withPow } from "../src/net/pow.ts";
import type { PowTicket, Solver } from "../src/net/pow.ts";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** a challenge as altcha-lib's createChallenge builds it (SHA-256, deterministic mode); the signatures are dummies here */
async function challengeAt(counter: number): Promise<PowChallenge> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const input = new Uint8Array(36);
  input.set(salt, 0);
  input.set(nonce, 16);
  new DataView(input.buffer).setUint32(32, counter, false);
  const key = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const dummy = async (data: Uint8Array<ArrayBuffer>): Promise<string> =>
    hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
  return PowChallengeSchema.parse({
    parameters: {
      algorithm: "SHA-256",
      nonce: hex(nonce),
      salt: hex(salt),
      cost: 1,
      keyLength: 32,
      keyPrefix: hex(key.subarray(0, 8)),
      keySignature: await dummy(key),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      data: { action: "create-game" },
    },
    signature: await dummy(salt),
  });
}

afterEach(() => vi.unstubAllGlobals());

const stubChallenge = (
  challenge: PowChallenge,
  status = 200,
  body: unknown = { challenge },
): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
};

describe("startPow", () => {
  it("fetches a challenge, solves it and yields the header the server expects", async () => {
    const challenge = await challengeAt(500);
    stubChallenge(challenge);
    const solver: Solver = (c) => solvePow(c);
    const header = await startPow(solver).header;
    const payload = decodePowPayload(header);
    expect(payload?.challenge).toEqual(challenge);
    expect(payload?.solution.counter).toBeLessThanOrEqual(500);
    expect(fetch).toHaveBeenCalledWith(
      "/api/pow/challenge",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "create-game" }) }),
    );
  });

  it("fails with a translatable error when the server is unreachable, without an unhandled rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const ticket = startPow((c) => solvePow(c));
    await expect(ticket.header).rejects.toBeInstanceOf(UiError);
    await expect(ticket.header).rejects.toMatchObject({ key: "net.unreachable" });
  });

  it("passes the server's German message on (rate limit, busy)", async () => {
    stubChallenge(await challengeAt(1), 503, { error: UI_MESSAGES.de["srv.powBusy"] });
    await expect(startPow((c) => solvePow(c)).header).rejects.toThrow(
      UI_MESSAGES.de["srv.powBusy"],
    );
  });

  it("refuses a malformed challenge", async () => {
    stubChallenge(await challengeAt(1), 200, { challenge: { parameters: {} } });
    await expect(startPow((c) => solvePow(c)).header).rejects.toMatchObject({
      key: "net.invalidResponse",
    });
  });

  it("cancel aborts the solver", async () => {
    stubChallenge(await challengeAt(1));
    let seen: AbortSignal | null = null;
    const solver: Solver = (_c, signal) => {
      seen = signal;
      return new Promise((_ok, fail) =>
        signal.addEventListener("abort", () => fail(new Error("aborted"))),
      );
    };
    const ticket = startPow(solver);
    await vi.waitFor(() => expect(seen).not.toBeNull());
    ticket.cancel();
    await expect(ticket.header).rejects.toThrow("aborted");
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });
});

describe("withPow", () => {
  const ticketOf = (header: string): PowTicket => ({
    header: Promise.resolve(header),
    cancel: () => undefined,
  });

  it("recognises the three German refusals of a solution", () => {
    for (const key of ["srv.powMissing", "srv.powInvalid", "srv.powExpired"] as const) {
      expect(isPowRefusal(new Error(UI_MESSAGES.de[key]))).toBe(true);
    }
    expect(isPowRefusal(new Error(UI_MESSAGES.de["srv.powBusy"]))).toBe(false);
    expect(isPowRefusal(new Error("anything else"))).toBe(false);
  });

  it("sends once when it works", async () => {
    const send = vi.fn(() => Promise.resolve("ok"));
    expect(
      await withPow(
        () => ticketOf("h1"),
        () => undefined,
        send,
      ),
    ).toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("h1");
  });

  it("retries once with a fresh challenge when the solution was refused as expired", async () => {
    let n = 0;
    const reset = vi.fn();
    const send = vi.fn((header: string) =>
      header === "old"
        ? Promise.reject(new Error(UI_MESSAGES.de["srv.powExpired"]))
        : Promise.resolve(header),
    );
    const out = await withPow(() => ticketOf(n++ === 0 ? "old" : "new"), reset, send);
    expect(out).toBe("new");
    expect(reset).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second refusal and does not retry other errors", async () => {
    const refused = (): Promise<never> =>
      Promise.reject(new Error(UI_MESSAGES.de["srv.powInvalid"]));
    const twice = vi.fn(refused);
    await expect(
      withPow(
        () => ticketOf("x"),
        () => undefined,
        twice,
      ),
    ).rejects.toThrow();
    expect(twice).toHaveBeenCalledTimes(2);
    const other = vi.fn(() => Promise.reject(new Error(UI_MESSAGES.de["srv.rateLimited"])));
    await expect(
      withPow(
        () => ticketOf("x"),
        () => undefined,
        other,
      ),
    ).rejects.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });
});
