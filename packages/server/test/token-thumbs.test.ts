import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = new URL("../../client/public/assets/tokens", import.meta.url).pathname;

describe("token thumbnails", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".webp"));
  it("stay within the size budget (all 32 together under 400 KB, each under 15 KB)", () => {
    expect(files.length).toBe(32);
    const sizes = files.map((f) => statSync(join(dir, f)).size);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(400 * 1024);
    expect(Math.max(...sizes)).toBeLessThan(15 * 1024);
  });
});
