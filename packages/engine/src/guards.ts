import { GameError } from "./types.ts";

/** Value that must exist; throws a GameError naming `what` otherwise. */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw GameError.of("err.internalMissing", { what });
  }
  return value;
}

/** Element of an array or record at `key`; throws a GameError when it is missing. */
export function at<T>(
  items: readonly T[] | Readonly<Record<string | number, T>>,
  key: number | string,
  what = "Element",
): T {
  return defined(
    (items as Readonly<Record<string | number, T | undefined>>)[key],
    `${what} ${key}`,
  );
}
