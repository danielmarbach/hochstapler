import type { BufferGeometry, Light, Material, Object3D, Texture } from "three";

/**
 * Resources flagged with `userData.shared = true` (cached GLB assets, the skyscraper window texture)
 * are owned by a module-level cache and are never disposed by scene teardown.
 */
export function markShared(res: { userData: Record<string, unknown> }): void {
  res.userData.shared = true;
}

const isShared = (res: { userData: Record<string, unknown> }): boolean =>
  res.userData.shared === true;
const isTexture = (v: unknown): v is Texture =>
  typeof v === "object" && v !== null && (v as { isTexture?: unknown }).isTexture === true;

function disposeMaterial(m: Material): void {
  if (isShared(m)) {
    return;
  }
  for (const v of Object.values(m)) {
    if (isTexture(v) && !isShared(v)) {
      v.dispose();
    }
  }
  m.dispose();
}

/** Disposes geometries, materials, textures (and light shadow maps) below `root`; `root` itself is not detached. */
export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const geometry = (o as { geometry?: BufferGeometry }).geometry;
    if (geometry && !isShared(geometry)) {
      geometry.dispose();
    }
    const material = (o as { material?: Material | Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
    if ((o as { isLight?: unknown }).isLight === true) {
      const light = o as Light & { shadow?: { dispose(): void } };
      light.shadow?.dispose();
      light.dispose?.();
    }
  });
}

/** Detaches every child of `group` and disposes it. */
export function clearGroup(group: Object3D): void {
  for (const c of [...group.children]) {
    group.remove(c);
    disposeTree(c);
  }
}
