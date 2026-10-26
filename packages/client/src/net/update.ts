// Pure decisions for seamless version upgrades (docs/DESIGN.md #44): how to reconnect after a server
// restart and when the page has to reload to pick up a new frontend build. No DOM, no timers owned here.

/** WebSocket close code the server sends when it shuts down for an update ("Service Restart"). */
export const SERVICE_RESTART = 1012;

/** Build id of a development server or client; it never triggers a reload. */
export const DEV_BUILD = "dev";

export type CloseKind = "restart" | "normal";

export function closeKind(code: number): CloseKind {
  return code === SERVICE_RESTART ? "restart" : "normal";
}

const BASE_DELAY_MS = 500;
/** Generic backoff cap: a server that is really down should not be hammered. */
const NORMAL_MAX_DELAY_MS = 10_000;
/** After a deploy the new container is back within seconds, so keep polling closely. */
const RESTART_MAX_DELAY_MS = 2000;

/** Delay before reconnect attempt number `attempt` (0 = first retry): 500 ms, 1 s, 2 s, ... up to a cap. */
export function reconnectDelay(kind: CloseKind, attempt: number): number {
  const cap = kind === "restart" ? RESTART_MAX_DELAY_MS : NORMAL_MAX_DELAY_MS;
  // the exponent is clamped so absurd attempt counts cannot overflow to Infinity
  return Math.min(cap, BASE_DELAY_MS * 2 ** Math.min(attempt, 16));
}

export type ReloadDecision = "none" | "reload" | "warn";

export interface BuildCheck {
  /** build id from the welcome message */
  server: string;
  /** build id baked into this page */
  own: string;
  /** build id the page last reloaded for (sessionStorage marker), if any */
  reloadedFor: string | null;
}

/**
 * Reload when the server serves another build than this page was built from. If we already reloaded for
 * exactly this build and the page is still outdated (stale cache, CDN), do not loop: only warn.
 */
export function decideReload({ server, own, reloadedFor }: BuildCheck): ReloadDecision {
  if (server === own || server === DEV_BUILD || own === DEV_BUILD) return "none";
  return reloadedFor === server ? "warn" : "reload";
}

/** Resolves "idle" as soon as `isIdle()` holds, "timeout" after `maxMs` (polling every `pollMs`). */
export function whenIdle(
  isIdle: () => boolean,
  maxMs: number,
  pollMs: number,
): Promise<"idle" | "timeout"> {
  return new Promise((resolve) => {
    let waited = 0;
    const check = (): void => {
      if (isIdle()) return resolve("idle");
      if (waited >= maxMs) return resolve("timeout");
      waited += pollMs;
      setTimeout(check, pollMs);
    };
    check();
  });
}
