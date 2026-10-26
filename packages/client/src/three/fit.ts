// Camera fit to the usable viewport (UI review T09): the HUD covers a strip on the left (player rail), at the top
// (turn banner, toolbar) and at the bottom (action bar). The board is framed into the remaining rectangle.
// Pure maths without three.js, so it can be unit tested; the scene feeds it the camera axes.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** pixels of the canvas that HUD panels cover on each side */
export interface Insets {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

export const NO_INSETS: Insets = { l: 0, r: 0, t: 0, b: 0 };

export function sameInsets(a: Insets, b: Insets): boolean {
  return a.l === b.l && a.r === b.r && a.t === b.t && a.b === b.b;
}

export function insetsActive(i: Insets): boolean {
  return i.l > 0 || i.r > 0 || i.t > 0 || i.b > 0;
}

/** size of the rectangle that stays free of HUD panels (at least 1 px so nothing divides by zero) */
export function usableSize(w: number, h: number, i: Insets): { w: number; h: number } {
  return { w: Math.max(1, w - i.l - i.r), h: Math.max(1, h - i.t - i.b) };
}

/**
 * Offset for `PerspectiveCamera.setViewOffset(w, h, x, y, w, h)` that moves the projection centre (where the
 * board's centre lands) into the middle of the usable rectangle.
 */
export function viewOffsetFor(i: Insets): { x: number; y: number } {
  return { x: -(i.l - i.r) / 2 || 0, y: -(i.t - i.b) / 2 || 0 };
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Smallest camera distance (from the board centre, along `toCamera`) at which every point projects into the
 * rectangle `usable` (pixels, centred on the projection centre). `focalPx` is the focal length in pixels
 * (`h / 2 / tan(fov / 2)` of the full canvas). A point at camera-space (x, y) with depth `d - P.toCamera` lands
 * `focalPx * x / depth` pixels from the centre, which gives a closed form per point.
 */
export function fitDistance(
  points: readonly Vec3[],
  axes: { right: Vec3; up: Vec3; toCamera: Vec3 },
  focalPx: number,
  usable: { w: number; h: number },
): number {
  let dist = 0;
  for (const p of points) {
    const along = dot(p, axes.toCamera);
    const sideways = (2 * focalPx * Math.abs(dot(p, axes.right))) / usable.w;
    const upwards = (2 * focalPx * Math.abs(dot(p, axes.up))) / usable.h;
    dist = Math.max(dist, along + sideways, along + upwards);
  }
  return dist;
}
