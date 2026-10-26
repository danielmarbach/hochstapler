import { createHash, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import {
  applyAction,
  applyBotAction,
  attemptSync,
  chooseBotAction,
  chooseBotTradeResponses,
  handleTimeout,
  redactState,
  restartClocks,
  MAX_CHAT_LINES,
  setController,
  whoMustAct,
  WS_CLOSE_GAME_EXPIRED,
  WS_CLOSE_GAME_EXPIRED_REASON,
} from "@poly/engine";
import type {
  ApplyResult,
  ChatRejectReason,
  ChatUpdateRequest,
  QuickChatId,
  OnError,
  GameAction,
  GameEvent,
  GameState,
  LobbyInfo,
  PlayerId,
  ServerMessage,
} from "@poly/engine";
import { SpanKind } from "@opentelemetry/api";
import {
  actionDuration,
  actionsTrimmed,
  botMoves,
  broadcastTimed,
  chatMessages,
  chatRejected,
  emitLog,
  epochNow,
  gamesExpired,
  logOperationFailed,
  recordSpan,
  spanEvent,
  spanGameId,
  timed,
  wsReconnects,
} from "./telemetry.ts";
import { checkChatText } from "./chat/filter.ts";
import type { KeyedLimiter } from "./limits.ts";
import { DEFAULT_RETENTION, expiryPolicy } from "./retention.ts";
import type { RetentionConfig } from "./retention.ts";
import type { Db, ExpiredGame, PurgeResult, StoredLobby, StoredSeat } from "./db.ts";
import type { DiceRig } from "./test-mode.ts";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Constant-time comparison of two hex digests (different length => false). */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export interface RoomOptions {
  botDelayMs: number;
  /** id of the served client build, sent in every welcome so outdated clients can reload */
  build: string;
  /** unload rooms without sockets/timers after this long (default 10 min) */
  idleMs?: number;
  sweepMs?: number;
  /** per-player chat rate limit keyed by game and player (docs/DESIGN.md #69); none = unlimited */
  chatLimiter?: KeyedLimiter;
  /** data retention limits (docs/DESIGN.md #57); defaults to DEFAULT_RETENTION */
  retention?: RetentionConfig;
  /** how often the retention sweep runs (default hourly) */
  retentionIntervalMs?: number;
  /** clock of the retention sweep (tests) */
  clock?: () => number;
  /** test mode only: steers the dice (see test-mode.ts) */
  diceRig?: DiceRig;
  /**
   * TESTS ONLY, never set by the server itself: keep bot and turn timers running while no human is connected
   * (production pauses them, docs/DESIGN.md #60).
   */
  runWithoutHumans?: boolean;
}

interface Conn {
  ws: WebSocket;
  playerId: PlayerId | null;
  gameId: string | null;
}

/** Answer to an action that arrives while the server is shutting down for an update. */
export const RESTARTING_MESSAGE = "Der Server wird gerade aktualisiert – bitte gleich nochmal.";
export const MAX_CONNS_PER_ROOM = 64;
export const ROOM_IDLE_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
export const RETENTION_INTERVAL_MS = 60 * 60_000;
/** a seated player reconnecting at most counts as activity this often per room (each count is a DB write) */
const HELLO_TOUCH_MIN_MS = 60_000;
const MAX_BOT_FAILURES = 3;

/** onError for fail-soft operations: the server's log sink. */
const logFailure: OnError = (label, error) => {
  console.error(`[${label}]`, error);
  logOperationFailed(label, error);
};

/** Replace ASCII control characters (incl. DEL) without a control-character regex. */
export function replaceControlChars(text: string, replacement: string): string {
  return Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? replacement : ch;
  }).join("");
}

export function toLobbyInfo(lobby: StoredLobby, connected: Set<PlayerId>): LobbyInfo {
  return {
    gameId: lobby.gameId,
    status: lobby.status,
    settings: lobby.settings,
    seats: lobby.seats.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      color: s.color,
      tokenId: s.tokenId,
      kind: s.kind,
      botLevel: s.botLevel,
      connected: s.kind === "bot" ? true : connected.has(s.playerId),
      isHost: s.isHost,
    })),
    maxPlayers: lobby.maxPlayers,
    createdAt: lobby.createdAt,
    chat: {
      mode: lobby.chat.mode,
      // only seats that exist: a stale id must not mute whoever later gets that seat id
      muted: lobby.chat.muted.filter((id) => lobby.seats.some((s) => s.playerId === id)),
    },
  };
}

type ChatLine = Extract<ServerMessage, { t: "chat" }> | Extract<ServerMessage, { t: "quick-chat" }>;

export class GameRoom {
  lobby: StoredLobby;
  state: GameState | null;
  private conns = new Set<Conn>();
  /** last chat lines of this game; memory only, gone with the room (and with the game, docs/DESIGN.md #69) */
  private chat: ChatLine[] = [];
  private queue: Promise<void> = Promise.resolve();
  private botTimer: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private botFailures = 0;
  private stalledDeadline: number | null = null;
  private closed = false;
  /** disposed (shutdown, handover, lost lease): queued and new work is refused */
  get isClosed(): boolean {
    return this.closed;
  }
  /** the game was deleted by the retention sweep: nothing may write it back */
  private expired = false;
  private lastHelloTouch = 0;
  /** when this room saw the game start (memory only; unknown for a game loaded from the database) */
  private startedAt: number | null = null;
  /** seats that connected at least once while this room was in memory (reconnect counter only) */
  private seenSeats = new Set<PlayerId>();
  private pending = 0;
  /** HTTP handlers (or anything else outside the queue) currently using this room; blocks the idle sweep */
  private leases = 0;
  lastActive = Date.now();

  private db: Db;
  private opts: RoomOptions;

  constructor(lobby: StoredLobby, state: GameState | null, db: Db, opts: RoomOptions) {
    this.lobby = lobby;
    this.state = state;
    this.db = db;
    this.opts = opts;
  }

  // ---------- helpers ----------
  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    this.pending++;
    this.lastActive = Date.now();
    const run = this.queue.then(fn);
    this.queue = run.then(
      () => void this.pending--,
      () => void this.pending--,
    );
    return run;
  }

  connectedIds(): Set<PlayerId> {
    const s = new Set<PlayerId>();
    for (const c of this.conns) if (c.playerId && c.ws.readyState === 1) s.add(c.playerId);
    return s;
  }

  /**
   * A seated person has an open socket (spectators do not count). Without one the game waits: no bot moves, no turn
   * timers (docs/DESIGN.md #60), so a game nobody watches cannot burn CPU or storage transactions.
   */
  humanConnected(): boolean {
    for (const c of this.conns) if (c.playerId && c.gameId && c.ws.readyState === 1) return true;
    return false;
  }

  info(): LobbyInfo {
    return toLobbyInfo(this.lobby, this.connectedIds());
  }

  seatByToken(token: string | null | undefined): StoredSeat | null {
    if (!token) return null;
    const h = sha256(token);
    let found: StoredSeat | null = null;
    for (const s of this.lobby.seats) {
      // no early exit: keep timing independent of which seat matched
      if (s.kind === "human" && safeEqualHex(s.tokenHash, h)) found = s;
    }
    return found;
  }

  /** `human`: caused by a person (action, join, lobby change); only that moves the retention clock (#57). */
  persist(human = false): void {
    if (this.expired) return;
    attemptSync(
      "db:save",
      () => this.db.save(this.lobby, this.state, human ? Date.now() : undefined),
      logFailure,
    );
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage): void {
    broadcastTimed(msg.t, (tally) => {
      const data = JSON.stringify(msg);
      for (const c of this.conns) {
        if (!c.gameId || c.ws.readyState !== 1) continue;
        c.ws.send(data);
        tally.add(data);
      }
    });
  }

  broadcastLobby(): void {
    this.broadcast({ t: "lobby", lobby: this.info() });
  }

  private broadcastPresence(): void {
    this.broadcast({ t: "presence", connected: [...this.connectedIds()] });
  }

  // ---------- sockets ----------
  /**
   * Returns null when the room is full of sockets. Seated players (`seated`) may evict a spectator socket so that
   * spectators (who only need the public game id) cannot lock the players out.
   */
  addSocket(ws: WebSocket, seated = false): Conn | null {
    if (this.conns.size >= MAX_CONNS_PER_ROOM) {
      const spectator = seated
        ? [...this.conns].find((x) => x.gameId !== null && x.playerId === null)
        : undefined;
      if (!spectator) return null;
      this.conns.delete(spectator);
      spectator.ws.close(1013, "room full");
      if (spectator.gameId) this.broadcastPresence();
    }
    const c: Conn = { ws, playerId: null, gameId: null };
    this.conns.add(c);
    this.lastActive = Date.now();
    return c;
  }

  removeSocket(c: Conn): void {
    this.lastActive = Date.now();
    if (!this.conns.delete(c)) return;
    if (c.gameId) {
      this.broadcastPresence();
      this.broadcastLobby();
    }
    // the last human left: stop the timers (they are re-armed when somebody comes back)
    if (c.playerId && !this.humanConnected()) this.schedule();
  }

  hello(c: Conn, token: string | null): void {
    const seat = this.seatByToken(token);
    const attended = this.humanConnected();
    c.playerId = seat ? seat.playerId : null;
    c.gameId = this.lobby.gameId;
    if (seat) {
      if (this.seenSeats.has(seat.playerId)) wsReconnects.add(1);
      this.seenSeats.add(seat.playerId);
      this.touchHuman();
      // first human back at a waiting game: fresh clocks, so nobody is timed out for the time nobody was there
      if (!attended) this.resumeAfterWait();
    }
    this.send(c.ws, {
      t: "welcome",
      you: c.playerId,
      lobby: this.info(),
      state: this.state ? redactState(this.state, c.playerId) : null,
      build: this.opts.build,
    });
    if (this.mayReadChat(c)) for (const m of this.chat) this.send(c.ws, m);
    this.broadcastPresence();
    this.broadcastLobby();
  }

  /** Starts the game's clocks over and re-arms the bot/turn timers (called before the welcome is sent). */
  private resumeAfterWait(): void {
    const state = this.state;
    if (state && state.status === "running" && !this.closed) {
      const r = restartClocks(state, Date.now());
      this.state = r.state;
      this.persist();
      this.broadcastUpdate(r);
    }
    this.schedule();
  }

  /** A seated person opened the game: the retention clock restarts (throttled, one DB write per minute at most). */
  private touchHuman(): void {
    const now = Date.now();
    if (this.expired || now - this.lastHelloTouch < HELLO_TOUCH_MIN_MS) return;
    this.lastHelloTouch = now;
    attemptSync("db:touch", () => this.db.touchActivity(this.lobby.gameId, now), logFailure);
  }

  kick(playerId: PlayerId): void {
    for (const c of [...this.conns]) {
      if (c.playerId === playerId) {
        this.send(c.ws, { t: "error", message: "Du wurdest aus dem Spiel entfernt." });
        c.ws.close(4000, "removed");
        this.conns.delete(c);
      }
    }
    this.broadcastPresence();
    if (!this.humanConnected()) this.schedule();
  }

  /** Token rotation: every socket of the seat must resume with the new token. */
  dropSeatSockets(playerId: PlayerId, code: number, reason: string): void {
    for (const c of [...this.conns]) {
      if (c.playerId === playerId) {
        c.ws.close(code, reason);
        this.conns.delete(c);
      }
    }
    this.broadcastPresence();
    this.broadcastLobby();
    if (!this.humanConnected()) this.schedule();
  }

  // ---------- chat (docs/DESIGN.md #69) ----------
  /** The human seat behind a socket, or null (spectator, unknown token, seat removed since). */
  private chatSeat(c: Conn): StoredSeat | null {
    if (!c.playerId || !c.gameId) return null;
    const seat = this.lobby.seats.find((s) => s.playerId === c.playerId);
    return seat?.kind === "human" ? seat : null;
  }

  /** Whoever is seated may read, unless the host switched chat off. Checked per recipient on every delivery. */
  private mayReadChat(c: Conn): boolean {
    return c.ws.readyState === 1 && this.lobby.chat.mode !== "off" && this.chatSeat(c) !== null;
  }

  private deliverChat(line: ChatLine): void {
    const data = JSON.stringify(line);
    for (const c of this.conns) if (this.mayReadChat(c)) c.ws.send(data);
  }

  private refuseChat(c: Conn, reason: ChatRejectReason): void {
    chatRejected.add(1, { reason });
    this.send(c.ws, { t: "chat-rejected", reason });
  }

  /** Common gate for typed and quick messages; returns the sender's seat or tells the sender why not. */
  private async admitChat(c: Conn, kind: "free" | "quick"): Promise<StoredSeat | null> {
    if (!c.playerId) {
      this.send(c.ws, { t: "error", message: "Zuschauer können nicht chatten." });
      return null;
    }
    const seat = this.chatSeat(c);
    if (!seat) {
      // a socket whose seat is gone (removed, token rotated): same as a spectator
      this.send(c.ws, { t: "error", message: "Zuschauer können nicht chatten." });
      return null;
    }
    const chat = this.lobby.chat;
    const refusal = (): ChatRejectReason | null => {
      if (chat.mode === "off") return "off";
      if (kind === "free" && chat.mode === "quick") return "quick";
      return chat.muted.includes(seat.playerId) ? "muted" : null;
    };
    const blocked = refusal();
    if (blocked !== null) {
      this.refuseChat(c, blocked);
      return null;
    }
    const limiter = this.opts.chatLimiter;
    if (limiter) {
      const take = await limiter.take(`${this.lobby.gameId}|${seat.playerId}`);
      if (!take.ok) {
        this.refuseChat(c, "rate");
        return null;
      }
    }
    return seat;
  }

  private publishChat(line: ChatLine, kind: "free" | "quick"): void {
    this.chat.push(line);
    if (this.chat.length > MAX_CHAT_LINES) this.chat.shift();
    chatMessages.add(1, { kind });
    this.deliverChat(line);
  }

  /** A typed message: authorised, rate limited, cleaned and filtered. The text is never logged. */
  async chatFrom(c: Conn, text: string): Promise<void> {
    const seat = await this.admitChat(c, "free");
    if (!seat) return;
    const checked = checkChatText(text);
    if (!checked.ok) return this.refuseChat(c, checked.reason);
    this.publishChat(
      { t: "chat", from: seat.playerId, name: seat.name, text: checked.text, at: Date.now() },
      "free",
    );
  }

  /** One of the predefined messages (allowed in `free` and `quick` mode). */
  async quickChatFrom(c: Conn, id: QuickChatId): Promise<void> {
    const seat = await this.admitChat(c, "quick");
    if (!seat) return;
    this.publishChat(
      { t: "quick-chat", from: seat.playerId, name: seat.name, id, at: Date.now() },
      "quick",
    );
  }

  /** Host controls (the route has checked the host and that the muted seat is a human one). */
  applyChatUpdate(update: ChatUpdateRequest): void {
    const chat = this.lobby.chat;
    if (update.mode !== undefined) {
      chat.mode = update.mode;
      // switching chat off also deletes what was said
      if (update.mode === "off") this.chat = [];
    }
    if (update.mute) {
      const rest = chat.muted.filter((id) => id !== update.mute?.playerId);
      chat.muted = update.mute.muted ? [...rest, update.mute.playerId] : rest;
    }
    this.persist(true);
    this.broadcastLobby();
  }

  /** Human action from a socket. */
  humanAction(c: Conn, action: GameAction): Promise<void> {
    return this.enqueue(() => {
      // shutting down: whatever is queued behind the shutdown is refused, never half-applied after the last persist
      if (this.closed) return this.send(c.ws, { t: "error", message: RESTARTING_MESSAGE });
      const playerId = c.playerId;
      if (!playerId)
        return this.send(c.ws, { t: "error", message: "Zuschauer können nicht spielen." });
      if (!this.state || this.state.status !== "running")
        return this.send(c.ws, { t: "error", message: "Das Spiel läuft nicht." });
      const p = this.state.players.find((x) => x.id === playerId);
      if (!p) return this.send(c.ws, { t: "error", message: "Unbekannter Spieler." });
      if (p.controller === "bot")
        return this.send(c.ws, { t: "error", message: "Dieser Spieler wird vom Bot gesteuert." });
      const current = this.state;
      const outcome = attemptSync("action:apply", () =>
        this.traced("human", playerId, action.type, () => {
          const now = Date.now();
          const events: GameEvent[] = [];
          let st = this.rig(current);
          if (p.controller === "away") {
            const r = setController(st, playerId, "human", now);
            st = r.state;
            events.push(...r.events);
          }
          const r = applyAction(st, playerId, action, now);
          events.push(...r.events);
          this.botFailures = 0;
          this.commit({ state: r.state, events }, playerId, action, now, true);
        }),
      );
      // rule violations are answered to the player, not logged
      if (!outcome.ok) this.send(c.ws, { t: "error", message: outcome.error.message });
    });
  }

  // ---------- state transitions ----------
  /**
   * One span + duration sample per applied action. Attributes are a closed set: hashed game id (spanGameId), action type
   * (validated enum), seat index, actor kind, and the game context (round, state version, phase before/after: closed
   * values). Never tokens, names or addresses (docs/DESIGN.md #54, #73).
   */
  private traced<T>(
    actor: "human" | "bot" | "server",
    playerId: string,
    actionType: string,
    fn: () => T,
    /** bots: when the decision began, so the span covers it (the `bot.decide` child is its first part) */
    startTime?: number,
  ): T {
    const before = this.state;
    const seat = before?.players.findIndex((p) => p.id === playerId) ?? -1;
    return timed(
      "game.action",
      {
        "game.id": spanGameId(this.lobby.gameId),
        "game.action.type": actionType,
        "game.seat.index": seat,
        "game.actor": actor,
        ...(before ? { "game.round": before.round, "game.phase": before.phase.type } : {}),
      },
      actionDuration,
      { "game.action.type": actionType, "game.actor": actor },
      (span) => {
        const out = fn();
        const after = this.state;
        if (after) {
          span.setAttribute("game.version", after.version);
          span.setAttribute("game.round", after.round);
          span.setAttribute("game.phase.after", after.phase.type);
        }
        return out;
      },
      {
        // CONSUMER: the action is work taken from a socket message or timer; Application Insights shows it as a request
        kind: SpanKind.CONSUMER,
        // timers (bots, turn deadlines) are created inside whatever request was active and would inherit its trace and
        // sampling decision for the whole life of the game: every action is its own trace (observed on Azure)
        root: true,
        ...(startTime === undefined ? {} : { startTime }),
      },
    );
  }

  /** Game lifecycle as events on the active span: closed names and values, never names of players. */
  private lifecycle(events: GameEvent[], state: GameState): void {
    // dividends of one round end: one event with the total and the number of recipients (docs/DESIGN.md #83)
    const dividends = events.flatMap((e) => (e.type === "dividend" ? [e] : []));
    const first = dividends[0];
    if (first) {
      spanEvent("game.dividends", {
        "game.id": spanGameId(this.lobby.gameId),
        "game.round": first.round,
        "game.dividends.total": dividends.reduce((sum, e) => sum + e.amount, 0),
        "game.dividends.recipients": dividends.length,
      });
    }
    for (const e of events) {
      if (e.type === "game-over") {
        spanEvent("game.ended", {
          "game.id": spanGameId(this.lobby.gameId),
          "game.end.reason":
            state.phase.type === "game-over" ? (state.phase.reason ?? "unknown") : "unknown",
          "game.rounds": state.round,
          ...(this.startedAt === null
            ? {}
            : { "game.duration.s": Math.round((Date.now() - this.startedAt) / 1000) }),
        });
      } else if (e.type === "controller") {
        const seat = state.players.findIndex((p) => p.id === e.playerId);
        const attrs = { "game.id": spanGameId(this.lobby.gameId), "game.seat.index": seat };
        if (e.controller === "away")
          spanEvent("game.player.away", { ...attrs, "game.bot.took_over": true });
        else if (e.controller === "human") spanEvent("game.player.returned", attrs);
        else spanEvent("game.bot.took_over", attrs);
      }
    }
  }

  private commit(
    res: ApplyResult,
    playerId: string,
    action: GameAction | { type: string },
    now: number,
    human = false,
  ): void {
    this.opts.diceRig?.settle(this.lobby.gameId, res.events);
    this.state = res.state;
    this.lifecycle(res.events, res.state);
    if (res.state.status === "finished" && this.lobby.status !== "finished")
      this.lobby.status = "finished";
    if (!this.expired) {
      attemptSync(
        "db:logAction",
        () => this.db.logAction(this.lobby.gameId, res.state.version, playerId, action, now),
        logFailure,
      );
    }
    this.persist(human);
    this.broadcastUpdate(res);
    this.schedule();
  }

  private rig(state: GameState): GameState {
    return this.opts.diceRig ? this.opts.diceRig.prepare(this.lobby.gameId, state) : state;
  }

  /** Test mode only (test-mode.ts): replace the running state by a validated fixture and tell everybody. */
  loadFixture(state: GameState): void {
    this.commit({ state, events: [] }, "test", { type: "fixture" }, Date.now());
  }

  /** Called after the lobby moved to 'running' with initial state. */
  startRunning(res: ApplyResult): void {
    this.lobby.status = "running";
    this.state = res.state;
    this.startedAt = Date.now();
    spanEvent("game.started", {
      "game.id": spanGameId(this.lobby.gameId),
      "game.players": res.state.players.length,
      "game.bots": res.state.players.filter((p) => p.controller === "bot").length,
      "game.theme": res.state.settings.themeId,
      "game.securities": res.state.settings.securities,
    });
    this.persist(true);
    this.broadcastLobby();
    this.broadcastUpdate(res);
    this.schedule();
  }

  /** Every socket gets its own redacted view (auto-bid maximums are private); one serialisation per viewer. */
  private broadcastUpdate(res: ApplyResult): void {
    broadcastTimed("update", (tally) => {
      const byViewer = new Map<PlayerId | null, string>();
      for (const c of this.conns) {
        if (!c.gameId || c.ws.readyState !== 1) continue;
        let data = byViewer.get(c.playerId);
        if (data === undefined) {
          const msg: ServerMessage = {
            t: "update",
            state: redactState(res.state, c.playerId),
            events: res.events,
          };
          data = JSON.stringify(msg);
          byViewer.set(c.playerId, data);
        }
        c.ws.send(data);
        tally.add(data);
      }
    });
  }

  // ---------- scheduler ----------
  private nextBotMove(state: GameState): { playerId: PlayerId; action: GameAction } | null {
    if (this.botFailures >= MAX_BOT_FAILURES) return null;
    for (const pid of whoMustAct(state)) {
      const p = state.players.find((x) => x.id === pid);
      if (!p || p.bankrupt || p.controller === "human") continue;
      const a = chooseBotAction(state, pid);
      if (a) return { playerId: pid, action: a };
    }
    for (const p of state.players) {
      if (p.bankrupt || p.controller === "human") continue;
      if (!state.trades.some((t) => t.status === "pending" && t.to === p.id)) continue;
      const rs = chooseBotTradeResponses(state, p.id);
      const first = rs[0];
      if (first) return { playerId: p.id, action: first };
    }
    return null;
  }

  schedule(): void {
    if (this.closed) return;
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.botTimer = this.wakeTimer = null;
    const state = this.state;
    if (!state || state.status !== "running") return;
    // nobody to play with: the game waits (state is persisted); a returning human re-arms the timers
    if (!this.opts.runWithoutHumans && !this.humanConnected()) return;

    const plan = attemptSync("bot:planning", () => this.nextBotMove(state) !== null, logFailure);
    if (plan.ok && plan.value) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        this.enqueue(() => this.botStep()).catch((e: unknown) => {
          console.error("[bot] step failed", errMsg(e));
          logOperationFailed("bot:step", e);
        });
      }, this.opts.botDelayMs);
    }

    const now = Date.now();
    let wake: number | null = null;
    if (state.deadline !== null) {
      wake = state.deadline;
      if (wake <= now && this.stalledDeadline === wake) wake = now + 5000; // no progress last time; retry slowly
    }
    for (const t of state.trades) {
      // overdue trades (e.g. expired while the server was down) must fire immediately too
      if (t.status === "pending" && t.expiresAt !== null && (wake === null || t.expiresAt < wake))
        wake = t.expiresAt;
    }
    const voteExpiry = state.endVote?.expiresAt ?? null;
    if (voteExpiry !== null && (wake === null || voteExpiry < wake)) wake = voteExpiry;
    if (wake !== null) {
      this.wakeTimer = setTimeout(
        () => {
          this.wakeTimer = null;
          this.enqueue(() => this.wakeStep()).catch((e: unknown) => {
            console.error("[timer] wake failed", errMsg(e));
            logOperationFailed("timer:wake", e);
          });
        },
        Math.max(0, Math.min(wake - now, 2 ** 31 - 1)),
      );
    }
  }

  private botStep(): void {
    const state = this.state;
    if (this.closed || !state || state.status !== "running") return;
    if (!this.opts.runWithoutHumans && !this.humanConnected()) return;
    const now = Date.now();
    const planned: { move: ReturnType<GameRoom["nextBotMove"]> } = { move: null };
    const acted = attemptSync(
      "bot:action",
      () => {
        const decisionStart = epochNow();
        planned.move = this.nextBotMove(state);
        const decisionEnd = epochNow();
        if (!planned.move) return;
        const move = planned.move;
        const level = state.players.find((p) => p.id === move.playerId)?.botLevel;
        this.traced(
          "bot",
          move.playerId,
          move.action.type,
          () => {
            // the decision ran before the span could know whom it is for: recorded as its first child
            recordSpan(
              "bot.decide",
              decisionStart,
              decisionEnd,
              level ? { "bot.level": level } : {},
            );
            const r = applyBotAction(this.rig(state), move.playerId, move.action, now);
            this.botFailures = 0; // only consecutive failures pause the scheduler
            this.commit(r, move.playerId, move.action, now);
          },
          decisionStart,
        );
        botMoves.add(1);
      },
      (label, e) => {
        console.error(
          `[bot] action failed (${this.lobby.gameId}):`,
          e.message,
          planned.move?.action,
        );
        logOperationFailed(label, e, { "game.id": spanGameId(this.lobby.gameId) });
      },
    );
    if (acted.ok) return;
    this.botFailures++;
    if (this.botFailures === MAX_BOT_FAILURES)
      emitLog("warn", "bot moves paused after repeated failures", {
        "game.id": spanGameId(this.lobby.gameId),
      });
    const fallback = attemptSync(
      "bot:fallback",
      () => {
        const r = handleTimeout(state, now);
        if (r.state.version === state.version) return this.schedule();
        this.commit(r, planned.move?.playerId ?? "server", { type: "timeout" }, now);
      },
      logFailure,
    );
    if (!fallback.ok) this.schedule();
  }

  private wakeStep(): void {
    const state = this.state;
    if (this.closed || !state || state.status !== "running") return;
    if (!this.opts.runWithoutHumans && !this.humanConnected()) return;
    const now = Date.now();
    const handled = attemptSync(
      "timer:handleTimeout",
      () => {
        const r = handleTimeout(this.rig(state), now);
        if (r.state.version === state.version) {
          this.stalledDeadline = state.deadline;
          return this.schedule();
        }
        this.stalledDeadline = null;
        this.botFailures = 0;
        this.traced("server", "server", "timeout", () =>
          this.commit(r, "server", { type: "timeout" }, now),
        );
      },
      logFailure,
    );
    if (!handled.ok) {
      this.stalledDeadline = state.deadline;
      this.schedule();
    }
  }

  /** True when nothing would be lost by dropping this room from memory (state is persisted synchronously). */
  isIdle(now: number, maxIdleMs: number): boolean {
    return (
      !this.closed &&
      this.conns.size === 0 &&
      this.pending === 0 &&
      this.leases === 0 &&
      this.botTimer === null &&
      this.wakeTimer === null &&
      now - this.lastActive >= maxIdleMs
    );
  }

  /** Pin the room against the idle sweep; call the returned function exactly once when done. */
  lease(): () => void {
    this.leases++;
    this.lastActive = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases--;
      this.lastActive = Date.now();
    };
  }

  /** Stop timers and refuse new actions. Sockets stay open: the server closes them (1012) after persisting. */
  dispose(): void {
    this.closed = true;
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
  }

  /**
   * The retention sweep deletes this game: stop timers, refuse every further write and tell the sockets why
   * (the client shows "expired or does not exist"). Called before the rows are deleted.
   */
  expire(): void {
    this.expired = true;
    this.dispose();
    for (const c of [...this.conns])
      c.ws.close(WS_CLOSE_GAME_EXPIRED, WS_CLOSE_GAME_EXPIRED_REASON);
    this.conns.clear();
  }

  /** Wait for queued work (tests / shutdown). */
  async idle(): Promise<void> {
    // work enqueued while waiting (e.g. a follow-up of the item being awaited) counts, too
    let seen: Promise<void>;
    do {
      seen = this.queue;
      await seen;
    } while (seen !== this.queue);
  }
}

export type { Conn };

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface RetentionReport extends PurgeResult {
  expired: ExpiredGame[];
  vacuumed: boolean;
}

export class Hub {
  private rooms = new Map<string, GameRoom>();
  db: Db;
  opts: RoomOptions;
  private sweepTimer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  constructor(db: Db, opts: RoomOptions) {
    this.db = db;
    this.opts = opts;
    const idleMs = opts.idleMs ?? ROOM_IDLE_MS;
    this.sweepTimer = setInterval(() => this.sweep(idleMs), opts.sweepMs ?? SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Loaded rooms whose game is running (telemetry gauge). */
  runningCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) if (r.lobby.status === "running") n++;
    return n;
  }

  /** Unload rooms with no sockets, no queued work and no timers that have been idle for `idleMs`. */
  sweep(idleMs: number): number {
    const now = Date.now();
    let n = 0;
    for (const [id, r] of this.rooms) {
      if (r.isIdle(now, idleMs)) {
        r.dispose();
        this.rooms.delete(id);
        n++;
      }
    }
    return n;
  }

  /**
   * Data retention (docs/DESIGN.md #57), one synchronous pass: games without human activity for longer than the
   * limit of their status are unloaded (sockets closed with WS_CLOSE_GAME_EXPIRED) and deleted with their actions,
   * the action logs of all games are trimmed, and the file is VACUUMed when enough space came free.
   */
  runRetention(): RetentionReport {
    const cfg = this.opts.retention ?? DEFAULT_RETENTION;
    const now = (this.opts.clock ?? Date.now)();
    return timed(
      "retention.sweep",
      {},
      null,
      {},
      (span) => {
        const expired = this.db.expiredGames(expiryPolicy(cfg), now);
        for (const g of expired) {
          const room = this.rooms.get(g.id);
          if (!room) continue;
          room.expire();
          this.rooms.delete(g.id);
        }
        const purged = this.db.purge(
          expired.map((g) => g.id),
          cfg.actionLogKeep,
        );
        const changed = purged.games > 0 || purged.trimmedActions > 0;
        const vacuumed = changed && this.db.vacuumIfWorthIt();
        for (const g of expired) gamesExpired.add(1, { "game.status": g.status });
        if (purged.trimmedActions > 0) actionsTrimmed.add(purged.trimmedActions);
        span.setAttribute("retention.games.expired", purged.games);
        span.setAttribute("retention.actions.deleted", purged.expiredActions);
        span.setAttribute("retention.actions.trimmed", purged.trimmedActions);
        span.setAttribute("retention.vacuumed", vacuumed);
        emitLog("info", "retention sweep", {
          "retention.games.expired": purged.games,
          "retention.actions.deleted": purged.expiredActions,
          "retention.actions.trimmed": purged.trimmedActions,
          "retention.vacuumed": vacuumed,
        });
        return { expired, ...purged, vacuumed } satisfies RetentionReport;
      },
      { root: true },
    );
  }

  /** Sweep now (startup, before games resume) and then hourly; the timer does not keep the process alive. */
  startRetention(): void {
    if (this.retentionTimer) return;
    const sweep = (): void => {
      attemptSync("retention:sweep", () => this.runRetention(), logFailure);
    };
    sweep();
    this.retentionTimer = setInterval(
      sweep,
      this.opts.retentionIntervalMs ?? RETENTION_INTERVAL_MS,
    );
    this.retentionTimer.unref();
  }

  get(id: string): GameRoom | null {
    let r = this.rooms.get(id);
    if (r) {
      r.lastActive = Date.now();
      return r;
    }
    const row = this.db.load(id);
    if (!row) return null;
    r = new GameRoom(row.lobby, row.state, this.db, this.opts);
    this.rooms.set(id, r);
    return r;
  }

  /** Run `fn` with the room pinned: the idle sweep cannot dispose it until `fn` settles. */
  async withRoom<T>(id: string, fn: (room: GameRoom) => Promise<T>): Promise<{ value: T } | null> {
    const room = this.get(id);
    if (!room) return null;
    const release = room.lease();
    const value = await Promise.resolve()
      .then(() => fn(room))
      .finally(release);
    return { value };
  }

  add(lobby: StoredLobby): GameRoom {
    const r = new GameRoom(lobby, null, this.db, this.opts);
    this.rooms.set(lobby.gameId, r);
    r.persist(true);
    return r;
  }

  /**
   * Startup: running games are NOT loaded or scheduled. A game waits until a human connects (docs/DESIGN.md #60);
   * `hello` loads the room and re-arms its timers. Tests may keep the old behaviour (`runWithoutHumans`).
   * Returns how many running games are waiting.
   */
  resumeAll(): number {
    const ids = this.db.runningIds();
    if (this.opts.runWithoutHumans) {
      for (const id of ids) {
        attemptSync(`resume:${id}`, () => this.get(id)?.schedule(), logFailure);
      }
    }
    return ids.length;
  }

  private stopTimers(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  /**
   * The writer lease is lost (docs/DESIGN.md #89): stop every timer and refuse all work at once, persist
   * NOTHING (the database may belong to another process by now). Sockets stay; the server closes them.
   */
  abandon(): void {
    this.stopTimers();
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
  }

  async shutdown(): Promise<void> {
    this.stopTimers();
    for (const r of this.rooms.values()) r.dispose();
    await Promise.all([...this.rooms.values()].map((r) => r.idle()));
    for (const r of this.rooms.values()) r.persist();
    this.rooms.clear();
  }
}
