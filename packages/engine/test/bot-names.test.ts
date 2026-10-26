import { describe, expect, it } from "vitest";
import { THEMES } from "../src/themes/index.ts";

const MAX_NAME_LENGTH = 24; // same limit as player names (schemas.ts)
const MAX_PLAYERS = 8;

describe("country-themed bot names", () => {
  for (const theme of Object.values(THEMES)) {
    it(`${theme.id} has enough unique, short bot names for a full table`, () => {
      expect(theme.botNames.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
      expect(new Set(theme.botNames).size).toBe(theme.botNames.length);
      for (const name of theme.botNames) {
        expect(name.trim()).toBe(name);
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      }
    });
  }

  it("uses different names per country", () => {
    const [first, ...rest] = Object.values(THEMES).map((t) => new Set(t.botNames));
    for (const other of rest) {
      expect([...(first ?? [])].some((n) => other.has(n))).toBe(false);
    }
  });
});
