// Dedicated worker of the game-creation proof of work (docs/DESIGN.md #70): runs the ALTCHA v2 solver off the main
// thread. Loaded from our own origin (`worker-src 'self'`), never from a blob: or data: URL.
// The challenge arrives already validated by the page (zod, jitless there); nothing is parsed here.
import { solvePow } from "@poly/engine";
import type { PowChallenge, PowSolution } from "@poly/engine";

export type PowWorkerRequest = { challenge: PowChallenge };
export type PowWorkerReply = { solution: PowSolution } | { error: string };

self.onmessage = (event: MessageEvent<PowWorkerRequest>): void => {
  solvePow(event.data.challenge).then(
    (solution) => self.postMessage({ solution } satisfies PowWorkerReply),
    (e: unknown) =>
      self.postMessage({
        error: e instanceof Error ? e.message : "failed",
      } satisfies PowWorkerReply),
  );
};
