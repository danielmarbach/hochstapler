// Client side of the game-creation proof of work (docs/DESIGN.md #70): fetch a challenge, solve it in a worker,
// hand the header to POST /api/games. The solver itself lives in @poly/engine (shared with the tests).
import { z } from "zod";
import {
  POW_HEADER,
  PowChallengeResponseSchema,
  attempt,
  attemptSync,
  encodePowPayload,
} from "@poly/engine";
import type { PowChallenge, PowSolution } from "@poly/engine";
import { UI_MESSAGES, UiError } from "../i18n/index.ts";
import type { PowWorkerReply } from "./pow.worker.ts";

/** What the page does with the challenge: tests replace it. */
export type Solver = (challenge: PowChallenge, signal: AbortSignal) => Promise<PowSolution>;

/** Own-origin module worker (Vite emits `assets/pow.worker-<hash>.js`, no blob:/data: URL). */
export const workerSolver: Solver = (challenge, signal) =>
  new Promise<PowSolution>((resolve, reject) => {
    const worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
    const done = (fn: () => void): void => {
      worker.terminate();
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = (): void => done(() => reject(new DOMException("aborted", "AbortError")));
    signal.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<PowWorkerReply>): void => {
      const reply = event.data;
      done(() =>
        "solution" in reply ? resolve(reply.solution) : reject(new UiError("pow.failed")),
      );
    };
    worker.onerror = (): void => done(() => reject(new UiError("pow.failed")));
    worker.postMessage({ challenge });
  });

/** German message of an error body, null when there is none (same convention as api.ts) */
function bodyError(data: unknown): string | null {
  const parsed = z.object({ error: z.string() }).safeParse(data);
  return parsed.success ? parsed.data.error : null;
}

async function fetchChallenge(): Promise<PowChallenge> {
  const sent = await attempt("pow:challenge", () =>
    fetch("/api/pow/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create-game" }),
    }),
  );
  if (!sent.ok) throw new UiError("net.unreachable");
  const res = sent.value;
  const text = await res.text();
  const json = attemptSync<unknown>("pow:parse", () => (text ? JSON.parse(text) : null));
  const data: unknown = json.ok ? json.value : null;
  if (!res.ok) {
    const message = bodyError(data);
    throw message === null ? new UiError("net.status", { status: res.status }) : new Error(message);
  }
  const parsed = PowChallengeResponseSchema.safeParse(data);
  if (!parsed.success) throw new UiError("net.invalidResponse");
  return parsed.data.challenge;
}

/** A challenge being solved (or solved): the header value for POST /api/games. */
export interface PowTicket {
  header: Promise<string>;
  cancel(): void;
}

/** Starts fetching and solving right away; `header` rejects when anything fails (never silently). */
export function startPow(solver: Solver = workerSolver): PowTicket {
  const controller = new AbortController();
  const header = (async (): Promise<string> => {
    const challenge = await fetchChallenge();
    const solution = await solver(challenge, controller.signal);
    return encodePowPayload({ challenge, solution });
  })();
  // a ticket nobody waits for (form left) must not become an unhandled rejection
  header.catch(() => undefined);
  return { header, cancel: () => controller.abort() };
}

/** The server refused the solution as missing, invalid or expired (German text, matched verbatim like every srv.*). */
export function isPowRefusal(error: Error): boolean {
  const de = UI_MESSAGES.de;
  return [de["srv.powMissing"], de["srv.powInvalid"], de["srv.powExpired"]].includes(error.message);
}

/**
 * Runs `send` with the solved header. A refused solution (expired in a long-open form, lost in a server restart)
 * is retried once with a fresh challenge; every other failure is passed on.
 */
export async function withPow<T>(
  ticket: () => PowTicket,
  reset: () => void,
  send: (header: string) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => send(await ticket().header);
  const first = await attempt("pow:send", run);
  if (first.ok) return first.value;
  reset();
  if (!isPowRefusal(first.error)) throw first.error;
  return run();
}

export { POW_HEADER };
