import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createReadStream, mkdirSync, realpathSync, statSync } from "node:fs";
import { pipeline } from "node:stream";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { RawData } from "ws";
import { z } from "zod";
import {
  ChatUpdateRequestSchema,
  POW_HEADER,
  PowChallengeRequestSchema,
  ClientMessageSchema,
  DEFAULT_CHAT_SETTINGS,
  attempt,
  attemptSync,
  CreateGameRequestSchema,
  UnflooredCreateGameRequestSchema,
  GameSettingsInputSchema,
  DEFAULT_SETTINGS,
  JoinGameRequestSchema,
  GameSettingsSchema,
  RotateTokenRequestSchema,
  SeatUpdateRequestSchema,
  WS_CLOSE_HANDOVER,
  WS_CLOSE_HANDOVER_REASON,
  WS_CLOSE_TOKEN_ROTATED,
  WS_CLOSE_TOKEN_ROTATED_REASON,
  THEMES,
  createGame,
  getTheme,
} from "@poly/engine";
import type {
  BotLevel,
  GameSettings,
  JoinResponse,
  NewPlayer,
  RotateTokenResponse,
} from "@poly/engine";
import { defaultStaticDir, readBuildId } from "./build.ts";
import { clientIp, limitKey, loadTrustProxyHops } from "./client-ip.ts";
import { ConnectionCounter, KeyedLimiter, loadLimits } from "./limits.ts";
import { PowService, loadPowConfig } from "./pow.ts";
import type { PowConfig, PowFailure } from "./pow.ts";
import type { LimitsConfig, Take } from "./limits.ts";
import {
  Db,
  WriteCheckError,
  checkSqliteLocking,
  loadJournalMode,
  loadSqliteLocking,
} from "./db.ts";
import { loadRetention } from "./retention.ts";
import type { RetentionConfig } from "./retention.ts";
import { MigrationError } from "./migrations/schema.ts";
import type { SchemaMigration } from "./migrations/schema.ts";
import { loadHandoverMode, loadWriterLease } from "./lease/config.ts";
import type { HandoverMode } from "./lease/config.ts";
import { WriterCoordinator } from "./lease/coordinator.ts";
import type { WriterState } from "./lease/coordinator.ts";
import { countsAsTraffic } from "./lease/traffic.ts";
import { LeaseFencedError } from "./lease/types.ts";
import type { WriterLease } from "./lease/types.ts";
import type { StoredLobby, StoredSeat } from "./db.ts";
import {
  httpRejected,
  logOperationFailed,
  observeHub,
  powChallenges,
  powSolutions,
  recordLeaseEvent,
  recordLeaseIssue,
  recordWriteCheckFailed,
  recordWriteHealth,
  tracer,
  wsConnections,
  wsOriginRejected,
} from "./telemetry.ts";
import { TestMode, isTestModeEnabled } from "./test-mode.ts";
import {
  MAX_BODY_BYTES,
  applyCors,
  applySecurityHeaders,
  bodyRejection,
  hasDotSegment,
  isAllowedOrigin,
  loadSecurityConfig,
  routeRejection,
  routeTemplate,
  staticCacheControl,
} from "./security.ts";
import type { SecurityConfig } from "./security.ts";
import {
  Hub,
  errMsg,
  replaceControlChars,
  safeEqualHex,
  sha256,
  type Conn,
  type GameRoom,
  type RoomOptions,
} from "./rooms.ts";

export interface ServerOptions {
  port?: number;
  dataDir?: string;
  botDelayMs?: number;
  /** deterministic E2E mode (/api/test/*); defaults to env POLY_TEST_MODE=1, refused in production */
  testMode?: boolean;
  staticDir?: string | null;
  host?: string;
  /** overrides env ALLOWED_ORIGINS / HTTPS_ONLY (see security.ts) */
  security?: Partial<SecurityConfig>;
  /** room unload tuning (tests) */
  idleMs?: number;
  sweepMs?: number;
  /** data retention limits; default: env GAME_TTL_*_DAYS / ACTION_LOG_KEEP (docs/DESIGN.md #57) */
  retention?: RetentionConfig;
  /** interval of the retention sweep (default hourly) and its clock (tests) */
  retentionIntervalMs?: number;
  clock?: () => number;
  /** schema migrations to apply instead of the built-in list (tests) */
  schemaMigrations?: readonly SchemaMigration[];
  /** WS per-socket rate limit (tests) */
  wsRate?: { burst: number; perSec: number; strikeDecayMs?: number };
  /** id of the client build reported in welcome; default: dist/version.json of the static dir, else "dev" */
  buildId?: string;
  /** abuse limits; default: env (see limits.ts, docs/DESIGN.md #59) */
  limits?: Partial<LimitsConfig>;
  /** proof-of-work settings of game creation; default: env POW_* (see pow.ts, docs/DESIGN.md #70). Code only, no env reaches it. */
  pow?: Partial<PowConfig>;
  /** reverse proxies in front of the app that append to x-forwarded-for; default: env TRUST_PROXY_HOPS, else 0 */
  trustProxyHops?: number;
  /** TESTS ONLY: bot and turn timers keep running while no human is connected (production pauses them, #60) */
  runWithoutHumans?: boolean;
  /** TESTS ONLY: accept turn time / missed-turn settings below the floors (test mode does so, too) */
  allowLowSettings?: boolean;
  /** pre-hello sockets are closed after this long (default 5 s) */
  wsHelloTimeoutMs?: number;
  /** who may open the database (default: env WRITER_LEASE, see lease/config.ts and docs/DESIGN.md #89) */
  writerLease?: WriterLease;
  /**
   * Resolve only once this instance holds the writer lease and serves (default true). main.ts passes false: the HTTP
   * server must answer liveness probes while it waits for the lease.
   */
  waitUntilActive?: boolean;
  /** a former holder waits this long before it competes for the lease again (default 2 x lease duration) */
  leaseRejoinDelayMs?: number;
  /** when this fresh instance asks the holder to hand over (default: env WRITER_LEASE_HANDOVER, DESIGN #91) */
  leaseHandover?: HandoverMode;
  /** pause after a lost lease / failed activation before the next attempt (default 1 s) */
  leaseRetryDelayMs?: number;
  /** TESTS ONLY: observe when the database is opened and closed and every write */
  writerProbe?: { opened(): void; closed(): void; wrote(): void };
  /** TESTS ONLY: runs inside every database write; throwing simulates a mount that refuses writes (DESIGN #94) */
  dbWriteFault?: () => void;
}

export interface RunningServer {
  server: Server;
  port: number;
  /** the hub of the active instance; throws in standby (there is no database then) */
  readonly hub: Hub;
  /** standby / acquiring / active / draining */
  writerState(): WriterState;
  /** resolves when this instance serves; rejects when it cannot start (failed schema migration) */
  whenActive(): Promise<void>;
  close(): Promise<void>;
}

class HttpError extends Error {
  status: number;
  /** sent as Retry-After */
  retryAfterSec: number | undefined;
  /** this instance does not hold the database right now: the client may retry the same request */
  standby: boolean;
  constructor(status: number, message: string, retryAfterSec?: number, standby = false) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.standby = standby;
  }
}

const PALETTE = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f1c40f",
  "#9b59b6",
  "#e67e22",
  "#1abc9c",
  "#ff6fa5",
];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_BODY = MAX_BODY_BYTES;
export const WS_MAX_PAYLOAD = 16 * 1024;
/** Close code "Service Restart": the server goes down for an update, clients should reconnect shortly. */
export const WS_SERVICE_RESTART = 1012;
/** How long clients get to answer the close frame at shutdown (must stay well below main.ts' 5 s exit guard). */
const WS_CLOSE_GRACE_MS = 1500;
const WS_MAX_SOCKETS = 1000;
const WS_HELLO_TIMEOUT_MS = 5000;
const DEFAULT_WS_RATE: { burst: number; perSec: number; strikeDecayMs?: number } = {
  burst: 30,
  perSec: 10,
};
/** rate-limit strikes are forgotten after this long without a new one (a long-lived socket must not accumulate them forever) */
const WS_STRIKE_DECAY_MS = 10_000;
const WS_RATE_STRIKES_BEFORE_CLOSE = 20;
const INVITE_MAX_FAILS = 10;
/** upper bound of the in-memory abuse maps (oldest entries go first) */
const MAX_TRACKED = 10_000;
const MAINTENANCE_INTERVAL_MS = 60_000;
export const RATE_LIMITED_MESSAGE = "Zu viele Anfragen. Bitte später erneut.";
export const POW_MISSING_MESSAGE = "Die Sicherheitsprüfung fehlt. Bitte nochmal versuchen.";
export const POW_INVALID_MESSAGE = "Die Sicherheitsprüfung ist ungültig. Bitte nochmal versuchen.";
export const POW_EXPIRED_MESSAGE =
  "Die Sicherheitsprüfung ist abgelaufen. Bitte nochmal versuchen.";
export const POW_BUSY_MESSAGE = "Gerade sind viele Prüfungen offen. Bitte gleich nochmal.";
const POW_FAILURES: Record<PowFailure, string> = {
  missing: POW_MISSING_MESSAGE,
  invalid: POW_INVALID_MESSAGE,
  expired: POW_EXPIRED_MESSAGE,
};
export const SERVER_FULL_MESSAGE = "Der Server ist gerade voll. Bitte später erneut.";
/** 503 while this instance has no database (standby / handover); nothing was applied, the request can be repeated */
export const STANDBY_MESSAGE = "Der Server wechselt gerade – bitte gleich nochmal.";
const STANDBY_RETRY_AFTER_SEC = 2;
const standbyError = (): HttpError =>
  new HttpError(503, STANDBY_MESSAGE, STANDBY_RETRY_AFTER_SEC, true);
export const SETTINGS_TOO_LOW_MESSAGE =
  "Zeitlimit mindestens 30 Sekunden (oder aus), Abwesenheit frühestens nach 2 verpassten Zügen.";
const INVITE_WINDOW_MS = 60_000;
/** a seat may rotate its token this often per window (a link refresh is a rare, deliberate act) */
const ROTATE_MAX_PER_WINDOW = 5;
const ROTATE_WINDOW_MS = 60_000;
const GameIdSchema = z.string().regex(/^[A-Za-z0-9]{1,32}$/);
const SeatIdSchema = z.string().regex(/^p[1-9][0-9]?$/);

/** Token bucket: `burst` messages at once, refilled at `perSec`. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private readonly burst: number;
  private readonly perSec: number;
  constructor(burst: number, perSec: number) {
    this.burst = burst;
    this.perSec = perSec;
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const rid = (n: number) =>
  randomBytes(n * 2)
    .toString("base64url")
    .replace(/[-_]/g, "")
    .slice(0, n);
const inviteCodeGen = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

// ---------- validation ----------
function cleanName(n: string): string {
  return replaceControlChars(n, "").replace(/\s+/g, " ").trim();
}
function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
  special?: (issue: z.core.$ZodIssue) => string | null,
): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    const text = i && special?.(i);
    if (text) throw new HttpError(400, text);
    throw new HttpError(
      400,
      `Ungültige Eingabe${i ? ` (${i.path.join(".") || "body"}: ${i.message})` : ""}.`,
    );
  }
  return r.data;
}
const BotBodySchema = z.object({ botLevel: z.enum(["easy", "normal", "hard"]) });
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  DATA_DIR: z.string().min(1).optional(),
  BOT_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(700),
  NODE_ENV: z.string().optional(),
});

const isFloorIssue = (i: z.core.$ZodIssue): string | null => {
  const field = i.path.at(-1);
  return field === "turnTimeoutSec" || field === "awayAfterMissedTurns"
    ? SETTINGS_TOO_LOW_MESSAGE
    : null;
};
const UNFLOORED_PARTIAL = GameSettingsSchema.partial();
const FLOORED_PARTIAL = GameSettingsInputSchema.partial();

/** `floors: false` (tests / test mode only) accepts turn times below 30 s and fewer than 2 missed turns. */
export function mergeSettings(base: GameSettings, patch: unknown, floors = true): GameSettings {
  const p = parseBody(floors ? FLOORED_PARTIAL : UNFLOORED_PARTIAL, patch ?? {}, isFloorIssue);
  if (p.themeId !== undefined && !Object.prototype.hasOwnProperty.call(THEMES, p.themeId))
    throw new HttpError(400, "Unbekanntes Theme.");
  const defined = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  return { ...base, ...defined, buildingLimits: { ...(p.buildingLimits ?? base.buildingLimits) } };
}

// ---------- lobby helpers ----------
function pickToken(settings: GameSettings, seats: StoredSeat[], wanted?: string): string {
  const tokens = getTheme(settings.themeId).tokens.map((t) => t.id);
  const used = new Set(seats.map((s) => s.tokenId));
  if (wanted && tokens.includes(wanted) && !used.has(wanted)) return wanted;
  const free = tokens.find((t) => !used.has(t)) ?? tokens[0];
  if (free === undefined) throw new Error(`theme ${settings.themeId} defines no tokens`);
  return free;
}
/** 400 unless `id` is a piece of the theme (a bad id is a client bug, a taken one is a race: see the callers). */
function assertThemePiece(settings: GameSettings, id: string): void {
  if (!getTheme(settings.themeId).tokens.some((t) => t.id === id))
    throw new HttpError(400, "Unbekannte Spielfigur.");
}
function pickColor(seats: StoredSeat[]): string {
  const used = new Set(seats.map((s) => s.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[0] ?? "#e74c3c";
}
function nextPlayerId(seats: StoredSeat[]): string {
  const max = seats.reduce((m, s) => Math.max(m, Number(s.playerId.slice(1)) || 0), 0);
  return `p${max + 1}`;
}
/** Every themed bot name of every country — used to recognise bots that still carry an auto name. */
const ALL_BOT_NAMES = new Set(Object.values(THEMES).flatMap((t) => t.botNames));

/** Next country-themed bot name that nobody at the table uses yet (case-insensitive). */
function nextBotName(lobby: StoredLobby): string {
  const used = new Set(lobby.seats.map((s) => s.name.toLowerCase()));
  const themed = getTheme(lobby.settings.themeId).botNames.find((n) => !used.has(n.toLowerCase()));
  return themed ?? `Bot ${lobby.seats.length + 1}`;
}

/** After a country switch, give bots with an auto name the new country's names (in seat order). */
function renameBots(lobby: StoredLobby): void {
  const autoNamed = lobby.seats.filter((s) => s.kind === "bot" && ALL_BOT_NAMES.has(s.name));
  for (const seat of autoNamed) {
    seat.name = "";
  }
  for (const seat of autoNamed) {
    seat.name = nextBotName(lobby);
  }
}

function addBotSeat(lobby: StoredLobby, level: BotLevel): void {
  lobby.seats.push({
    playerId: nextPlayerId(lobby.seats),
    name: nextBotName(lobby),
    color: pickColor(lobby.seats),
    tokenId: pickToken(lobby.settings, lobby.seats),
    kind: "bot",
    botLevel: level,
    isHost: false,
    tokenHash: "",
  });
}
function reassignTokens(lobby: StoredLobby): void {
  const valid = new Set(getTheme(lobby.settings.themeId).tokens.map((t) => t.id));
  const kept: StoredSeat[] = [];
  for (const s of lobby.seats) {
    if (!valid.has(s.tokenId) || kept.some((k) => k.tokenId === s.tokenId))
      s.tokenId = pickToken(lobby.settings, [
        ...kept,
        ...lobby.seats.filter((x) => x !== s && !kept.includes(x) && valid.has(x.tokenId)),
      ]);
    kept.push(s);
  }
}

// ---------- http utils ----------
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Body zu gross.");
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  const parsed = attemptSync("http:json", () => JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!parsed.ok) throw new HttpError(400, "Ungültiges JSON.");
  return parsed.value;
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

/* eslint-disable security/detect-non-literal-fs-filename -- every path below is realpath'd and verified to be inside the static root (no dotfiles, no symlink escapes) */
function serveStatic(root: string, pathname: string, res: ServerResponse, head: boolean): void {
  // `root` must be a realpath'd absolute dir (done once at startup).
  const index = join(root, "index.html");
  const isFile = (f: string): boolean => {
    const stat = attemptSync("static:stat", () => statSync(f).isFile());
    return stat.ok && stat.value;
  };
  /** Resolve to a real file strictly inside root (symlinks included), else null. */
  const inside = (f: string): string | null => {
    const real = attemptSync("static:realpath", () => realpathSync(f));
    return real.ok && real.value.startsWith(root + sep) && isFile(real.value) ? real.value : null;
  };
  const decoded = attemptSync("static:decode", () => decodeURIComponent(pathname));
  let rel = decoded.ok ? decoded.value : "/";
  if (rel.includes("\0")) rel = "/";
  const candidate = resolve(join(root, normalize(rel)));
  // no dotfiles / dot directories; only extension-less paths (client routes) fall back to index.html
  const isRoute = !(rel.split("/").pop() ?? "").includes(".");
  const requested = candidate.startsWith(root + sep) ? inside(candidate) : null;
  const file = hasDotSegment(rel) ? null : (requested ?? (isRoute ? inside(index) : null));
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": statSync(file).size,
    "cache-control": staticCacheControl(relative(root, file)),
  });
  if (head) return void res.end();
  pipeline(createReadStream(file), res, (e) => {
    if (e) res.destroy();
  });
}

/* eslint-enable security/detect-non-literal-fs-filename */

// ---------- server ----------
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const env = EnvSchema.parse(process.env);
  const dataDir =
    options.dataDir ??
    env.DATA_DIR ??
    resolve(fileURLToPath(new URL("../../../data", import.meta.url)));
  const botDelayMs = options.botDelayMs ?? env.BOT_DELAY_MS;
  const staticDirRaw =
    options.staticDir !== undefined ? options.staticDir : defaultStaticDir(env.NODE_ENV);
  let staticDir: string | null = null;
  if (staticDirRaw) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- STATIC_DIR is operator config
    const real = attemptSync("static:root", () => realpathSync(resolve(staticDirRaw)));
    if (real.ok) staticDir = real.value;
    else console.error(`[static] directory not found: ${staticDirRaw}`);
  }

  // invalid TTL settings abort the start before the database is touched
  const retention = options.retention ?? loadRetention(process.env);
  const testMode = isTestModeEnabled(process.env, options.testMode) ? new TestMode() : null;
  // test mode (refused in production) and test options may use settings below the floors (e2e speed)
  const floors = !(testMode || options.allowLowSettings);
  const journalMode = loadJournalMode(process.env);
  const sqliteLocking = loadSqliteLocking(process.env);
  if (dataDir !== ":memory:") {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- DATA_DIR is operator config
    mkdirSync(dataDir, { recursive: true });
  }
  // invalid lease settings abort the start before anything is opened
  const lease =
    options.writerLease ??
    loadWriterLease(process.env, dataDir, {
      onIssue: (op, issue) => recordLeaseIssue("azure-blob", op, issue),
    });
  // no file locks only behind a writer lease and with the rollback journal (docs/DESIGN.md #95)
  checkSqliteLocking(sqliteLocking, journalMode, lease.kind);
  const handoverMode = options.leaseHandover ?? loadHandoverMode(process.env);
  const build = options.buildId ?? readBuildId(staticDir);
  const limits = loadLimits(process.env, options.limits);
  const hubOpts: RoomOptions = {
    botDelayMs,
    build,
    retention,
    chatLimiter: new KeyedLimiter({
      burst: limits.chatBurst,
      perHour: limits.chatPerHour,
      maxKeys: MAX_TRACKED,
    }),
  };
  if (options.runWithoutHumans) hubOpts.runWithoutHumans = true;
  const trustHops = options.trustProxyHops ?? loadTrustProxyHops(process.env);
  const createSchema = floors ? CreateGameRequestSchema : UnflooredCreateGameRequestSchema;
  const createLimiter = new KeyedLimiter({
    burst: limits.createBurst,
    perHour: limits.createPerHour,
    maxKeys: MAX_TRACKED,
  });
  const joinLimiter = new KeyedLimiter({
    burst: limits.joinBurst,
    perHour: limits.joinPerHour,
    maxKeys: MAX_TRACKED,
  });
  const powLimiter = new KeyedLimiter({
    burst: limits.powBurst,
    perHour: limits.powPerHour,
    maxKeys: MAX_TRACKED,
  });
  const pow = new PowService(loadPowConfig(process.env, testMode !== null, options.pow));
  const socketsPerIp = new ConnectionCounter(limits.wsPerIp);
  const ipOf = (req: IncomingMessage): string => clientIp(req, trustHops);
  const limited = (take: Take): void => {
    if (!take.ok) throw new HttpError(429, RATE_LIMITED_MESSAGE, take.retryAfterSec);
  };
  if (options.retentionIntervalMs !== undefined)
    hubOpts.retentionIntervalMs = options.retentionIntervalMs;
  if (options.clock) hubOpts.clock = options.clock;
  if (testMode) hubOpts.diceRig = testMode.rig;
  if (options.idleMs !== undefined) hubOpts.idleMs = options.idleMs;
  if (options.sweepMs !== undefined) hubOpts.sweepMs = options.sweepMs;

  // ---------- writer lease: the database and the hub exist only while this instance holds the lease ----------
  interface Core {
    db: Db;
    hub: Hub;
    stopObserving: () => void;
  }
  let core: Core | null = null;
  const probe = options.writerProbe;
  /** written by the write self-test into the database only (which replica wrote last); never logged or exported */
  const instanceId = `${hostname()}#${randomUUID().slice(0, 8)}`;
  const openCore = (): void => {
    probe?.opened();
    const db = attemptSync("db:open", () => {
      return new Db(dataDir, {
        journalMode,
        clampSettings: floors,
        // a second process on a local disk gets "database is locked" instead of writing (defence in depth)
        exclusiveLock: lease.kind === "file" && sqliteLocking === "default",
        fileLocking: sqliteLocking,
        writeGuard: () => {
          if (!coordinator.canWrite()) throw new LeaseFencedError();
          probe?.wrote();
        },
        onWriteHealth: (e) => {
          recordWriteHealth(lease.kind, e);
          if (e.healthy) console.warn("[db] database writes work again, ready");
          else
            console.error(
              `[db] database writes failing (${e.failures} in a row), not ready:`,
              e.error,
            );
        },
        ...(options.dbWriteFault ? { writeFault: options.dbWriteFault } : {}),
        ...(options.schemaMigrations ? { migrations: options.schemaMigrations } : {}),
      });
    });
    if (!db.ok) {
      probe?.closed();
      throw db.error;
    }
    // ready means "can write" (DESIGN #94): one real write through the fenced path before anything is served. On a
    // failure the database is closed without writing and the activation fails: the coordinator gives the lease back and
    // steps aside, so a former holder can take over again; /api/ready stays 503 (no core).
    const checked = attemptSync("db:writeCheck", () => db.value.writeCheck(instanceId));
    if (!checked.ok) {
      db.value.close({ checkpoint: false });
      probe?.closed();
      if (checked.error instanceof LeaseFencedError) throw checked.error;
      recordWriteCheckFailed(lease.kind, checked.error);
      console.error("[db] write self-test failed, not serving:", checked.error);
      throw new WriteCheckError(checked.error);
    }
    const hub = new Hub(db.value, hubOpts);
    core = { db: db.value, hub, stopObserving: observeHub(hub) };
    // expired games go before they are resumed (no timers for games that are about to be deleted)
    hub.startRetention();
    hub.resumeAll();
  };
  /** handover / shutdown: finish queued work, persist every room, then close the database */
  const drainCore = async (): Promise<void> => {
    const c = core;
    if (!c) return;
    c.stopObserving();
    await c.hub.shutdown();
    core = null;
    c.db.close();
    probe?.closed();
  };
  /** lease lost: stop at once and persist nothing (another process may own the file by now) */
  const fenceCore = (): void => {
    const c = core;
    if (!c) return;
    core = null;
    c.stopObserving();
    c.hub.abandon();
    c.db.close();
    probe?.closed();
  };
  const coordinator = new WriterCoordinator(
    lease,
    {
      activate: () => Promise.resolve().then(openCore),
      drain: drainCore,
      fence: fenceCore,
      disconnect: () => disconnectAll(),
    },
    {
      onEvent: (e) => {
        recordLeaseEvent(lease.kind, e);
        if (e.type === "state") console.warn(`[lease] ${lease.kind}: ${e.state}`);
        if (e.type === "handover-triggered")
          console.warn(`[lease] ${lease.kind}: first request, asking the holder to hand over`);
        if (e.type === "lost") console.error(`[lease] ${lease.kind}: lease lost, writes stopped`);
        if (e.type === "activate-failed") console.error("[lease] activation failed:", e.error);
      },
      isFatal: (e) => e instanceof MigrationError,
      stepAside: (e) => e instanceof WriteCheckError,
      ...(options.leaseRejoinDelayMs === undefined
        ? {}
        : { rejoinDelayMs: options.leaseRejoinDelayMs }),
      ...(options.leaseRetryDelayMs === undefined
        ? {}
        : { retryDelayMs: options.leaseRetryDelayMs }),
    },
  );
  /** the core of an instance that serves right now; 503 (standby) otherwise */
  const activeCore = (): Core => {
    if (core && coordinator.state === "active") return core;
    throw standbyError();
  };
  /** queued room work refuses to run on a room that was closed meanwhile (handover): nothing applied, 503 */
  const serve = <T>(room: GameRoom, fn: () => T): Promise<T> =>
    room.enqueue(() => {
      if (room.isClosed) throw standbyError();
      return fn();
    });
  // keyed by client address + game (never by game alone: that would let anyone lock a lobby); pruned every minute
  const inviteFails = new Map<string, { n: number; since: number }>();
  const rotations = new Map<string, number[]>();
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of inviteFails) if (now - v.since >= INVITE_WINDOW_MS) inviteFails.delete(k);
    for (const [k, v] of rotations) {
      if (v.every((at) => now - at >= ROTATE_WINDOW_MS)) rotations.delete(k);
    }
    createLimiter.prune();
    joinLimiter.prune();
    powLimiter.prune();
  }, MAINTENANCE_INTERVAL_MS);
  maintenance.unref();
  const trackBounded = <V>(map: Map<string, V>, key: string, value: V): void => {
    map.delete(key);
    map.set(key, value);
    if (map.size > MAX_TRACKED) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
  };

  const hostOf = (room: GameRoom, req: IncomingMessage): StoredSeat => {
    const t = req.headers["x-player-token"];
    const seat = room.seatByToken(Array.isArray(t) ? t[0] : t);
    if (!seat || !seat.isHost) throw new HttpError(403, "Nur der Host darf das.");
    return seat;
  };
  const needLobby = (room: GameRoom) => {
    if (room.lobby.status !== "lobby") throw new HttpError(409, "Das Spiel hat bereits begonnen.");
  };

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop 'api'
    // HEAD answers like GET; node drops the body of a HEAD response (the allow-list only lets HEAD through for GET routes)
    const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");

    if (parts[0] === "themes" && parts.length === 1 && method === "GET") {
      return sendJson(
        res,
        200,
        Object.values(THEMES).map((t) => ({ id: t.id, name: t.name, flag: t.flag })),
      );
    }
    // readiness: only the instance that holds the writer lease, serves and can write (DESIGN #94; liveness stays
    // /api/themes). Failing writes turn it off but keep the lease: visible to the deploy script, no automatic handover.
    if (parts[0] === "ready" && parts.length === 1 && method === "GET") {
      const state = coordinator.state;
      if (state === "active" && core && !core.db.writesHealthy)
        return sendJson(res, 503, { state, writes: "failing" });
      return sendJson(res, state === "active" && core ? 200 : 503, { state });
    }
    // platform readiness (DESIGN #91): the process is up and answers, in standby too, so the traffic can reach a new
    // revision before it holds the lease (its first real request starts the handover in on-traffic mode)
    if (parts[0] === "live" && parts.length === 1 && method === "GET") {
      return sendJson(res, 200, { state: coordinator.state });
    }
    // everything below needs the database
    const c = activeCore();
    if (testMode && parts[0] === "test") {
      const body = method === "POST" ? await readJson(req) : undefined;
      const r = await testMode.handle(c.hub, { method, parts: parts.slice(1), body });
      if (r) return sendJson(res, r.status, r.body);
    }
    if (parts[0] === "pow" && parts[1] === "challenge" && parts.length === 2 && method === "POST") {
      limited(await powLimiter.take(limitKey(ipOf(req))));
      parseBody(PowChallengeRequestSchema, await readJson(req));
      const issued = await pow.issue("create-game");
      if (!issued.ok) {
        powChallenges.add(1, { result: "full" });
        throw new HttpError(503, POW_BUSY_MESSAGE, issued.retryAfterSec);
      }
      powChallenges.add(1, { result: "issued" });
      return sendJson(res, 200, { challenge: issued.challenge });
    }
    if (parts[0] !== "games") throw new HttpError(404, "Unbekannter Endpunkt.");

    if (parts.length === 1 && method === "POST") {
      limited(await createLimiter.take(limitKey(ipOf(req))));
      const body = parseBody(createSchema, await readJson(req), isFloorIssue);
      if (c.db.countByStatus().lobby >= limits.maxOpenLobbies)
        throw new HttpError(503, SERVER_FULL_MESSAGE, 600);
      // last check, after everything else is valid: the challenge is consumed only for a request that creates a game
      const powHeader = req.headers[POW_HEADER];
      const solved = await pow.redeem(
        Array.isArray(powHeader) ? powHeader[0] : powHeader,
        "create-game",
      );
      powSolutions.add(1, { result: solved.ok ? "ok" : solved.reason });
      if (!solved.ok) throw new HttpError(403, POW_FAILURES[solved.reason]);
      const hostName = cleanName(body.hostName);
      if (!hostName) throw new HttpError(400, "Name fehlt.");
      const maxPlayers = body.maxPlayers;
      const bots = body.bots;
      if (bots.length + 1 > maxPlayers) throw new HttpError(400, "Zu viele Bots für maxPlayers.");
      const settings = mergeSettings(
        { ...DEFAULT_SETTINGS, buildingLimits: { ...DEFAULT_SETTINGS.buildingLimits } },
        body.settings,
        floors,
      );
      if (body.tokenId !== undefined) assertThemePiece(settings, body.tokenId);
      // still the serving instance after the awaits above? (a handover may have started meanwhile)
      if (activeCore() !== c) throw standbyError();
      let gameId = rid(8);
      while (c.db.exists(gameId)) gameId = rid(8);
      const token = randomBytes(18).toString("base64url");
      const lobby: StoredLobby = {
        gameId,
        inviteCode: inviteCodeGen(),
        status: "lobby",
        settings,
        seats: [],
        maxPlayers,
        createdAt: Date.now(),
        chat: { ...DEFAULT_CHAT_SETTINGS, muted: [] },
      };
      lobby.seats.push({
        playerId: "p1",
        name: hostName,
        color: pickColor([]),
        tokenId: pickToken(settings, [], body.tokenId),
        kind: "human",
        botLevel: "normal",
        isHost: true,
        tokenHash: sha256(token),
      });
      for (const b of bots) addBotSeat(lobby, b);
      c.hub.add(lobby);
      const out: JoinResponse = {
        gameId,
        playerId: "p1",
        playerToken: token,
        inviteCode: lobby.inviteCode,
      };
      return sendJson(res, 201, out);
    }

    const idParsed = GameIdSchema.safeParse(parts[1]);
    if (!idParsed.success) throw new HttpError(404, "Spiel nicht gefunden.");
    // pin the room for the whole request: the idle sweep must not dispose it while we await the body
    const handled = await c.hub.withRoom(idParsed.data, (room) =>
      roomApi(c, room, parts, method, req, res),
    );
    if (!handled) throw new HttpError(404, "Spiel nicht gefunden.");
  }

  async function roomApi(
    c: Core,
    room: GameRoom,
    parts: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const sub = parts[2];

    if (!sub && method === "GET") return sendJson(res, 200, room.info());

    if (sub === "join" && method === "POST") {
      const ip = ipOf(req);
      limited(await joinLimiter.take(limitKey(ip)));
      const body = parseBody(JoinGameRequestSchema, await readJson(req));
      const name = cleanName(body.name);
      if (!name) throw new HttpError(400, "Name fehlt.");
      const now = Date.now();
      const failKey = `${ip}|${room.lobby.gameId}`;
      const fails = inviteFails.get(failKey);
      if (fails && now - fails.since < INVITE_WINDOW_MS && fails.n >= INVITE_MAX_FAILS)
        throw new HttpError(429, "Zu viele Versuche. Bitte später erneut.");
      if (
        !safeEqualHex(sha256(body.inviteCode.trim().toUpperCase()), sha256(room.lobby.inviteCode))
      ) {
        const cur = fails && now - fails.since < INVITE_WINDOW_MS ? fails : { n: 0, since: now };
        cur.n++;
        trackBounded(inviteFails, failKey, cur);
        throw new HttpError(403, "Falscher Einladungscode.");
      }
      return void (await serve(room, () => {
        needLobby(room);
        if (room.lobby.seats.length >= room.lobby.maxPlayers)
          throw new HttpError(409, "Das Spiel ist voll.");
        if (room.lobby.seats.some((x) => x.name.toLowerCase() === name.toLowerCase()))
          throw new HttpError(409, "Dieser Name ist schon vergeben.");
        const token = randomBytes(18).toString("base64url");
        // unknown id = client bug (400); a piece taken meanwhile = a lost race: the seat gets a free one and the
        // lobby shows it (a 409 would only throw the guest back to a form they cannot fix without a refresh)
        const wanted = body.tokenId;
        if (wanted !== undefined) assertThemePiece(room.lobby.settings, wanted);
        const seat: StoredSeat = {
          playerId: nextPlayerId(room.lobby.seats),
          name,
          color: pickColor(room.lobby.seats),
          tokenId: pickToken(room.lobby.settings, room.lobby.seats, wanted),
          kind: "human",
          botLevel: "normal",
          isHost: false,
          tokenHash: sha256(token),
        };
        room.lobby.seats.push(seat);
        room.persist(true);
        room.broadcastLobby();
        const out: JoinResponse = {
          gameId: room.lobby.gameId,
          playerId: seat.playerId,
          playerToken: token,
          inviteCode: room.lobby.inviteCode,
        };
        sendJson(res, 201, out);
      }));
    }

    if (sub === "seats" && parts[3] === "me" && parts.length === 4 && method === "PATCH") {
      const t = req.headers["x-player-token"];
      const header = Array.isArray(t) ? t[0] : t;
      if (!room.seatByToken(header)) throw new HttpError(403, "Ungültiger Spielerschlüssel.");
      const body = parseBody(SeatUpdateRequestSchema, await readJson(req));
      return void (await serve(room, () => {
        const seat = room.seatByToken(header);
        if (!seat) throw new HttpError(403, "Ungültiger Spielerschlüssel.");
        needLobby(room);
        assertThemePiece(room.lobby.settings, body.tokenId);
        if (room.lobby.seats.some((s) => s !== seat && s.tokenId === body.tokenId))
          throw new HttpError(409, "Diese Spielfigur ist schon vergeben.");
        seat.tokenId = body.tokenId;
        room.persist(true);
        room.broadcastLobby();
        sendJson(res, 200, room.info());
      }));
    }

    if (sub === "seats" && parts[3] === "me" && parts[4] === "token" && method === "POST") {
      parseBody(RotateTokenRequestSchema, await readJson(req));
      const t = req.headers["x-player-token"];
      return void (await serve(room, () => {
        const seat = room.seatByToken(Array.isArray(t) ? t[0] : t);
        if (!seat || seat.kind !== "human")
          throw new HttpError(403, "Ungültiger Spielerschlüssel.");
        const key = `${room.lobby.gameId}:${seat.playerId}`;
        const now = Date.now();
        const recent = (rotations.get(key) ?? []).filter((at) => now - at < ROTATE_WINDOW_MS);
        if (recent.length >= ROTATE_MAX_PER_WINDOW)
          throw new HttpError(429, "Zu viele Versuche. Bitte später erneut.");
        trackBounded(rotations, key, [...recent, now]);
        const token = randomBytes(18).toString("base64url");
        seat.tokenHash = sha256(token);
        room.persist(true);
        room.dropSeatSockets(seat.playerId, WS_CLOSE_TOKEN_ROTATED, WS_CLOSE_TOKEN_ROTATED_REASON);
        const out: RotateTokenResponse = { playerToken: token };
        sendJson(res, 200, out);
      }));
    }

    // host-only below
    if (sub === "bots" && method === "POST") {
      hostOf(room, req);
      const level = parseBody(BotBodySchema, await readJson(req)).botLevel;
      return void (await serve(room, () => {
        needLobby(room);
        if (room.lobby.seats.length >= room.lobby.maxPlayers)
          throw new HttpError(409, "Das Spiel ist voll.");
        addBotSeat(room.lobby, level);
        room.persist(true);
        room.broadcastLobby();
        sendJson(res, 200, room.info());
      }));
    }
    if (sub === "seats" && parts[3] && method === "DELETE") {
      hostOf(room, req);
      const pidParsed = SeatIdSchema.safeParse(parts[3]);
      if (!pidParsed.success) throw new HttpError(404, "Sitz nicht gefunden.");
      const pid = pidParsed.data;
      return void (await serve(room, () => {
        needLobby(room);
        const seat = room.lobby.seats.find((s) => s.playerId === pid);
        if (!seat) throw new HttpError(404, "Sitz nicht gefunden.");
        if (seat.isHost) throw new HttpError(400, "Der Host kann nicht entfernt werden.");
        room.lobby.seats = room.lobby.seats.filter((s) => s !== seat);
        // a mute belongs to the person, not to the seat id (ids can be handed out again)
        room.lobby.chat.muted = room.lobby.chat.muted.filter((id) => id !== pid);
        room.persist(true);
        room.kick(pid);
        room.broadcastLobby();
        sendJson(res, 200, room.info());
      }));
    }
    if (sub === "settings" && method === "PATCH") {
      hostOf(room, req);
      const body = await readJson(req);
      return void (await serve(room, () => {
        needLobby(room);
        room.lobby.settings = mergeSettings(room.lobby.settings, body, floors);
        reassignTokens(room.lobby);
        renameBots(room.lobby);
        room.persist(true);
        room.broadcastLobby();
        sendJson(res, 200, room.info());
      }));
    }
    if (sub === "chat" && method === "PATCH") {
      hostOf(room, req);
      const body = parseBody(ChatUpdateRequestSchema, await readJson(req));
      return void (await serve(room, () => {
        if (body.mute) {
          const target = room.lobby.seats.find((s) => s.playerId === body.mute?.playerId);
          if (!target) throw new HttpError(404, "Sitz nicht gefunden.");
          if (target.kind !== "human" || target.isHost)
            throw new HttpError(400, "Dieser Spieler kann nicht stummgeschaltet werden.");
        }
        room.applyChatUpdate(body);
        sendJson(res, 200, room.info());
      }));
    }
    if (sub === "start" && method === "POST") {
      hostOf(room, req);
      return void (await serve(room, () => {
        needLobby(room);
        if (room.lobby.seats.length < 2) throw new HttpError(400, "Mindestens 2 Spieler nötig.");
        if (c.db.countByStatus().running >= limits.maxRunningGames)
          throw new HttpError(503, SERVER_FULL_MESSAGE, 600);
        const players: NewPlayer[] = room.lobby.seats.map((s) => ({
          id: s.playerId,
          name: s.name,
          color: s.color,
          tokenId: s.tokenId,
          controller: s.kind,
          botLevel: s.botLevel,
        }));
        const created = attemptSync("game:create", () =>
          createGame(
            room.lobby.gameId,
            players,
            room.lobby.settings,
            randomInt(1, 2 ** 31),
            Date.now(),
          ),
        );
        if (!created.ok) throw new HttpError(400, created.error.message);
        room.startRunning(created.value);
        sendJson(res, 200, room.info());
      }));
    }
    throw new HttpError(404, "Unbekannter Endpunkt.");
  }

  const security = loadSecurityConfig(process.env, options.security);
  /** returns true when the request was fully answered (CORS preflight) */
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    const method = req.method ?? "GET";
    const origin = req.headers.origin;
    const target = req.url ?? "/";
    const isApi = target === "/api" || target.startsWith("/api/") || target.startsWith("/api?");
    if (method === "OPTIONS" && isApi) {
      if (origin === undefined || !security.allowedOrigins.includes(origin))
        throw new HttpError(403, "Origin nicht erlaubt.");
      applyCors(res, origin, security, true);
      res.writeHead(204);
      res.end();
      return true;
    }
    applyCors(res, origin, security, false);
    // state changes from a browser page of another origin are refused (CSRF); non-browser clients send no Origin
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      !isAllowedOrigin(origin, req.headers.host, security.allowedOrigins)
    )
      throw new HttpError(403, "Origin nicht erlaubt.");
    const rejection =
      routeRejection(method, target, testMode !== null) ?? bodyRejection(method, req.headers);
    if (rejection) {
      if (rejection.allow) res.setHeader("allow", rejection.allow);
      throw new HttpError(rejection.status, rejection.message);
    }
    return false;
  };

  /** statuses of the request allow-list (security.ts) that the telemetry counts as "rejected" */
  const REJECTED_STATUS = new Set([404, 405, 413, 414, 415]);
  const KNOWN_METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"]);

  const server = createServer((req, res) => {
    if (countsAsTraffic(req)) coordinator.noteTraffic();
    // the platform's health probes (Container Apps sends `kube-probe/<version>`) would be most of the traced requests;
    // the user agent is only read for this decision and never recorded
    if (req.headers["user-agent"]?.startsWith("kube-probe/")) {
      void handle(req, res);
      return;
    }
    // Manual server span (docs/DESIGN.md #54): only method, route TEMPLATE and status. No URL, query string, headers,
    // user agent or peer address is ever recorded, and no incoming trace context is trusted.
    const route = routeTemplate((req.url ?? "/").split("?")[0] ?? "/");
    const method = KNOWN_METHODS.has(req.method ?? "") ? (req.method ?? "GET") : "_OTHER";
    const span = tracer().startSpan(
      `${method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: { "http.request.method": method, "http.route": route },
      },
      context.active(),
    );
    res.once("close", () => {
      const status = res.statusCode;
      span.setAttribute("http.response.status_code", status);
      if (status >= 400) span.setAttribute("error.type", String(status));
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      if (REJECTED_STATUS.has(status))
        httpRejected.add(1, {
          "http.route": route,
          "http.request.method": method,
          "http.response.status_code": status,
        });
      span.end();
    });
    context.with(trace.setSpan(context.active(), span), () => {
      void handle(req, res);
    });
  });
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    applySecurityHeaders(res, security);
    const outcome = await attempt("http", async () => {
      if (guard(req, res)) return;
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
        return await api(req, res, url);
      if (staticDir && (req.method === "GET" || req.method === "HEAD"))
        return serveStatic(staticDir, url.pathname, res, req.method === "HEAD");
      throw new HttpError(404, "Not found");
    });
    if (outcome.ok) return;
    if (res.headersSent) return void res.end();
    if (outcome.error instanceof HttpError) {
      if (outcome.error.retryAfterSec !== undefined)
        res.setHeader("retry-after", String(outcome.error.retryAfterSec));
      return sendJson(
        res,
        outcome.error.status,
        outcome.error.standby
          ? { error: outcome.error.message, standby: true }
          : { error: outcome.error.message },
      );
    }
    console.error("[http]", outcome.error);
    logOperationFailed("http", outcome.error);
    sendJson(res, 500, { error: "Interner Fehler." });
  };

  // ---------- websocket ----------
  /** console line as before (message text only) plus a structured log record (error type only) */
  const wsFailed =
    (line: string, operation: string) =>
    (e: unknown): void => {
      console.error(line, errMsg(e));
      logOperationFailed(operation, e);
    };
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
  let accepting = true; // false once the shutdown has begun
  const rate = options.wsRate ?? DEFAULT_WS_RATE;
  server.on("upgrade", (req, socket, head) => {
    if (countsAsTraffic(req)) coordinator.noteTraffic();
    const path = (req.url ?? "").split("?")[0];
    if (!accepting || path !== "/ws" || wss.clients.size >= WS_MAX_SOCKETS) {
      return void socket.destroy();
    }
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, security.allowedOrigins)) {
      wsOriginRejected.add(1);
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    // per client address, counted from the upgrade on (pre-hello sockets included); released when the TCP socket closes
    const ip = ipOf(req);
    if (!socketsPerIp.acquire(ip)) {
      socket.end(
        "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 10\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    socket.once("close", () => socketsPerIp.release(ip));
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  /** handover or lost lease: every client reconnects (to whichever instance serves next) */
  const disconnectAll = (): void => {
    for (const c of wss.clients) c.close(WS_CLOSE_HANDOVER, WS_CLOSE_HANDOVER_REASON);
    const stragglers = setTimeout(() => {
      for (const c of wss.clients) if (c.readyState === c.CLOSING) c.terminate();
    }, WS_CLOSE_GRACE_MS);
    stragglers.unref();
  };
  wss.on("connection", (ws) => {
    // no database here right now: "reconnect shortly" (the browser sees a close code, an HTTP 503 would be opaque)
    if (!core || coordinator.state !== "active") {
      ws.close(WS_CLOSE_HANDOVER, WS_CLOSE_HANDOVER_REASON);
      return;
    }
    wsConnections.add(1);
    ws.once("close", () => wsConnections.add(-1));
    let room: GameRoom | null = null;
    let conn: Conn | null = null;
    let alive = true;
    const bucket = new TokenBucket(rate.burst, rate.perSec);
    let strikes = 0;
    let lastStrike = 0;
    const strikeDecayMs = rate.strikeDecayMs ?? WS_STRIKE_DECAY_MS;
    // sockets that never say hello must not linger
    const helloTimer = setTimeout(() => {
      if (room) return;
      ws.close(4408, "hello timeout");
      setTimeout(() => ws.terminate(), 2000).unref(); // a client that ignores the close handshake must not keep its slot
    }, options.wsHelloTimeoutMs ?? WS_HELLO_TIMEOUT_MS);
    ws.on("pong", () => (alive = true));
    const err = (message: string) =>
      ws.readyState === 1 && ws.send(JSON.stringify({ t: "error", message }));
    ws.on("message", (raw: RawData, isBinary: boolean) => {
      if (!bucket.take()) {
        const now = Date.now();
        if (now - lastStrike > strikeDecayMs) strikes = 0;
        lastStrike = now;
        if (++strikes >= WS_RATE_STRIKES_BEFORE_CLOSE) ws.close(1008, "rate limit");
        else err("Zu viele Nachrichten.");
        return;
      }
      if (isBinary) return void err("Ungültige Nachricht.");
      attemptSync(
        "ws:message",
        () => {
          const json = attemptSync("ws:json", () => JSON.parse(raw.toString()));
          if (!json.ok) return err("Ungültiges JSON.");
          const parsed = ClientMessageSchema.safeParse(json.value);
          if (!parsed.success) return err("Ungültige Nachricht.");
          const msg = parsed.data;
          if (msg.t === "ping") return void ws.send('{"t":"pong"}');
          if (!core || coordinator.state !== "active") return err(STANDBY_MESSAGE);
          if (msg.t === "hello") {
            if (room) return err("Bereits verbunden.");
            const r = core.hub.get(msg.gameId);
            if (!r) return err("Spiel nicht gefunden.");
            const token = msg.playerToken;
            const added = r.addSocket(ws, r.seatByToken(token) !== null);
            if (!added) return void ws.close(1013, "room full");
            room = r;
            conn = added;
            clearTimeout(helloTimer);
            r.enqueue(() => r.hello(added, token)).catch(wsFailed("[ws] hello failed", "ws:hello"));
            return;
          }
          if (!room || !conn) return err("Zuerst hello senden.");
          const c = conn;
          const rm = room;
          if (msg.t === "action") {
            rm.humanAction(c, msg.action).catch(wsFailed("[ws] action failed", "ws:action"));
          } else if (msg.t === "chat") {
            const text = msg.text;
            rm.enqueue(() => rm.chatFrom(c, text)).catch(wsFailed("[ws] chat failed", "ws:chat"));
          } else if (msg.t === "quick-chat") {
            const id = msg.id;
            rm.enqueue(() => rm.quickChatFrom(c, id)).catch(
              wsFailed("[ws] chat failed", "ws:chat"),
            );
          }
        },
        (_label, e) => {
          console.error("[ws]", e);
          logOperationFailed("ws:message", e);
          err("Interner Fehler.");
        },
      );
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (room && conn) room.removeSocket(conn);
    });
    ws.on("error", () => undefined);
    const iv = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      attemptSync("ws:ping", () => ws.ping());
    }, 30_000);
    ws.on("close", () => clearInterval(iv));
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? env.PORT, options.host, ok);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  // a fresh process asks the current holder (if any) to hand over: blue/green deploys, docs/DESIGN.md #89; in
  // on-traffic mode (Azure, #91) only once its first real request arrives, i.e. after the traffic was shifted to it
  coordinator.start({ requestHandover: handoverMode === "on-traffic" ? "on-traffic" : true });

  /**
   * Graceful shutdown (docs/DESIGN.md #44): stop accepting, finish queued work and persist every room, then
   * tell all sockets "Service Restart" (1012) so clients reconnect quickly to the next version.
   */
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      accepting = false;
      clearInterval(maintenance);
      server.close(); // stops listening; open connections stay until they are closed below
      // holding the lease: drain (persist every room, close the database) and release it for the next instance
      await coordinator.stop();
      for (const c of wss.clients) c.close(WS_SERVICE_RESTART, "Service Restart");
      // a client that does not answer the close handshake must not hold up the exit
      const stragglers = setTimeout(() => {
        for (const c of wss.clients) c.terminate();
      }, WS_CLOSE_GRACE_MS);
      await new Promise<void>((ok) => wss.close(() => ok()));
      clearTimeout(stragglers);
      await new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
    })());
  if (options.waitUntilActive !== false) {
    const started = await attempt("writer:start", () => coordinator.whenActive());
    if (!started.ok) {
      await close();
      throw started.error;
    }
  }
  return {
    server,
    port,
    get hub(): Hub {
      if (!core) throw new Error("this instance does not hold the writer lease (standby)");
      return core.hub;
    },
    writerState: () => coordinator.state,
    whenActive: () => coordinator.whenActive(),
    close,
  };
}
