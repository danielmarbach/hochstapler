import { attemptSync } from "@poly/engine";
/** Device capabilities that steer rendering quality and default UI state (read once at start-up). */

const hasWindow = typeof window !== "undefined";

/** primary pointer is a finger: phones and most tablets */
export const IS_TOUCH: boolean = hasWindow && window.matchMedia("(pointer: coarse)").matches;

/**
 * Minimal rendering (no shadows/bloom, low resolution, a few frames per second) for the browser E2E suite, where
 * WebGL runs in software. Switched on with `localStorage['poly:lite'] = '1'`; never active for normal players.
 */
export const LITE_RENDER: boolean = hasWindow && readFlag("poly:lite");

function readFlag(key: string): boolean {
  const r = attemptSync("platform:flag", () => localStorage.getItem(key) === "1");
  return r.ok && r.value;
}

const reducedMotionQuery: MediaQueryList | null = hasWindow
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

/**
 * The user (or the E2E suite) asked for reduced motion. Read live: the preference can change while the page is open.
 * Non-essential 3D motion then jumps to its final state (UI review F06).
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}

/** calls `fn` whenever the reduced-motion preference changes; returns the unsubscribe function */
export function onReducedMotionChange(fn: (reduced: boolean) => void): () => void {
  const query = reducedMotionQuery;
  if (!query) {
    return () => undefined;
  }
  const listener = (e: MediaQueryListEvent) => fn(e.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** few CPU cores: render at a lower resolution */
export const IS_LOW_END: boolean = hasWindow && (navigator.hardwareConcurrency || 8) <= 4;

/** upper bound for renderer.setPixelRatio */
export const MAX_PIXEL_RATIO: number = IS_LOW_END ? 1.5 : 2;

export const SHADOW_MAP_SIZE: number = IS_TOUCH ? 1024 : 2048;

export type LayoutKind = "phone-portrait" | "phone-landscape" | "tablet" | "desktop";

export const LAYOUT_QUERIES = {
  phonePortrait: "(max-width: 599px)",
  phoneLandscape: "(orientation: landscape) and (max-height: 500px)",
  tablet: "(max-width: 1100px)",
} as const;

export function currentLayout(): LayoutKind {
  if (!hasWindow) {
    return "desktop";
  }
  if (window.matchMedia(LAYOUT_QUERIES.phonePortrait).matches) {
    return "phone-portrait";
  }
  if (window.matchMedia(LAYOUT_QUERIES.phoneLandscape).matches) {
    return "phone-landscape";
  }
  if (window.matchMedia(LAYOUT_QUERIES.tablet).matches) {
    return "tablet";
  }
  return "desktop";
}
