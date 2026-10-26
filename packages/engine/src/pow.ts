// Proof-of-work bot challenge for creating games (docs/DESIGN.md #70). Format and algorithm of ALTCHA v2
// (https://altcha.org, library `altcha-lib` on the server), SHA-256 flavour, deterministic mode. This file is what the
// browser worker and the tests run; the server verifies with `altcha-lib`.
//
//   challenge.parameters = { algorithm: "SHA-256", nonce, salt, cost, keyLength, keyPrefix, keySignature, expiresAt, data }
//   key(counter) = first `keyLength` bytes of H^cost(salt || nonce || uint32_be(counter)),  H = SHA-256
//   solution     = the counter whose key starts with `keyPrefix` (hex), and that key (lower-case hex)
//   signature    = HMAC-SHA-256(server secret, canonical JSON of parameters), keySignature = HMAC of the key
//
// The solver needs WebCrypto (`crypto.subtle`): browsers (in a worker) and Node.
import { z } from "zod";
import { attemptSync } from "./result.ts";

export const POW_ACTIONS = ["create-game"] as const;
export type PowAction = (typeof POW_ACTIONS)[number];
const PowActionSchema = z.enum(POW_ACTIONS);

/** POST /api/pow/challenge */
export const PowChallengeRequestSchema = z.strictObject({ action: PowActionSchema });
export type PowChallengeRequest = z.infer<typeof PowChallengeRequestSchema>;

const hex = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[0-9a-f]+$/)
    .refine((v) => v.length % 2 === 0, "odd length");

/** Strict on purpose: the server signed exactly these fields, a stripped or added field would break the signature. */
export const PowParametersSchema = z.strictObject({
  algorithm: z.literal("SHA-256"),
  nonce: hex(32, 32),
  salt: hex(32, 32),
  cost: z.number().int().min(1).max(1_000),
  keyLength: z.number().int().min(8).max(32),
  keyPrefix: hex(2, 64),
  keySignature: hex(64, 64),
  expiresAt: z.number().int().positive(),
  data: z.strictObject({ action: PowActionSchema }),
});
export const PowChallengeSchema = z.strictObject({
  parameters: PowParametersSchema,
  signature: hex(64, 64),
});
/** Answer of POST /api/pow/challenge */
export const PowChallengeResponseSchema = z.strictObject({ challenge: PowChallengeSchema });
export const PowSolutionSchema = z.strictObject({
  counter: z.number().int().min(0).max(0xffff_ffff),
  derivedKey: hex(16, 64),
});
export const PowPayloadSchema = z.strictObject({
  challenge: PowChallengeSchema,
  solution: PowSolutionSchema,
});

export type PowChallenge = z.infer<typeof PowChallengeSchema>;
export type PowSolution = z.infer<typeof PowSolutionSchema>;
export type PowPayload = z.infer<typeof PowPayloadSchema>;

/** Header carrying the solution on `POST /api/games`: base64url of the JSON payload. */
export const POW_HEADER = "x-pow-solution";
export const MAX_POW_HEADER_LENGTH = 2048;

export function encodePowPayload(payload: PowPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Validated payload or null (bad base64, bad JSON, wrong shape, too long). Never throws. */
export function decodePowPayload(header: string): PowPayload | null {
  if (header.length === 0 || header.length > MAX_POW_HEADER_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(header)) return null;
  const decoded = attemptSync("pow:decode", () => {
    const binary = atob(header.replaceAll("-", "+").replaceAll("_", "/"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
    const value: unknown = JSON.parse(text);
    return value;
  });
  if (!decoded.ok) return null;
  const parsed = PowPayloadSchema.safeParse(decoded.value);
  return parsed.success ? parsed.data : null;
}

function fromHex(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** How many candidate counters are hashed per round of `Promise.all` (digest() is async: batching hides the latency). */
const BATCH = 256;

export interface SolveOptions {
  signal?: AbortSignal;
  /** counter to start at (tests) */
  start?: number;
}

/**
 * Brute-forces the counter. Resolves with the solution, rejects with an AbortError-like error when aborted, and
 * with a RangeError when the whole counter space (2^32) holds no match (cannot happen for a real challenge).
 */
export async function solvePow(
  challenge: PowChallenge,
  options: SolveOptions = {},
): Promise<PowSolution> {
  const { salt, nonce, cost, keyLength, keyPrefix } = challenge.parameters;
  const saltBytes = fromHex(salt);
  const nonceBytes = fromHex(nonce);
  const prefix = fromHex(keyPrefix);
  const head = saltBytes.length + nonceBytes.length;
  const input = new Uint8Array(new ArrayBuffer(head + 4));
  input.set(saltBytes, 0);
  input.set(nonceBytes, saltBytes.length);
  const view = new DataView(input.buffer);

  const derive = async (data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> => {
    let key = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    for (let i = 1; i < cost; i++) {
      key = new Uint8Array(await crypto.subtle.digest("SHA-256", key));
    }
    return key;
  };
  const matches = (key: Uint8Array): boolean => prefix.every((b, i) => key[i] === b);

  for (let base = options.start ?? 0; base <= 0xffff_ffff; base += BATCH) {
    if (options.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const last = Math.min(base + BATCH - 1, 0xffff_ffff);
    const pending: Promise<Uint8Array>[] = [];
    for (let counter = base; counter <= last; counter++) {
      view.setUint32(head, counter, false);
      // derive() calls digest() before its first await and digest() copies its input synchronously: one buffer serves all
      pending.push(derive(input));
    }
    const keys = await Promise.all(pending);
    const hit = keys.findIndex(matches);
    if (hit >= 0) {
      const key = keys[hit];
      if (key) return { counter: base + hit, derivedKey: toHex(key.subarray(0, keyLength)) };
    }
  }
  throw new RangeError("no solution in the counter space");
}
