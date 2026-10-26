import { describe, expect, it } from "vitest";
import {
  fitDistance,
  insetsActive,
  sameInsets,
  usableSize,
  viewOffsetFor,
  type Vec3,
} from "../src/three/fit.ts";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** straight down: x to the right, -z up on the screen, the camera sits on +y */
const TOP_DOWN = { right: v(1, 0, 0), up: v(0, 0, -1), toCamera: v(0, 1, 0) };
const SQUARE = [v(-8, 0, -8), v(8, 0, -8), v(8, 0, 8), v(-8, 0, 8)];

describe("camera fit to the usable viewport (UI review T09)", () => {
  it("frames a square board exactly into a square rectangle", () => {
    // pixel radius = focal * halfExtent / distance  ->  800 / 2 = 1000 * 8 / d
    expect(fitDistance(SQUARE, TOP_DOWN, 1000, { w: 800, h: 800 })).toBeCloseTo(20, 6);
  });

  it("the narrower side decides: a short rectangle needs more distance than a tall one", () => {
    const wide = fitDistance(SQUARE, TOP_DOWN, 1000, { w: 1200, h: 600 });
    const tall = fitDistance(SQUARE, TOP_DOWN, 1000, { w: 600, h: 1200 });
    expect(wide).toBeCloseTo(26.667, 2);
    expect(tall).toBeCloseTo(26.667, 2);
    expect(fitDistance(SQUARE, TOP_DOWN, 1000, { w: 600, h: 600 })).toBeCloseTo(26.667, 2);
  });

  it("a smaller rectangle moves the camera away, a bigger one closer", () => {
    const small = fitDistance(SQUARE, TOP_DOWN, 1000, { w: 400, h: 400 });
    const big = fitDistance(SQUARE, TOP_DOWN, 1000, { w: 900, h: 900 });
    expect(small).toBeGreaterThan(big);
  });

  it("points above the board (buildings) are nearer to the camera and therefore need more room", () => {
    const flat = fitDistance(SQUARE, TOP_DOWN, 1000, { w: 800, h: 800 });
    const tall = fitDistance([...SQUARE, v(8, 2, 8)], TOP_DOWN, 1000, { w: 800, h: 800 });
    expect(tall).toBeCloseTo(flat + 2, 6);
  });

  it("insets shrink the usable rectangle and shift the projection centre", () => {
    const insets = { l: 280, r: 0, t: 76, b: 104 };
    expect(usableSize(1440, 900, insets)).toEqual({ w: 1160, h: 720 });
    // the centre of the usable rectangle lies 140 px right of and 14 px above the canvas centre
    expect(viewOffsetFor(insets)).toEqual({ x: -140, y: 14 });
    expect(viewOffsetFor({ l: 0, r: 0, t: 0, b: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("never returns a degenerate size when the insets exceed the viewport", () => {
    expect(usableSize(300, 200, { l: 280, r: 40, t: 100, b: 104 })).toEqual({ w: 1, h: 1 });
  });

  it("compares and detects insets", () => {
    const a = { l: 1, r: 2, t: 3, b: 4 };
    expect(sameInsets(a, { ...a })).toBe(true);
    expect(sameInsets(a, { ...a, b: 5 })).toBe(false);
    expect(insetsActive(a)).toBe(true);
    expect(insetsActive({ l: 0, r: 0, t: 0, b: 0 })).toBe(false);
  });
});
