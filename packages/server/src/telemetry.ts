// OpenTelemetry (docs/DESIGN.md #54). Vendor-neutral and optional:
//  - Instrumentation uses only `@opentelemetry/api`, which is a no-op until an SDK registers itself.
//  - The SDK (`telemetry-sdk.ts`, heavy) is imported dynamically and ONLY when OTEL_EXPORTER_OTLP_ENDPOINT (or a
//    signal-specific endpoint) is set. Without it nothing is loaded and LAN play is unchanged.
//  - Everything is manual (spans/metrics around game actions, DB access, sockets, rejections): no auto-instrumentation,
//    hence no header/query-string capture and no import hooks needed under Node ESM + tsx.
// RULE: attributes never carry tokens, invite codes, player names, IP addresses, URLs with query strings or user agents.
import {
  ROOT_CONTEXT,
  SeverityNumber,
  SpanKind,
  SpanStatusCode,
  context,
  logs,
  metrics,
  trace,
} from "@opentelemetry/api";
import { createHmac, randomBytes } from "node:crypto";
import { GameError, attempt } from "@poly/engine";
import type { Attributes, Meter, MeterProvider, ObservableResult, Span } from "@opentelemetry/api";

/** Per-process secret: the hashes below cannot be brute-forced back to ids (47 bits) from exported telemetry. */
const SPAN_ID_KEY = randomBytes(32);

/**
 * What telemetry shows instead of a game id (docs/DESIGN.md #62, L-2): a game id is a spectator capability, so it
 * never leaves the process. Stable within one process (all spans of a game correlate), different after a restart.
 */
export function spanGameId(gameId: string): string {
  return createHmac("sha256", SPAN_ID_KEY).update(gameId).digest("hex").slice(0, 12);
}

export const DEFAULT_SERVICE_NAME = "hochstapler";
const SCOPE = "hochstapler";

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
}

/** Enabled iff an OTLP endpoint is configured and OTEL_SDK_DISABLED is not "true" (standard variables only). */
export function loadTelemetryConfig(
  env: NodeJS.ProcessEnv,
  defaultServiceName: string = DEFAULT_SERVICE_NAME,
): TelemetryConfig {
  const has = (k: string): boolean => (env[k] ?? "").trim() !== "";
  const endpoint =
    has("OTEL_EXPORTER_OTLP_ENDPOINT") ||
    has("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ||
    has("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
  const disabled = (env["OTEL_SDK_DISABLED"] ?? "").trim().toLowerCase() === "true";
  const name = (env["OTEL_SERVICE_NAME"] ?? "").trim();
  return { enabled: endpoint && !disabled, serviceName: name === "" ? defaultServiceName : name };
}

export interface TelemetryHandle {
  enabled: boolean;
  /** flush and stop the exporters (bounded; never throws) */
  shutdown(): Promise<void>;
}

const DISABLED: TelemetryHandle = { enabled: false, shutdown: () => Promise.resolve() };

/** Starts the SDK when configured; otherwise returns immediately without loading it. */
export async function startTelemetry(
  env: NodeJS.ProcessEnv,
  opts: { serviceVersion: string; defaultServiceName?: string },
): Promise<TelemetryHandle> {
  const cfg = loadTelemetryConfig(env, opts.defaultServiceName);
  if (!cfg.enabled) return DISABLED;
  const started = await attempt(
    "otel:start",
    async () => {
      const sdk = await import("./telemetry-sdk.ts");
      return sdk.startSdk(cfg.serviceName, opts.serviceVersion);
    },
    // telemetry must never keep the game from starting
    (_label, e) => console.error("[otel] SDK failed to start:", e.message),
  );
  if (!started.ok) return DISABLED;
  const stop = started.value;
  return {
    enabled: true,
    shutdown: () =>
      Promise.race([
        stop().catch(() => undefined),
        new Promise<void>((ok) => setTimeout(ok, 3000).unref()),
      ]),
  };
}

// ---------- instruments (no-ops without SDK) ----------
// The metrics API (unlike the trace API) has no proxy: an instrument created before the SDK registered its MeterProvider
// stays a no-op forever. main.ts imports this module before startTelemetry() runs, so instruments are created lazily,
// per registered provider, on first use.
const ms = {
  unit: "ms",
  advice: { explicitBucketBoundaries: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] },
};

function lazy<T>(create: (meter: Meter) => T): () => T {
  let cache: { provider: MeterProvider; value: T } | null = null;
  return () => {
    const provider = metrics.getMeterProvider();
    if (cache?.provider !== provider) {
      cache = { provider, value: create(provider.getMeter(SCOPE)) };
    }
    return cache.value;
  };
}
function histogram(name: string, description: string): { record(v: number, a?: Attributes): void } {
  const h = lazy((m) => m.createHistogram(name, { description, ...ms }));
  return { record: (v, a) => h().record(v, a) };
}
function counter(name: string, description: string): { add(v: number, a?: Attributes): void } {
  const c = lazy((m) => m.createCounter(name, { description }));
  return { add: (v, a) => c().add(v, a) };
}

export const actionDuration = histogram(
  "hochstapler.action.duration",
  "Time to apply one game action (rules, persist, broadcast)",
);
export const dbWriteDuration = histogram(
  "hochstapler.db.write.duration",
  "Duration of SQLite writes (save, append_action); on Azure Files this is the slow part",
);
export const dbLoadDuration = histogram(
  "hochstapler.db.load.duration",
  "Duration of loading a game from SQLite",
);
export const botMoves = counter("hochstapler.bot.moves", "Moves played by bots");
export const gamesExpired = counter(
  "hochstapler.games.expired",
  "Games deleted by the data retention sweep, by status (lobby, running, finished)",
);
export const actionsTrimmed = counter(
  "hochstapler.actions.trimmed",
  "Action log rows removed by the retention sweep from games that stay",
);
export const wsReconnects = counter(
  "hochstapler.ws.reconnects",
  "A seat connected again after it had been connected before in this room",
);
export const wsOriginRejected = counter(
  "hochstapler.ws.origin_rejected",
  "WebSocket upgrades refused because of the Origin check",
);
export const chatMessages = counter(
  "hochstapler.chat.messages",
  "Chat messages published, by kind (free, quick); never the text",
);
export const chatRejected = counter(
  "hochstapler.chat.rejected",
  "Chat messages refused, by reason (off, quick, muted, link, contact, language, invalid, length, rate); never the text",
);
export const powChallenges = counter(
  "hochstapler.pow.challenges",
  "Proof-of-work challenges issued, or refused because the replay store was full (result: issued, full)",
);
export const powSolutions = counter(
  "hochstapler.pow.solutions",
  "Proof-of-work solutions checked on game creation, by result (ok, missing, invalid, expired)",
);
export const httpRejected = counter(
  "hochstapler.http.rejected",
  "Requests refused by the allow-list (404, 405, 413, 414, 415) by route template",
);
const wsConns = lazy((m) =>
  m.createUpDownCounter("hochstapler.ws.connections", {
    description: "Open WebSocket connections",
  }),
);
export const wsConnections = { add: (v: number): void => wsConns().add(v) };

/** Reports the gauges for a hub; returns the function that stops reporting. */
export function observeHub(hub: { size: number; runningCount(): number }): () => void {
  const meter = metrics.getMeter(SCOPE);
  const roomsLoaded = meter.createObservableGauge("hochstapler.rooms.loaded", {
    description: "Game rooms held in memory",
  });
  const gamesRunning = meter.createObservableGauge("hochstapler.games.running", {
    description: "Loaded games with status running",
  });
  const loaded = (r: ObservableResult): void => r.observe(hub.size);
  const running = (r: ObservableResult): void => r.observe(hub.runningCount());
  roomsLoaded.addCallback(loaded);
  gamesRunning.addCallback(running);
  return () => {
    roomsLoaded.removeCallback(loaded);
    gamesRunning.removeCallback(running);
  };
}

// ---------- spans ----------
export const tracer = () => trace.getTracer(SCOPE);

export interface TimedOptions {
  kind?: SpanKind;
  /** start a new trace instead of continuing the active one (timer-driven work, see traced() in rooms.ts) */
  root?: boolean;
  /** epoch milliseconds (fractions allowed) when the work really began, if earlier than now */
  startTime?: number;
}

/**
 * The value of `error.type` for a failure: the engine's error code for a rejected game action (`err.notYourTurn`, a
 * closed set), otherwise the error class name. Never the message: it is player-facing text and may carry names.
 */
export function errorType(e: unknown): string {
  if (e instanceof GameError) return e.code;
  return e instanceof Error ? e.name : "unknown";
}

/** Runs `fn` inside an active span and records `histogram` (ms); errors mark the span and propagate. */
export function timed<T>(
  name: string,
  attrs: Attributes,
  histogram: { record(v: number, a?: Attributes): void } | null,
  histogramAttrs: Attributes,
  fn: (span: Span) => T,
  opts: TimedOptions = {},
): T {
  const parent = opts.root === true ? ROOT_CONTEXT : context.active();
  return tracer().startActiveSpan(
    name,
    {
      kind: opts.kind ?? SpanKind.INTERNAL,
      attributes: attrs,
      ...(opts.startTime === undefined ? {} : { startTime: opts.startTime }),
    },
    parent,
    (span) => {
      const t0 = performance.now();
      // eslint-disable-next-line local/no-bare-try-catch -- marks the span and rethrows; the error is not swallowed
      try {
        return fn(span);
      } catch (e) {
        // only the closed code, never the message (player-facing text)
        const type = errorType(e);
        span.setStatus({ code: SpanStatusCode.ERROR, message: type });
        span.setAttribute("error.type", type);
        throw e;
      } finally {
        histogram?.record(performance.now() - t0, histogramAttrs);
        span.end();
      }
    },
  );
}

/** Epoch milliseconds with sub-millisecond precision, comparable with `performance.now()` deltas. */
export const epochNow = (): number => performance.timeOrigin + performance.now();

/** A span for work that already happened (start/end from `epochNow()`), a child of the active span. */
export function recordSpan(name: string, start: number, end: number, attrs: Attributes): void {
  tracer().startSpan(name, { startTime: start, attributes: attrs }).end(end);
}

/** What one fan-out sent: counted by the caller while it sends. */
export class BroadcastTally {
  recipients = 0;
  bytes = 0;
  variants = 0;
  private lastVariant: string | null = null;
  private readonly measure: boolean;
  constructor(measure: boolean) {
    this.measure = measure;
  }
  /** one socket got `data`; sockets that got the same string are one variant */
  add(data: string): void {
    this.recipients++;
    if (!this.measure) return;
    if (data !== this.lastVariant) this.variants++;
    this.lastVariant = data;
    this.bytes += Buffer.byteLength(data);
  }
}

/**
 * `ws.broadcast`: a child span around one fan-out to sockets (serialisation + sends), so the non-DB share of an action is
 * visible. Only inside an active span: a push from a bare socket message (hello, presence) would otherwise start a trace of
 * its own for every connection event.
 */
export function broadcastTimed(type: string, fn: (tally: BroadcastTally) => void): void {
  if (!trace.getActiveSpan()) return fn(new BroadcastTally(false));
  timed("ws.broadcast", { "ws.message.type": type }, null, {}, (span) => {
    const tally = new BroadcastTally(span.isRecording());
    // eslint-disable-next-line local/no-bare-try-catch -- only try/finally to record the tally, nothing is swallowed
    try {
      fn(tally);
    } finally {
      span.setAttribute("ws.recipients", tally.recipients);
      span.setAttribute("ws.payload.bytes", tally.bytes);
      span.setAttribute("ws.payload.variants", tally.variants);
    }
  });
}

/** Adds an event to the active span (game lifecycle); nothing without one. */
export function spanEvent(name: string, attrs: Attributes): void {
  trace.getActiveSpan()?.addEvent(name, attrs);
}

// ---------- logs (OpenTelemetry Logs API; no-op until an SDK registers a provider) ----------
const SEVERITY = {
  info: [SeverityNumber.INFO, "INFO"],
  warn: [SeverityNumber.WARN, "WARN"],
  error: [SeverityNumber.ERROR, "ERROR"],
} as const;

/**
 * The only attribute keys a log record may carry. Everything else is dropped, so a caller cannot leak a token, name, address
 * or chat text by mistake (the console output keeps the full detail for the operator).
 */
const LOG_ATTRIBUTE_ALLOW = [
  "operation",
  "exception.type",
  "error.type",
  "error.code",
  "game.id", // already the hash (spanGameId)
  "game.action.type",
  "http.route",
  "http.response.status_code",
  "retention.",
  "schema.",
  "process.runtime.version",
  "shutdown.signal",
  "bot.",
];

/**
 * Emits one structured log record (warn/error and a few info events). `event` is a fixed sentence, never built from data.
 * The active span, if any, is attached by the SDK (trace and span id). Error messages are NOT exported, only their type.
 */
export function emitLog(
  severity: keyof typeof SEVERITY,
  event: string,
  attrs: Attributes = {},
  error?: unknown,
): void {
  const attributes: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (LOG_ATTRIBUTE_ALLOW.some((a) => (a.endsWith(".") ? k.startsWith(a) : k === a)))
      attributes[k] = v;
  }
  if (error !== undefined) {
    attributes["exception.type"] = errorType(error);
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)) attributes["error.code"] = code;
  }
  const [severityNumber, severityText] = SEVERITY[severity];
  logs.getLogger(SCOPE).emit({ severityNumber, severityText, body: event, attributes });
}

/** A fail-soft operation failed (`label` like `db:save`); labels that embed an id keep only the part before it. */
export function logOperationFailed(label: string, error: unknown, attrs: Attributes = {}): void {
  const operation = label.startsWith("resume:") ? "resume" : label;
  emitLog("error", "operation failed", { ...attrs, operation }, error);
}

/** A DB access: child span + histogram, operation name from a closed set. */
export function dbTimed<T>(
  op: "save" | "append_action" | "load",
  histogram: { record(v: number, a?: Attributes): void },
  fn: () => T,
): T {
  return timed(
    `db.${op}`,
    { "db.system.name": "sqlite", "db.operation.name": op },
    histogram,
    { "db.operation.name": op },
    fn,
    { kind: SpanKind.CLIENT },
  );
}
