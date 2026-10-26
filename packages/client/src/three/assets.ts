import { Group, type Material, type Mesh, type Object3D } from "three";
import { attempt } from "@poly/engine";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { z } from "zod";
import { disposeTree, markShared } from "./dispose.ts";
import { invalidateAll } from "./invalidate.ts";

/** relative path below /assets/models/, no traversal, no scheme */
// eslint-disable-next-line security/detect-unsafe-regex -- segments are separated by "/", which the class excludes: no ambiguity, no backtracking blow-up
const SAFE_FILE = /^(?!.*\.\.)[\w.-]+(?:\/[\w.-]+)*$/;
const ManifestEntrySchema = z.object({
  file: z.string().regex(SAFE_FILE),
  scale: z.number().finite().optional(),
  rotationY: z.number().finite().optional(),
  yOffset: z.number().finite().optional(),
});
const ManifestSchema = z.record(z.string(), ManifestEntrySchema);
type Manifest = z.infer<typeof ManifestSchema>;

const BASE = "/assets/models/";
let manifestP: Promise<Manifest> | null = null;
const cache = new Map<string, Promise<Object3D | null>>();
const loader = new GLTFLoader();

export function loadManifest(): Promise<Manifest> {
  manifestP ??= fetch(BASE + "manifest.json")
    .then((r): Promise<unknown> => (r.ok ? r.json() : Promise.resolve({})))
    .then((j): Manifest => {
      const parsed = ManifestSchema.safeParse(j);
      if (!parsed.success) {
        console.warn("[assets] manifest.json invalid, fallback models active", parsed.error.issues);
        return {};
      }
      return parsed.data;
    })
    .catch((): Manifest => ({}));
  return manifestP;
}

function loadAsset(name: string): Promise<Object3D | null> {
  let p = cache.get(name);
  if (!p) {
    p = loadManifest().then(async (m) => {
      const e = m[name];
      if (!e) {
        return null;
      }
      const loaded = await attempt(
        `assets:${name}`,
        async () => {
          const gltf = await loader.loadAsync(BASE + e.file);
          const wrap = new Group();
          const inner = gltf.scene;
          inner.scale.setScalar(e.scale ?? 1);
          inner.rotation.y = e.rotationY ?? 0;
          inner.position.y = e.yOffset ?? 0;
          inner.traverse((o) => {
            const mesh = o as Mesh;
            if (!mesh.isMesh) {
              return;
            }
            o.castShadow = true;
            o.receiveShadow = true;
            // cached and cloned by reference: scene teardown must not dispose these
            markShared(mesh.geometry);
            const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach(markShared);
          });
          wrap.add(inner);
          return wrap as Object3D;
        },
        (_label, err) => {
          console.warn(`[assets] ${name} could not be loaded, fallback active`, err);
        },
      );
      return loaded.ok ? loaded.value : null;
    });
    cache.set(name, p);
  }
  return p;
}

/**
 * Returns a group holding the procedural fallback right away; if one of `names`
 * exists in the manifest (first match wins) the fallback is swapped for the GLB.
 * `unit` scales the whole thing (model/fallback are authored ~1 unit tall).
 */
export function instantiate(names: string | string[], fallback: () => Object3D, unit = 1): Group {
  const g = new Group();
  g.scale.setScalar(unit);
  const fb = fallback();
  g.add(fb);
  const list = Array.isArray(names) ? names : [names];
  void (async () => {
    const m = await loadManifest();
    const name = list.find((n) => m[n]);
    if (!name) return;
    const src = await loadAsset(name);
    if (!src) return;
    g.remove(fb);
    disposeTree(fb);
    g.add(src.clone(true));
    invalidateAll();
  })();
  return g;
}
