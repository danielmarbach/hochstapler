import { at } from "../safe.ts";
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";

export const ISLAND_HALF = 10.4;
/** water level relative to the top of the island */
export const WATER_DEPTH = 2.0;

function rnd(seed: number): () => number {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}

interface Layer {
  y: number;
  s: number;
  col: string;
  amp: number;
}
const LAYERS: Layer[] = [
  { y: 0.0, s: 1.0, col: "#9ccf6e", amp: 0.01 },
  { y: -0.3, s: 1.02, col: "#82bb5c", amp: 0.012 },
  { y: -0.3, s: 1.02, col: "#c79a63", amp: 0.012 },
  { y: -0.5, s: 0.985, col: "#b98a57", amp: 0.02 },
  { y: -1.4, s: 0.96, col: "#a97848", amp: 0.03 },
  { y: -2.5, s: 0.9, col: "#8f6b47", amp: 0.04 },
  { y: -2.5, s: 0.9, col: "#9b958f", amp: 0.04 },
  { y: -3.6, s: 0.76, col: "#85807f", amp: 0.07 },
  { y: -4.8, s: 0.5, col: "#6f6a6d", amp: 0.09 },
  { y: -5.6, s: 0.22, col: "#625d62", amp: 0.1 },
];

function superR(a: number, half: number, p = 5): number {
  const c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a));
  return half / Math.pow(Math.pow(c, p) + Math.pow(s, p), 1 / p);
}

/** chunky, faceted floating plinth with vertex-colour variation (storybook look) */
export function buildIsland(topY: number): { mesh: Mesh; half: number } {
  const N = 112;
  const r = rnd(42);
  const phase = LAYERS.map(() => [r() * 6, r() * 6, r() * 6]);
  const pos: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  const tmp = new Color();
  const ringVerts = (li: number, shade = 0) => {
    const L = at(LAYERS, li);
    const base = pos.length / 3;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const [p1 = 0, p2 = 0, p3 = 0] = at(phase, li);
      const n =
        Math.sin(a * 3 + p1) * 0.5 + Math.sin(a * 7 + p2) * 0.3 + Math.sin(a * 13 + p3) * 0.2;
      const rr = superR(a, ISLAND_HALF * L.s) * (1 + n * L.amp);
      pos.push(Math.cos(a) * rr, topY + L.y, Math.sin(a) * rr);
      tmp.set(L.col).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.06, (r() - 0.5) * 0.07 + shade);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    return base;
  };
  const rings: number[] = LAYERS.map((_, i) => ringVerts(i));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      const a = at(rings, i) + k,
        b = at(rings, i) + k2,
        c = at(rings, i + 1) + k,
        d = at(rings, i + 1) + k2;
      idx.push(a, c, b, b, c, d);
    }
  }
  // grass top cap: 3 concentric rings + centre
  const caps: number[] = [];
  for (const [s, sh] of [
    [1.0, 0],
    [0.82, 0.02],
    [0.6, -0.015],
  ] as const) {
    const base = pos.length / 3;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const rr = superR(a, ISLAND_HALF * s);
      pos.push(Math.cos(a) * rr, topY + (s < 1 ? 0.02 : 0), Math.sin(a) * rr);
      tmp.set("#9ccf6e").offsetHSL((r() - 0.5) * 0.03, 0, sh + (r() - 0.5) * 0.06);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    caps.push(base);
  }
  for (let i = 0; i < caps.length - 1; i++) {
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      const a = at(caps, i) + k,
        b = at(caps, i) + k2,
        c = at(caps, i + 1) + k,
        d = at(caps, i + 1) + k2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const centre = pos.length / 3;
  pos.push(0, topY + 0.02, 0);
  col.push(0.55, 0.78, 0.4);
  const last = at(caps, caps.length - 1);
  for (let k = 0; k < N; k++) idx.push(centre, last + k, last + ((k + 1) % N));
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  const mesh = new Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // half-width at the waterline for the shader's foam ring
  const wy = -WATER_DEPTH;
  let half = ISLAND_HALF;
  for (let i = 0; i < LAYERS.length - 1; i++) {
    const a = at(LAYERS, i),
      b = at(LAYERS, i + 1);
    if (wy <= a.y && wy >= b.y && a.y !== b.y) {
      half = ISLAND_HALF * (a.s + ((wy - a.y) / (b.y - a.y)) * (b.s - a.s));
      break;
    }
  }
  return { mesh, half };
}

function fm(color: string, rough = 1): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  m.flatShading = true;
  return m;
}
function put(
  g: Group,
  geo: BufferGeometry,
  mat: Material,
  x: number,
  y: number,
  z: number,
  sy = 1,
): Mesh {
  const o = new Mesh(geo, mat);
  o.position.set(x, y, z);
  o.scale.y = sy;
  o.castShadow = true;
  o.receiveShadow = true;
  g.add(o);
  return o;
}

export type TreeKind = "pine" | "round" | "cypress";
export function treeKindFor(env: string): TreeKind {
  return env === "alps" ? "pine" : env === "tuscany" ? "cypress" : "round";
}

export function makeTree(kind: TreeKind, r: () => number, y: number): Group {
  const g = new Group();
  const s = 0.8 + r() * 0.6;
  put(g, new CylinderGeometry(0.07 * s, 0.1 * s, 0.4 * s, 6), fm("#8a5d3b"), 0, y + 0.2 * s, 0);
  if (kind === "pine") {
    const c = at(["#3f7f56", "#4a8c60", "#37724c"], Math.floor(r() * 3));
    for (let i = 0; i < 3; i++)
      put(
        g,
        new ConeGeometry((0.55 - i * 0.13) * s, 0.7 * s, 7),
        fm(c),
        0,
        y + (0.55 + i * 0.4) * s,
        0,
      );
  } else if (kind === "cypress") {
    put(
      g,
      new ConeGeometry(0.28 * s, 1.9 * s, 7),
      fm(at(["#3d6b48", "#477a52"], Math.floor(r() * 2))),
      0,
      y + 1.1 * s,
      0,
    );
  } else {
    const c = at(["#7fbf5a", "#6cae52", "#94c963", "#e7a85a"], Math.floor(r() * 4));
    const o = put(g, new SphereGeometry(0.55 * s, 8, 6), fm(c), 0, y + 0.85 * s, 0);
    o.scale.set(1, 0.9, 1);
    put(g, new SphereGeometry(0.34 * s, 7, 5), fm(c), 0.3 * s, y + 0.6 * s, 0.1);
  }
  return g;
}

/** trees, rocks, bushes and flowers on the grass rim around the board */
export function decorateIsland(topY: number, env: string): Group {
  const g = new Group();
  const r = rnd(7);
  const kind = treeKindFor(env);
  const rockM = [fm("#a9a49e"), fm("#968f89"), fm("#b6b1ab")];
  for (let i = 0; i < 44; i++) {
    const a = r() * Math.PI * 2;
    const rad = 9.15 + r() * 1.0;
    const rr = superR(a, rad, 5);
    const x = Math.cos(a) * rr,
      z = Math.sin(a) * rr;
    if (Math.max(Math.abs(x), Math.abs(z)) < 8.7) continue;
    if (Math.max(Math.abs(x), Math.abs(z)) > ISLAND_HALF - 0.45) continue;
    const front = z > 8.7 && Math.abs(x) < 6;
    const k = r();
    if (k < 0.42 && !front) {
      const t = makeTree(kind, r, topY);
      t.position.set(x, 0, z);
      t.rotation.y = r() * 6;
      g.add(t);
    } else if (k < 0.62) {
      const s = 0.18 + r() * 0.3;
      const rk = put(
        g,
        new DodecahedronGeometry(s, 0),
        at(rockM, Math.floor(r() * 3)),
        x,
        topY + s * 0.4,
        z,
        0.7,
      );
      rk.rotation.set(r() * 3, r() * 3, r() * 3);
    } else if (k < 0.8) {
      put(
        g,
        new SphereGeometry(0.22 + r() * 0.1, 7, 5),
        fm(at(["#6aa84f", "#7fbf5a"], Math.floor(r() * 2))),
        x,
        topY + 0.14,
        z,
        0.7,
      );
    } else {
      const c = at(["#f7f1e3", "#f4b6c2", "#f7d15e", "#c9a7e8"], Math.floor(r() * 4));
      for (let f = 0; f < 3; f++)
        put(
          g,
          new SphereGeometry(0.06, 6, 4),
          fm(c, 0.7),
          x + (r() - 0.5) * 0.4,
          topY + 0.07,
          z + (r() - 0.5) * 0.4,
        );
    }
  }
  return g;
}

/** a few small rocky islets with a tree each, to make the water feel inhabited */
export function makeIslets(env: string, waterY: number): Group {
  const g = new Group();
  const r = rnd(99);
  const kind = treeKindFor(env);
  const spots: [number, number, number][] = [
    [-19, -9, 1.6],
    [17, -15, 1.3],
    [-14, 17, 1.1],
    [21, 11, 1.4],
  ];
  for (const [x, z, s] of spots) {
    const base = new Mesh(new CylinderGeometry(s * 0.7, s, 1.3, 7), fm("#9a948d"));
    base.position.set(x, waterY + 0.1, z);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    const top = new Mesh(new CylinderGeometry(s * 0.72, s * 0.72, 0.18, 7), fm("#8ec266"));
    top.position.set(x, waterY + 0.75, z);
    g.add(top);
    const t = makeTree(kind, r, waterY + 0.84);
    t.position.set(x, 0, z);
    g.add(t);
  }
  return g;
}

export function makeWater(
  colors: { shallow: string; deep: string; horizon: string },
  half: number,
  y: number,
): { mesh: Mesh; uniforms: Record<string, { value: unknown }> } {
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color(colors.shallow) },
    uDeep: { value: new Color(colors.deep) },
    uHorizon: { value: new Color(colors.horizon) },
    uFoam: { value: new Color("#fffdf4") },
    uLight: { value: new Color("#fff6d8") },
    uHalf: { value: half },
  };
  const m = new ShaderMaterial({
    uniforms,
    vertexShader:
      "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uHorizon; uniform vec3 uFoam; uniform vec3 uLight; uniform float uHalf;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y); }
      void main(){
        vec2 p = vW.xz;
        float d = pow(pow(abs(p.x),5.0) + pow(abs(p.y),5.0), 0.2);
        float edge = d - uHalf;
        float depth = smoothstep(0.0, 16.0, edge);
        vec3 col = mix(uShallow, uDeep, depth);
        float c = noise(p*0.8 + vec2(uTime*0.22, uTime*0.15)) * noise(p*1.6 - vec2(uTime*0.18, -uTime*0.25));
        col += uLight * smoothstep(0.2, 0.52, c) * 0.13 * (1.0 - depth*0.5);
        float ring = sin(edge*2.6 - uTime*1.1 + noise(p*0.5)*4.0) * 0.5 + 0.5;
        col = mix(col, uFoam, smoothstep(0.88, 1.0, ring) * 0.2 * (1.0 - smoothstep(0.0, 7.0, edge)));
        float fn = noise(p*2.4 + vec2(uTime*0.2, 0.0));
        float foam = 1.0 - smoothstep(0.15, 0.7 + fn*0.6, edge);
        col = mix(col, uFoam, foam * 0.95);
        float sp = step(0.985, noise(p*5.0 + uTime*0.5)) * 0.35 * (1.0 - depth*0.4);
        col += vec3(sp);
        float far = smoothstep(45.0, 190.0, length(p));
        col = mix(col, uHorizon, far);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(900, 900, 1, 1), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = false;
  return { mesh, uniforms };
}

void Vector3;
