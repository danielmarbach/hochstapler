// The OpenTelemetry Node SDK; loaded dynamically by telemetry.ts only when an OTLP endpoint is configured.
// Exporter protocol, sampler, intervals etc. come from the standard OTEL_* environment variables
// (OTEL_EXPORTER_OTLP_PROTOCOL grpc|http/protobuf|http/json, OTEL_TRACES_SAMPLER[_ARG], OTEL_METRICS_EXPORTER, ...).
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

/** Starts the SDK without any instrumentation package; returns its shutdown function. */
export function startSdk(serviceName: string, serviceVersion: string): () => Promise<void> {
  const sdk = new NodeSDK({
    serviceName,
    resource: resourceFromAttributes({ "service.version": serviceVersion }),
    instrumentations: [],
  });
  sdk.start();
  return () => sdk.shutdown();
}
