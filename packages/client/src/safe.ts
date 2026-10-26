import type { OnError } from "@poly/engine";

/** onError callback for attempt()/attemptSync(): surface the failure in the console, keep going. */
export const warnOnError: OnError = (label, error) => {
  console.warn(`[${label}]`, error);
};

/** Same as warnOnError for failures that deserve error severity. */
export const errorOnError: OnError = (label, error) => {
  console.error(`[${label}]`, error);
};

/** Narrow a value that is guaranteed by construction (fixed-size tables, mounted DOM, ...) or fail loudly. */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Invariant violated: ${what}`);
  }
  return value;
}

/** The 2D context of a canvas we just created ourselves (cannot be null for a fresh canvas). */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return need(canvas.getContext("2d"), "2d canvas context");
}

/** Indexed access into a table whose bounds are guaranteed by construction (noUncheckedIndexedAccess). */
export function at<T>(items: { readonly [index: number]: T }, index: number): T {
  return need(items[index], `index ${index} out of range`);
}
