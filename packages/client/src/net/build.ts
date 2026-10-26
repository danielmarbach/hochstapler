import { DEV_BUILD } from "./update.ts";

/** Replaced at build time by Vite's `define` (vite.config.ts); undefined where nothing defines it (tests). */
declare const __BUILD_ID__: string | undefined;

/** Id of the build this page was loaded from; "dev" under the Vite dev server. */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : DEV_BUILD;
