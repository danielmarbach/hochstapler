// Fail-soft helpers in the spirit of eslint-rules/no-bare-try-catch.js: wrap risky calls in
// attempt()/attemptSync() instead of bare try/catch. The engine itself never logs; callers can
// observe failures through the optional onError callback.

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export type OnError = (label: string, error: Error) => void;

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Run `fn`, returning a Result instead of throwing. */
export function attemptSync<T>(label: string, fn: () => T, onError?: OnError): Result<T> {
  // eslint-disable-next-line local/no-bare-try-catch -- this is the attempt primitive itself
  try {
    return { ok: true, value: fn() };
  } catch (e: unknown) {
    const error = toError(e);
    onError?.(label, error);
    return { ok: false, error };
  }
}

/** Async variant of attemptSync. */
export async function attempt<T>(
  label: string,
  fn: () => Promise<T>,
  onError?: OnError,
): Promise<Result<T>> {
  // eslint-disable-next-line local/no-bare-try-catch -- this is the attempt primitive itself
  try {
    return { ok: true, value: await fn() };
  } catch (e: unknown) {
    const error = toError(e);
    onError?.(label, error);
    return { ok: false, error };
  }
}
