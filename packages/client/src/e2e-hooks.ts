/**
 * Test-only hooks for the browser suite (e.g. the screen positions of the board corners). Compiled in only when the
 * bundle is built with `POLY_E2E_HOOKS=1` (see vite.config.ts and the Playwright web server command); every other
 * build, production included, folds this flag to `false` and drops the hook code.
 */
declare const __E2E_HOOKS__: boolean | undefined;

export const E2E_HOOKS: boolean = typeof __E2E_HOOKS__ === "boolean" && __E2E_HOOKS__;

/** what the suite can read from `window.__polyTest` */
export interface PolyTestHooks {
  /** screen positions (viewport CSS px) of the four outer corners of the board's top face */
  boardCorners(): { x: number; y: number }[];
  /** the strips of the canvas the scene currently frames the board around */
  insets(): { l: number; r: number; t: number; b: number };
}

export function exposeTestHooks(hooks: PolyTestHooks | null): void {
  if (!E2E_HOOKS) {
    return;
  }
  const w = window as unknown as { __polyTest?: PolyTestHooks };
  if (hooks) {
    w.__polyTest = hooks;
  } else {
    delete w.__polyTest;
  }
}
