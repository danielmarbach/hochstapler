import { at } from "../safe.ts";
import { Vector3 } from "three";

/** Board geometry: 4 corners (2x2) + 4 x 12 tiles (1 wide x 2 deep). Total edge = 16. Index 0 = bottom-right (+x,+z), counter-clockwise seen from above... see sides. */
export const TILE_W = 1;
export const CORNER = 2;
export const HALF = 8;
export const BOARD_Y = 0.06; // top of the base slab
export const TILE_H = 0.1;
export const TILE_TOP = BOARD_Y + TILE_H;

export interface TileLayout {
  index: number;
  side: 0 | 1 | 2 | 3;
  corner: boolean;
  cx: number;
  cz: number;
  w: number; // extent along side
  d: number; // extent in depth
  rotY: number;
}

const ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export function tileLayout(i: number): TileLayout {
  const side = (Math.floor(i / 13) % 4) as 0 | 1 | 2 | 3;
  const k = i % 13;
  const corner = k === 0;
  let cx: number, cz: number;
  if (corner) {
    cx = side === 0 || side === 3 ? 7 : -7;
    cz = side === 0 || side === 1 ? 7 : -7;
  } else if (side === 0) {
    cx = 6.5 - k;
    cz = 7;
  } else if (side === 1) {
    cx = -7;
    cz = 6.5 - k;
  } else if (side === 2) {
    cx = -6.5 + k;
    cz = -7;
  } else {
    cx = 7;
    cz = -6.5 + k;
  }
  return {
    index: i,
    side,
    corner,
    cx,
    cz,
    w: corner ? CORNER : TILE_W,
    d: CORNER,
    rotY: at(ROT, side),
  };
}

export const LAYOUTS: TileLayout[] = Array.from({ length: 52 }, (_, i) => tileLayout(i));

const Y = new Vector3(0, 1, 0);
/** world position of a local offset (x along the side, z toward the OUTSIDE) on tile i */
export function tilePoint(i: number, lx = 0, lz = 0, y = TILE_TOP): Vector3 {
  const l = at(LAYOUTS, ((i % 52) + 52) % 52);
  return new Vector3(lx, 0, lz).applyAxisAngle(Y, l.rotY).add(new Vector3(l.cx, y, l.cz));
}
