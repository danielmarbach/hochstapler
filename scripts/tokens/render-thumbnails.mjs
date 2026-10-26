// Renders every token GLB once into a static WebP thumbnail for the 2D UI (docs/DESIGN.md, token thumbnails).
//   npm run assets:tokens   → packages/client/public/assets/tokens/<id>.webp (+ /tmp/tokens-thumbs/contact.png)
// Headless Chromium (software WebGL) + three.js with the game's golden-hour light, transparent background.
// Deterministic: fixed camera, fixed lights, no randomness; re-running yields identical files.
import { createServer } from "node:http";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "@playwright/test";
/* global window */
import sharp from "sharp";

const root = resolve(new URL("../..", import.meta.url).pathname);
const modelsDir = join(root, "packages/client/public/assets/models");
const outDir = join(root, "packages/client/public/assets/tokens");
const sheetDir = "/tmp/tokens-thumbs";
const SIZE = 256;
const MIME = { ".js": "text/javascript", ".glb": "model/gltf-binary", ".html": "text/html" };

const ids = readdirSync(modelsDir)
  .filter((f) => /^token-[\w-]+\.glb$/.test(f))
  .map((f) => f.slice(6, -4))
  .sort();

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const SIZE = ${SIZE};
const canvas = document.createElement("canvas");
canvas.width = canvas.height = SIZE;
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight("#d6ecff", "#f2dcb4", 1.5));
scene.add(new THREE.AmbientLight("#fff1e0", 0.25));
const sun = new THREE.DirectionalLight("#fff0d0", 2.6);
sun.position.set(-14, 18, 12);
scene.add(sun);
const fill = new THREE.DirectionalLight("#bcd4ff", 0.6);
fill.position.set(14, 8, -10);
scene.add(fill);
const loader = new GLTFLoader();
window.renderToken = async (id) => {
  const gltf = await loader.loadAsync("/models/token-" + id + ".glb");
  const obj = gltf.scene;
  const group = new THREE.Group();
  group.add(obj);
  // slight 3/4 view from above, same for every token
  group.rotation.y = -Math.PI / 5;
  scene.add(group);
  // normalise: fit the projected silhouette (all vertices) into 88 % of the frame, centred; a few
  // iterations converge because moving the camera changes the perspective only slightly
  group.updateMatrixWorld(true);
  const pts = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  const bb = new THREE.Box3().setFromPoints(pts);
  const centre = bb.getCenter(new THREE.Vector3());
  const radius = bb.getBoundingSphere(new THREE.Sphere()).radius;
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 1000);
  const dir = new THREE.Vector3(0, 0.5, 1).normalize();
  let dist = radius / Math.sin(THREE.MathUtils.degToRad(12));
  const target = centre.clone();
  const v = new THREE.Vector3();
  for (let k = 0; k < 8; k++) {
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const ext = Math.max(x1 - x0, y1 - y0) / 2;
    dist *= ext / 0.88;
    const half = Math.tan(THREE.MathUtils.degToRad(12)) * dist;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, ((x0 + x1) / 2) * half).addScaledVector(up, ((y0 + y1) / 2) * half);
  }
  cam.position.copy(target).addScaledVector(dir, dist);
  cam.lookAt(target);
  renderer.render(scene, cam);
  const url = canvas.toDataURL("image/png");
  scene.remove(group);
  group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  return url;
};
window.ready = true;
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = null;
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    res.end(PAGE);
    return;
  }
  if (url.pathname.startsWith("/node_modules/three/")) file = join(root, url.pathname);
  else if (url.pathname.startsWith("/models/")) file = join(modelsDir, url.pathname.slice(8));
  if (!file || !normalize(file).startsWith(root)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  try {
    const body = readFileSync(file);
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

mkdirSync(outDir, { recursive: true });
mkdirSync(sheetDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const tiles = [];
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction("window.ready === true");
  let total = 0;
  for (const id of ids) {
    const dataUrl = await page.evaluate((i) => window.renderToken(i), id);
    const png = Buffer.from(dataUrl.split(",")[1], "base64");
    const webp = await sharp(png)
      .webp({ quality: 80, alphaQuality: 80, effort: 6, smartSubsample: true })
      .toBuffer();
    writeFileSync(join(outDir, `${id}.webp`), webp);
    total += webp.length;
    console.log(`${id}.webp ${webp.length} B`);
    const label = Buffer.from(
      `<svg width="${SIZE}" height="24"><text x="4" y="17" font-size="14" font-family="sans-serif">${id}</text></svg>`,
    );
    tiles.push(
      await sharp({
        create: { width: SIZE, height: SIZE + 24, channels: 4, background: "#8a6d9e" },
      })
        .composite([
          { input: png, top: 0, left: 0 },
          { input: label, top: SIZE, left: 0 },
        ])
        .png()
        .toBuffer(),
    );
  }
  console.log(`${ids.length} thumbnails, ${(total / 1024).toFixed(1)} KB total`);
} finally {
  await browser.close();
  server.close();
}
const cols = 8;
const rows = Math.ceil(tiles.length / cols);
await sharp({
  create: { width: cols * SIZE, height: rows * (SIZE + 24), channels: 4, background: "#ffffff" },
})
  .composite(
    tiles.map((input, i) => ({
      input,
      left: (i % cols) * SIZE,
      top: Math.floor(i / cols) * (SIZE + 24),
    })),
  )
  .png()
  .toFile(join(sheetDir, "contact.png"));
