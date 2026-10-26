import { trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { loadTelemetryConfig, startTelemetry } from "../src/telemetry.ts";

describe("telemetry config", () => {
  it("is disabled without OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    expect(loadTelemetryConfig({}).enabled).toBe(false);
    expect(loadTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "" }).enabled).toBe(false);
    expect(loadTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "  " }).enabled).toBe(false);
  });

  it("is enabled by the standard endpoint variable (or a signal-specific one)", () => {
    const base = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" };
    expect(loadTelemetryConfig(base).enabled).toBe(true);
    expect(
      loadTelemetryConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://x:4318/v1/traces" })
        .enabled,
    ).toBe(true);
  });

  it("OTEL_SDK_DISABLED=true switches it off even with an endpoint", () => {
    const cfg = loadTelemetryConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      OTEL_SDK_DISABLED: "true",
    });
    expect(cfg.enabled).toBe(false);
  });

  it("service name: OTEL_SERVICE_NAME wins, default is hochstapler", () => {
    expect(loadTelemetryConfig({}).serviceName).toBe("hochstapler");
    expect(loadTelemetryConfig({ OTEL_SERVICE_NAME: "x" }).serviceName).toBe("x");
    expect(loadTelemetryConfig({}, "hochstapler-e2e").serviceName).toBe("hochstapler-e2e");
  });
});

describe("telemetry disabled", () => {
  it("startTelemetry is a no-op: no SDK is loaded, spans do not record", async () => {
    const handle = await startTelemetry({}, { serviceVersion: "dev" });
    expect(handle.enabled).toBe(false);
    await handle.shutdown();
    const span = trace.getTracer("t").startSpan("x");
    expect(span.isRecording()).toBe(false);
    span.end();
  });
});
