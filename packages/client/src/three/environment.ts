import { at } from "../safe.ts";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  DoubleSide,
  type BufferGeometry,
} from "three";

export interface EnvInfo {
  group: Group;
  skyTop: string;
  skyBottom: string;
  fog: string;
  water: { shallow: string; deep: string; horizon: string };
}

function m(color: string, rough = 0.9, flat = true): MeshStandardMaterial {
  const x = new MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  x.flatShading = flat;
  return x;
}
function add(
  g: Group,
  geo: BufferGeometry,
  mat: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
): Mesh {
  const o = new Mesh(geo, mat);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  g.add(o);
  return o;
}
function rng(seed: number): () => number {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function ring(
  r0: number,
  r1: number,
  n: number,
  rnd: () => number,
  f: (x: number, z: number, a: number, i: number) => void,
): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
    const r = r0 + rnd() * (r1 - r0);
    f(Math.cos(a) * r, Math.sin(a) * r, a, i);
  }
}

function alps(g: Group): void {
  const rnd = rng(11);
  const rock = [m("#9aa3b5"), m("#8f98ad"), m("#a8b0c2")];
  const snow = m("#fbfdff", 0.7);
  ring(34, 62, 22, rnd, (x, z, _a, i) => {
    const h = 12 + rnd() * 16,
      r = 6 + rnd() * 5;
    const c = add(g, new ConeGeometry(r, h, 5 + (i % 3)), at(rock, i % 3), x, h / 2 - 2, z);
    c.rotation.y = rnd() * 3;
    add(
      g,
      new ConeGeometry(r * 0.42, h * 0.34, 5 + (i % 3)),
      snow,
      x,
      h - h * 0.17 - 2,
      z,
    ).rotation.y = c.rotation.y;
  });
}

function paris(g: Group): void {
  const rnd = rng(5);
  const wall = [m("#f1e4cf"), m("#e8d6bb"), m("#f4ead8")];
  const roof = m("#7d8aa0");
  ring(34, 62, 80, rnd, (x, z, a, i) => {
    const w = 3 + rnd() * 3,
      h = 3 + rnd() * 4,
      d = 3 + rnd() * 3;
    const b = add(g, new BoxGeometry(w, h, d), at(wall, i % 3), x, h / 2 - 1, z);
    b.rotation.y = -a;
    const r = add(g, new BoxGeometry(w * 1.02, 1.1, d * 1.02), roof, x, h - 1 + 0.55, z);
    r.rotation.y = -a;
    r.scale.set(1, 1, 1);
    for (let c = 0; c < 2; c++)
      add(g, new BoxGeometry(0.3, 0.9, 0.3), m("#b86f52"), x + (c - 0.5) * w * 0.4, h + 0.8, z);
  });
  // distant eiffel silhouette
  const iron = m("#8a7b70", 0.5, false);
  const cx = -30,
    cz = -42;
  const stage = (r0: number, r1: number, y: number, h: number) =>
    add(g, new CylinderGeometry(r1, r0, h, 4, 1, true), iron, cx, y + h / 2, cz).rotateY(
      Math.PI / 4,
    );
  (iron as MeshStandardMaterial).side = DoubleSide;
  stage(7, 4.4, 0, 14);
  stage(4.4, 2.4, 14, 14);
  stage(2.4, 0.9, 28, 12);
  stage(0.9, 0.15, 40, 10);
}

function berlin(g: Group): void {
  const rnd = rng(9);
  const cols = [m("#9aa6b8"), m("#b8bfcc"), m("#8793a8"), m("#c9ccd6")];
  const glass = new MeshStandardMaterial({ color: "#7fa0bf", roughness: 0.2, metalness: 0.5 });
  ring(36, 66, 64, rnd, (x, z, a, i) => {
    const w = 3 + rnd() * 5,
      h = 4 + rnd() * 20,
      d = 3 + rnd() * 5;
    add(
      g,
      new BoxGeometry(w, h, d),
      i % 4 === 0 ? glass : at(cols, i % 4),
      x,
      h / 2 - 1.5,
      z,
    ).rotation.y = -a;
  });
  const cx = 30,
    cz = -40;
  add(g, new CylinderGeometry(0.7, 1.2, 38, 12), m("#d4d6dc", 0.4, false), cx, 17, cz);
  add(g, new SphereGeometry(3.2, 16, 12), m("#c9ccd4", 0.3, false), cx, 33, cz);
  add(g, new CylinderGeometry(0.1, 0.4, 12, 8), m("#e6483d", 0.4, false), cx, 44, cz);
}

function tuscany(g: Group): void {
  const rnd = rng(3);
  const hills = [m("#c8cf8b", 0.95, false), m("#a9bd76", 0.95, false), m("#d9c98a", 0.95, false)];
  ring(30, 60, 18, rnd, (x, z, _a, i) => {
    const s = 10 + rnd() * 12;
    const h = add(g, new SphereGeometry(s, 20, 12), at(hills, i % 3), x, -s * 0.55, z);
    h.scale.y = 0.45 + rnd() * 0.2;
  });
  const cyp = m("#3e6b4a", 0.9, false);
  ring(34, 56, 40, rnd, (x, z) => {
    const h = 3 + rnd() * 2.5;
    add(g, new ConeGeometry(0.6, h, 8), cyp, x, h / 2 - 0.6, z);
  });
  // small villa
  const wall = m("#f0d9ae"),
    roof = m("#c0623e");
  for (const [x, z] of [
    [-24, -26],
    [22, -30],
    [34, 8],
  ] as const) {
    add(g, new BoxGeometry(4, 2.4, 3), wall, x, 0.6, z);
    add(g, new ConeGeometry(3.2, 1.4, 4), roof, x, 2.5, z).rotation.y = Math.PI / 4;
  }
}

function generic(g: Group): void {
  const rnd = rng(1);
  ring(34, 58, 18, rnd, (x, z) => {
    const s = 8 + rnd() * 8;
    add(g, new SphereGeometry(s, 14, 10), m("#a9c59a", 0.95, false), x, -s * 0.6, z);
  });
}

export function buildEnvironment(key: string): EnvInfo {
  const group = new Group();
  const info: EnvInfo = {
    group,
    skyTop: "#7cc0ee",
    skyBottom: "#fff0d2",
    fog: "#f6ead2",
    water: { shallow: "#8fdcd0", deep: "#35a3b3", horizon: "#dff1ee" },
  };
  switch (key) {
    case "alps":
      alps(group);
      Object.assign(info, {
        skyTop: "#6db6ee",
        skyBottom: "#fdf0d8",
        fog: "#eef0ea",
        water: { shallow: "#86e3d6", deep: "#1f9fb0", horizon: "#e4f2f0" },
      });
      break;
    case "paris":
      paris(group);
      Object.assign(info, {
        skyTop: "#8fb8ea",
        skyBottom: "#ffe6d2",
        fog: "#f4e6dc",
        water: { shallow: "#9fcbe6", deep: "#4f86b9", horizon: "#e6eaf2" },
      });
      break;
    case "berlin":
      berlin(group);
      Object.assign(info, {
        skyTop: "#86a8d4",
        skyBottom: "#f6e5d3",
        fog: "#e8e1da",
        water: { shallow: "#9cc4d4", deep: "#4f7d97", horizon: "#e3e6ea" },
      });
      break;
    case "tuscany":
      tuscany(group);
      Object.assign(info, {
        skyTop: "#78b7ea",
        skyBottom: "#ffe8bd",
        fog: "#f6e8c6",
        water: { shallow: "#a3ead2", deep: "#2fa3b2", horizon: "#f0f1de" },
      });
      break;
    default:
      generic(group);
  }
  return info;
}

export function buildSky(top: string, bottom: string): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new Color(top) }, bottom: { value: new Color(bottom) } },
    vertexShader:
      "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = smoothstep(-0.05, 0.75, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
  });
  const sky = new Mesh(new SphereGeometry(300, 24, 16), mat);
  sky.renderOrder = -1;
  return sky;
}
