// Starts the Hochstapler server for the browser suite: deterministic test mode (POLY_TEST_MODE=1), fresh temporary
// DATA_DIR, no bot delay, and the built client served from packages/client/dist.
// Update scenarios (support/deploy.ts) start further instances with E2E_DATA_DIR (kept on exit, so the next
// "version" finds the same games) and E2E_BUILD_ID (what the server announces in `welcome`).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../../packages/server/src/server.ts";
import { startTelemetry } from "../../packages/server/src/telemetry.ts";

const port = Number(process.env["E2E_PORT"] ?? 8788);
const givenDataDir = process.env["E2E_DATA_DIR"];
const buildId = process.env["E2E_BUILD_ID"];
const dataDir = givenDataDir ?? mkdtempSync(join(tmpdir(), "hochstapler-e2e-"));
const staticDir = resolve(import.meta.dirname, "../../packages/client/dist");

// traces/metrics of the test run, only when the caller exported OTEL_EXPORTER_OTLP_ENDPOINT (README "Telemetrie")
const telemetry = await startTelemetry(process.env, {
  serviceVersion: buildId ?? "e2e",
  defaultServiceName: "hochstapler-e2e",
});

process.env["POLY_TEST_MODE"] = "1";
const running = await startServer({
  port,
  host: "127.0.0.1",
  dataDir,
  botDelayMs: 0,
  staticDir,
  testMode: true,
  // browser scenarios create a game per scenario from one address: production limits (DESIGN #59) are lifted here
  limits: {
    createPerHour: 1e9,
    createBurst: 1e9,
    joinPerHour: 1e9,
    joinBurst: 1e9,
    maxOpenLobbies: 1e9,
    maxRunningGames: 1e9,
    wsPerIp: 1e9,
    // every scenario asks for a proof-of-work challenge too (DESIGN #70); it stays cheap and is never skipped
    powBurst: 1e9,
    powPerHour: 1e9,
  },
  ...(buildId ? { buildId } : {}),
});
console.log(
  `[e2e] Hochstapler (test mode) on http://127.0.0.1:${running.port}, data in ${dataDir}`,
);

let stopping = false;
const stop = (): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  running.close().finally(async () => {
    await telemetry.shutdown();
    if (!givenDataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
