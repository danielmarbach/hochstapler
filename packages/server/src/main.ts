import { startupUrls } from "./network.ts";
import { MigrationError } from "./migrations/schema.ts";
import { defaultStaticDir, readBuildId } from "./build.ts";
import { startServer } from "./server.ts";
import { emitLog, startTelemetry } from "./telemetry.ts";

// OpenTelemetry only when OTEL_EXPORTER_OTLP_ENDPOINT is set (docs/DESIGN.md #54); version = the served client build id
const telemetry = await startTelemetry(process.env, {
  serviceVersion: readBuildId(defaultStaticDir(process.env.NODE_ENV)),
});
if (telemetry.enabled)
  console.log("[hochstapler] OpenTelemetry aktiv (OTEL_EXPORTER_OTLP_ENDPOINT gesetzt)");

const abortStartup = async (e: unknown): Promise<never> => {
  if (e instanceof MigrationError) {
    console.error(`[hochstapler] Startup aborted, the database was not changed: ${e.message}`);
    emitLog("error", "startup aborted, database not changed", {}, e);
    await telemetry.shutdown(); // the error record must leave before the process does
    process.exit(1);
  }
  throw e;
};

let running: Awaited<ReturnType<typeof startServer>>;
try {
  // listen at once (liveness, static files) and open the database when the writer lease is ours (DESIGN #89)
  running = await startServer({ waitUntilActive: false });
} catch (e) {
  running = await abortStartup(e);
}
// the schema migration runs when the lease is acquired: a failure there still ends the process
running.whenActive().catch(async (e: unknown) => {
  await running.close();
  await abortStartup(e);
});
// the service version and name are resource attributes of every record
emitLog("info", "server started", {
  "process.runtime.version": process.version,
});
const [local, ...lan] = startupUrls(running.port);
console.log(
  `[hochstapler] listening on ${local}${process.env.NODE_ENV === "production" ? " (production)" : ""}`,
);
if (lan.length > 0) {
  console.log(
    "[hochstapler] For games on the Wi-Fi, open the first 192.168.… address in the browser so the invite link contains it.",
  );
}
for (const url of lan) {
  console.log(`[hochstapler] im WLAN: ${url}`);
}

let stopping = false;
const stop = (sig: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[hochstapler] ${sig}, shutting down`);
  emitLog("info", "graceful shutdown started", { "shutdown.signal": sig });
  // hard exit guard: close() needs well under 3 s (queue drain + persist + 1.5 s close-handshake grace);
  // Docker only waits stop_grace_period (compose.yaml, 15 s) before SIGKILL
  const t = setTimeout(() => process.exit(1), 5000);
  t.unref();
  running.close().then(
    () => telemetry.shutdown().finally(() => process.exit(0)),
    (e) => {
      console.error(e);
      emitLog("error", "graceful shutdown failed", {}, e);
      void telemetry.shutdown().finally(() => process.exit(1));
    },
  );
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
