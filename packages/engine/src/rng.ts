import { at } from "./guards.ts";
// mulberry32 as a pure function: state in, new state + value out.

export interface RngResult<T> {
  rng: number;
  value: T;
}

/** Next float in [0,1). */
export function nextRandom(rng: number): RngResult<number> {
  const next = (rng + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { rng: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Integer in [0,n). */
export function randInt(rng: number, n: number): RngResult<number> {
  const r = nextRandom(rng);
  return { rng: r.rng, value: Math.floor(r.value * n) };
}

/** One six-sided die, 1..6. */
export function rollDie(rng: number): RngResult<number> {
  const r = randInt(rng, 6);
  return { rng: r.rng, value: r.value + 1 };
}

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(rng: number, items: readonly T[]): RngResult<T[]> {
  const a = items.slice();
  let cur = rng;
  for (let i = a.length - 1; i > 0; i--) {
    const r = randInt(cur, i + 1);
    cur = r.rng;
    const j = r.value;
    [a[i], a[j]] = [at(a, j), at(a, i)];
  }
  return { rng: cur, value: a };
}

/** Deterministic hash of numbers/strings to [0,1) without advancing the rng (for bots). */
export function hash01(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e37;
    h = Math.imul(h, 16777619);
  }
  return nextRandom(h | 0).value;
}
