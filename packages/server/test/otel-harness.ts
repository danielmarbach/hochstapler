// In-memory OpenTelemetry for tests: spans and metrics can be inspected without any exporter or network.
import { context, logs, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { MetricReader } from "@opentelemetry/sdk-metrics";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import type { MetricData } from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";

class CollectingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface InMemoryOtel {
  spans(): ReadableSpan[];
  /** log records exported so far */
  logs(): ReadableLogRecord[];
  /** all metrics collected so far (cumulative) by instrument name */
  metrics(): Promise<Map<string, MetricData>>;
  shutdown(): Promise<void>;
}

/** Registers global in-memory providers (once per test file; vitest isolates files). */
export function installInMemoryOtel(): InMemoryOtel {
  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  const exporter = new InMemorySpanExporter();
  const tracerProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
  const reader = new CollectingReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(meterProvider);
  return {
    spans: () => exporter.getFinishedSpans(),
    logs: () => logExporter.getFinishedLogRecords(),
    async metrics() {
      const { resourceMetrics } = await reader.collect();
      const out = new Map<string, MetricData>();
      for (const scope of resourceMetrics.scopeMetrics) {
        for (const m of scope.metrics) out.set(m.descriptor.name, m);
      }
      return out;
    },
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      await loggerProvider.shutdown();
      contextManager.disable();
    },
  };
}
