import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ calls: 0, failAt: new Set<number>() }));
vi.mock("@poly/engine", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@poly/engine")>();
  return {
    ...orig,
    applyBotAction: (...args: Parameters<typeof orig.applyBotAction>) => {
      ctl.calls++;
      if (ctl.failAt.has(ctl.calls)) {
        throw new Error("injected bot failure");
      }
      return orig.applyBotAction(...args);
    },
  };
});

import { TestClient, createGame, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
});

describe("bot scheduler", () => {
  it("sporadic bot failures (each followed by successes) never pause the bots for good", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    ctl.failAt = new Set([10, 30, 50, 70, 90]);
    const host = await createGame(ts, { bots: ["normal", "hard", "easy"], maxPlayers: 4 });
    // the host's socket stays: a game only runs while a human is connected (docs/DESIGN.md #60)
    const c = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    // make the whole table bots: no human action can reset the failure counter
    const room = ts.srv.hub.get(host.gameId)!;
    room.lobby.seats[0]!.kind = "bot";
    room.state!.players[0]!.controller = "bot";
    room.schedule();
    await c.untilState((s) => s.version >= 150, 8000);
    expect(ctl.calls).toBeGreaterThan(90);
    expect(err).toHaveBeenCalled();
    await c.close();
    err.mockRestore();
  });
});
