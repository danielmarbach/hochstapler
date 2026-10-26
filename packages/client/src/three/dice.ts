import { at, context2d } from "../safe.ts";
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { tween } from "./tween.ts";
import { TILE_TOP } from "./layout.ts";

// BoxGeometry material order: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUE = [3, 4, 1, 6, 2, 5];
const FACE_NORMAL = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

function faceTexture(n: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = context2d(c);
  x.fillStyle = "#fbf6ea";
  x.fillRect(0, 0, 128, 128);
  const pos: Record<number, [number, number][]> = {
    1: [[64, 64]],
    2: [
      [34, 34],
      [94, 94],
    ],
    3: [
      [34, 34],
      [64, 64],
      [94, 94],
    ],
    4: [
      [34, 34],
      [94, 34],
      [34, 94],
      [94, 94],
    ],
    5: [
      [34, 34],
      [94, 34],
      [64, 64],
      [34, 94],
      [94, 94],
    ],
    6: [
      [34, 30],
      [94, 30],
      [34, 64],
      [94, 64],
      [34, 98],
      [94, 98],
    ],
  };
  for (const [px, py] of at(pos, n)) {
    x.beginPath();
    x.arc(px, py, n === 1 ? 17 : 11, 0, Math.PI * 2);
    x.fillStyle = n === 1 ? "#d9483b" : "#3d2a1a";
    x.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Dice {
  readonly group = new Group();
  private dice: Mesh[] = [];
  private rest = TILE_TOP + 0.4;
  private spots = [new Vector3(-0.85, 0, 4.5), new Vector3(0.85, 0, 4.9)]; // in front of the title (inner area ends at z = 6)
  constructor() {
    const mats = FACE_VALUE.map(
      (v) => new MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35, metalness: 0.05 }),
    );
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(new RoundedBoxGeometry(0.8, 0.8, 0.8, 3, 0.12), mats);
      m.castShadow = true;
      m.visible = false;
      m.position.copy(at(this.spots, i)).setY(this.rest);
      this.group.add(m);
      this.dice.push(m);
    }
  }

  private finalQuat(value: number, yaw: number): Quaternion {
    const idx = FACE_VALUE.indexOf(value);
    const q = new Quaternion().setFromUnitVectors(at(FACE_NORMAL, idx), new Vector3(0, 1, 0));
    return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(q);
  }

  show(values: [number, number]): void {
    this.dice.forEach((d, i) => {
      d.visible = true;
      d.position.copy(at(this.spots, i)).setY(this.rest);
      d.quaternion.copy(this.finalQuat(at(values, i), i * 0.7 + 0.3));
    });
  }

  async roll(values: [number, number]): Promise<void> {
    const jobs = this.dice.map((d, i) => {
      d.visible = true;
      const target = at(this.spots, i)
        .clone()
        .add(new Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.4))
        .setY(this.rest);
      const start = new Vector3(-3 + i * 1.2, 6.5, 8.5);
      const qFinal = this.finalQuat(at(values, i), Math.random() * Math.PI * 2);
      const axis = new Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const spins = 5 + Math.random() * 3;
      const qs = new Quaternion();
      return tween(
        1.25 + i * 0.12,
        (k) => {
          const e = 1 - Math.pow(1 - k, 3);
          d.position.lerpVectors(start, target, e);
          d.position.y =
            this.rest +
            (1 - k) * (1 - k) * (start.y - this.rest) +
            0.7 * (1 - k) * Math.abs(Math.sin(k * Math.PI * 3));
          qs.setFromAxisAngle(axis, (1 - e) * spins * Math.PI * 2);
          d.quaternion.copy(qs).multiply(qFinal);
        },
        "none",
      );
    });
    await Promise.all(jobs);
  }
}
