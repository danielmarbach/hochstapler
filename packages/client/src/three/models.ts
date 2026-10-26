import { at, context2d } from "../safe.ts";
import type { Object3D } from "three";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Shape,
  TorusGeometry,
  SRGBColorSpace,
  RepeatWrapping,
  type BufferGeometry,
} from "three";
import { markShared } from "./dispose.ts";

function mat(color: string | number, rough = 0.6, metal = 0.05): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}
function mesh(g: BufferGeometry, m: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// ---------- tokens (each ~1.2 tall, radius <= 0.5, distinct silhouettes) ----------
const TOKEN_BUILDERS: ((c: MeshStandardMaterial) => Object3D)[] = [
  // pawn
  (c) => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.4, 0.5, 0.18, 24), c, 0, 0.09));
    g.add(mesh(new ConeGeometry(0.34, 0.8, 24), c, 0, 0.55));
    g.add(mesh(new SphereGeometry(0.26, 24, 16), c, 0, 1.0));
    return g;
  },
  // top hat
  (c) => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.5, 0.5, 0.08, 28), c, 0, 0.04));
    g.add(mesh(new CylinderGeometry(0.32, 0.32, 0.8, 28), c, 0, 0.48));
    g.add(mesh(new CylinderGeometry(0.335, 0.335, 0.14, 28), mat("#3d2a1a", 0.5), 0, 0.3));
    return g;
  },
  // car
  (c) => {
    const g = new Group();
    g.add(mesh(new BoxGeometry(0.95, 0.28, 0.5), c, 0, 0.3));
    g.add(mesh(new BoxGeometry(0.5, 0.26, 0.42), c, -0.05, 0.54));
    const w = mat("#3d2a1a", 0.8);
    for (const sx of [-0.3, 0.3])
      for (const sz of [-0.27, 0.27]) {
        const wh = mesh(new CylinderGeometry(0.14, 0.14, 0.1, 16), w, sx, 0.15, sz);
        wh.rotation.x = Math.PI / 2;
        g.add(wh);
      }
    return g;
  },
  // ship / boat
  (c) => {
    const g = new Group();
    g.add(mesh(new BoxGeometry(1, 0.25, 0.45), c, 0, 0.2));
    const bow = mesh(new ConeGeometry(0.22, 0.5, 4), c, 0.65, 0.2);
    bow.rotation.z = -Math.PI / 2;
    g.add(bow);
    g.add(mesh(new CylinderGeometry(0.03, 0.03, 0.85, 8), mat("#6d5a48"), 0, 0.8));
    g.add(mesh(new BoxGeometry(0.02, 0.6, 0.45), mat("#fff8ee", 0.9), 0.02, 0.85, 0));
    return g;
  },
  // bell / chess rook
  (c) => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.45, 0.5, 0.15, 24), c, 0, 0.08));
    g.add(mesh(new CylinderGeometry(0.28, 0.4, 0.7, 24), c, 0, 0.5));
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.add(
        mesh(new BoxGeometry(0.16, 0.18, 0.16), c, Math.cos(a) * 0.24, 1.0, Math.sin(a) * 0.24),
      );
    }
    return g;
  },
  // gem
  (c) => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.38, 0.45, 0.14, 6), c, 0, 0.07));
    const o = mesh(new OctahedronGeometry(0.42), c, 0, 0.75);
    o.scale.y = 1.5;
    g.add(o);
    return g;
  },
  // ball on stand
  (c) => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.45, 0.5, 0.14, 24), c, 0, 0.07));
    g.add(mesh(new CylinderGeometry(0.1, 0.16, 0.5, 12), c, 0, 0.4));
    g.add(mesh(new SphereGeometry(0.38, 24, 16), c, 0, 0.9));
    return g;
  },
  // barrel / drum
  (c) => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.4, 0.4, 0.9, 20), c, 0, 0.45));
    g.add(
      mesh(new TorusGeometry(0.4, 0.04, 8, 24), mat("#cfc8bd", 0.4, 0.5), 0, 0.25).rotateX(
        Math.PI / 2,
      ),
    );
    g.add(
      mesh(new TorusGeometry(0.4, 0.04, 8, 24), mat("#cfc8bd", 0.4, 0.5), 0, 0.7).rotateX(
        Math.PI / 2,
      ),
    );
    g.add(mesh(new DodecahedronGeometry(0.17), mat("#fff3d6", 0.4), 0, 1.0));
    return g;
  },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function makeTokenFallback(tokenId: string, color: string, orderHint = 0): Object3D {
  const g = new Group();
  const m = mat(color, 0.35, 0.1);
  const idx = (hashStr(tokenId) + orderHint * 0) % TOKEN_BUILDERS.length;
  g.add(at(TOKEN_BUILDERS, idx)(m));
  return g;
}

/** height of the base disc; token models stand on top of it */
export const TOKEN_BASE_HEIGHT = 0.08;

/**
 * Coloured base for a token: a dark outline disc (reads on light and dark tiles), the player-coloured disc and a
 * slightly emissive rim. The token model itself is never tinted, so GLB textures stay untouched.
 */
/** Bases are flat discs lying on the tile: bias them in the depth buffer so they never flicker against it. */
const BASE_DEPTH_BIAS = {
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
} as const;

export function makeTokenBase(color: string): Group {
  const g = new Group();
  const outline = mesh(
    new CylinderGeometry(0.47, 0.47, 0.03, 36),
    new MeshStandardMaterial({ color: "#1d1814", roughness: 0.7, ...BASE_DEPTH_BIAS }),
    0,
    0.015,
  );
  outline.castShadow = false;
  g.add(outline);
  const disc = mesh(
    new CylinderGeometry(0.42, 0.44, TOKEN_BASE_HEIGHT, 36),
    new MeshStandardMaterial({
      color,
      roughness: 0.4,
      emissive: new Color(color),
      emissiveIntensity: 0.18,
    }),
    0,
    TOKEN_BASE_HEIGHT / 2,
  );
  g.add(disc);
  const rim = mesh(
    new TorusGeometry(0.42, 0.04, 8, 48),
    new MeshStandardMaterial({
      color,
      roughness: 0.3,
      emissive: new Color(color),
      emissiveIntensity: 0.65,
    }),
    0,
    TOKEN_BASE_HEIGHT,
  );
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = false;
  g.add(rim);
  return g;
}

// ---------- buildings ----------
export function makeHouse(): Object3D {
  const g = new Group();
  g.add(mesh(new BoxGeometry(1, 0.6, 0.85), mat("#f7efe0", 0.8), 0, 0.3, 0));
  const s = new Shape();
  s.moveTo(-0.62, 0);
  s.lineTo(0, 0.55);
  s.lineTo(0.62, 0);
  s.lineTo(-0.62, 0);
  const roof = mesh(
    new ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: false }),
    mat("#c8553d", 0.7),
    0,
    0.6,
    -0.5,
  );
  roof.rotation.y = 0;
  g.add(roof);
  g.add(mesh(new BoxGeometry(0.2, 0.34, 0.06), mat("#7a5a44"), 0, 0.17, 0.44));
  g.add(mesh(new BoxGeometry(0.2, 0.2, 0.06), mat("#9ed0e8", 0.2), 0.3, 0.38, 0.44));
  g.scale.setScalar(1.15);
  return g;
}

export function makeHotel(): Object3D {
  const g = new Group();
  g.add(mesh(new BoxGeometry(3.4, 1.2, 1.5), mat("#c4443f", 0.65), 0, 0.6, 0));
  g.add(mesh(new BoxGeometry(3.6, 0.16, 1.7), mat("#8f2f2c", 0.7), 0, 1.28, 0));
  const win = mat("#ffe9a8", 0.3);
  win.emissive = new Color("#ffcf70");
  win.emissiveIntensity = 0.6;
  for (let i = -3; i <= 3; i++)
    for (const y of [0.45, 0.9])
      g.add(mesh(new BoxGeometry(0.28, 0.22, 0.04), win, i * 0.45, y, 0.76));
  g.add(mesh(new BoxGeometry(0.5, 0.5, 0.5), mat("#e6d9bf"), 0, 1.6, 0));
  return g;
}

let windowTex: CanvasTexture | null = null;
function skyscraperWindows(): CanvasTexture {
  if (windowTex) return windowTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const x = context2d(c);
  x.fillStyle = "#000";
  x.fillRect(0, 0, 128, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let r = 0; r < 20; r++)
    for (let q = 0; q < 8; q++) {
      if (rnd() > 0.35) {
        x.fillStyle = rnd() > 0.5 ? "#ffe3a0" : "#bfe6ff";
        x.fillRect(q * 16 + 3, r * 12.8 + 3, 10, 7);
      }
    }
  windowTex = new CanvasTexture(c);
  windowTex.colorSpace = SRGBColorSpace;
  windowTex.wrapS = windowTex.wrapT = RepeatWrapping;
  markShared(windowTex);
  return windowTex;
}

export function makeSkyscraper(): Object3D {
  const g = new Group();
  const tex = skyscraperWindows();
  const glass = new MeshStandardMaterial({
    color: "#4a6f93",
    roughness: 0.15,
    metalness: 0.6,
    emissive: new Color("#ffffff"),
    emissiveMap: tex,
    emissiveIntensity: 0.9,
  });
  g.add(mesh(new BoxGeometry(1.3, 4.2, 1.3), glass, 0, 2.1, 0));
  g.add(mesh(new BoxGeometry(0.9, 1.0, 0.9), glass, 0, 4.7, 0));
  g.add(mesh(new CylinderGeometry(0.02, 0.05, 1.1, 8), mat("#d9d9d9", 0.3, 0.8), 0, 5.7, 0));
  g.add(mesh(new BoxGeometry(1.45, 0.12, 1.45), mat("#e9e2d4"), 0, 0.06, 0));
  return g;
}

// ---------- landmarks (~1 unit tall footprint-ish, caller scales) ----------
function lattice(g: Group, m: MeshStandardMaterial): void {
  // Eiffel: stacked tapering frusta + legs
  const stages: [number, number, number, number][] = [
    [0.9, 0.55, 0.0, 0.32],
    [0.55, 0.3, 0.32, 0.3],
    [0.3, 0.12, 0.62, 0.22],
    [0.12, 0.02, 0.84, 0.16],
  ];
  for (const [r0, r1, y, h] of stages)
    g.add(
      mesh(new CylinderGeometry(r1 * 0.5, r0 * 0.5, h, 4, 1, true), m, 0, y + h / 2, 0).rotateY(
        Math.PI / 4,
      ),
    );
  for (const [x, z] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const leg = mesh(new BoxGeometry(0.06, 0.4, 0.06), m, x * 0.3, 0.2, z * 0.3);
    leg.rotation.z = -x * 0.35;
    leg.rotation.x = z * 0.35;
    g.add(leg);
  }
  g.add(mesh(new BoxGeometry(0.62, 0.025, 0.62), m, 0, 0.3, 0));
  g.add(mesh(new BoxGeometry(0.34, 0.025, 0.34), m, 0, 0.6, 0));
}

export function makeLandmarkFallback(name: string): Object3D {
  const g = new Group();
  const n = name.toLowerCase();
  if (n.includes("matterhorn") || n.includes("alp") || n.includes("mount")) {
    const rock = mat("#8b8f9a", 0.9);
    rock.flatShading = true;
    const snow = mat("#fbfdff", 0.7);
    snow.flatShading = true;
    const a = mesh(new ConeGeometry(0.55, 1.1, 5), rock, 0, 0.55, 0);
    a.rotation.y = 0.4;
    g.add(a);
    const b = mesh(new ConeGeometry(0.22, 0.4, 5), snow, 0, 0.92, 0);
    b.rotation.y = 0.4;
    g.add(b);
    const c = mesh(new ConeGeometry(0.35, 0.65, 5), rock, 0.38, 0.32, 0.12);
    g.add(c);
    g.add(mesh(new ConeGeometry(0.14, 0.2, 5), snow, 0.38, 0.55, 0.12));
  } else if (n.includes("eiffel") || n.includes("tour")) {
    lattice(g, mat("#6c5b4e", 0.5, 0.4));
  } else if (n.includes("gate") || n.includes("brandenburg") || n.includes("tor")) {
    const st = mat("#e7dcc4", 0.8);
    for (let i = 0; i < 6; i++)
      g.add(mesh(new CylinderGeometry(0.045, 0.05, 0.5, 12), st, -0.45 + i * 0.18, 0.28, 0));
    g.add(mesh(new BoxGeometry(1.1, 0.1, 0.2), st, 0, 0.58, 0));
    g.add(mesh(new BoxGeometry(1.1, 0.06, 0.26), st, 0, 0.03, 0));
    g.add(mesh(new BoxGeometry(0.4, 0.12, 0.14), mat("#b9894a", 0.4, 0.5), 0, 0.7, 0));
    g.add(mesh(new BoxGeometry(0.16, 0.12, 0.1), mat("#b9894a", 0.4, 0.5), 0, 0.8, 0));
  } else if (n.includes("colos") || n.includes("arena")) {
    const st = mat("#d9c29b", 0.9);
    for (let t = 0; t < 3; t++) {
      const ring = mesh(
        new CylinderGeometry(0.55 - t * 0.02, 0.55 - t * 0.02, 0.2, 28, 1, true),
        st,
        0,
        0.1 + t * 0.2,
        0,
      );
      ring.scale.z = 0.75;
      (ring.material as MeshStandardMaterial).side = 2;
      g.add(ring);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.add(
          mesh(
            new BoxGeometry(0.035, 0.12, 0.02),
            mat("#5b4a35"),
            Math.cos(a) * 0.55,
            0.1 + t * 0.2,
            Math.sin(a) * 0.55 * 0.75,
          ),
        );
      }
    }
  } else {
    g.add(mesh(new CylinderGeometry(0.35, 0.4, 0.15, 6), mat("#e7dcc4"), 0, 0.075, 0));
    g.add(mesh(new ConeGeometry(0.14, 1.1, 4), mat("#d6b46a", 0.4, 0.4), 0, 0.7, 0));
  }
  return g;
}
