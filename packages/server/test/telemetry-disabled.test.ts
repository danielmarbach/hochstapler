// Without an OTLP endpoint nothing is loaded and every signal is a no-op (docs/DESIGN.md #54).
import { logs, trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { broadcastTimed, emitLog, startTelemetry } from "../src/telemetry.ts";
import { AutoPlayer, TestClient, createGame, startGame, startTestServer } from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
});

describe("telemetry disabled", () => {
  it("does not start the SDK and registers no logger provider", async () => {
    const handle = await startTelemetry({}, { serviceVersion: "t" });
    expect(handle.enabled).toBe(false);
    await handle.shutdown();
    expect(logs.getLoggerProvider().constructor.name).toMatch(/Noop|Proxy/);
  });

  it("log, broadcast and lifecycle helpers are silent no-ops and a game plays normally", async () => {
    expect(() => emitLog("error", "nothing", { operation: "x" }, new Error("boom"))).not.toThrow();
    let ran = 0;
    broadcastTimed("update", (t) => {
      ran++;
      t.add("abc");
    });
    expect(ran).toBe(1);
    expect(trace.getActiveSpan()).toBeUndefined();

    const host = await createGame(ts, { bots: ["easy"], maxPlayers: 2 });
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    new AutoPlayer(client, host.playerId, 3, { maxVersion: 8 });
    await client.untilState((s) => s.version >= 8, 8000);
    await client.close();
  });
});
