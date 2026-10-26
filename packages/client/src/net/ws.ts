import {
  WS_CLOSE_TOKEN_ROTATED,
  attempt,
  attemptSync,
  type ClientMessage,
  type GameAction,
  type QuickChatId,
  type ServerMessage,
} from "@poly/engine";
import { api } from "./api.ts";
import { app, clearToken, getToken, saveToken, set, toast } from "./store.ts";
import { director } from "../game/director.ts";
import { serverMessageText } from "../i18n/engine.ts";
import { t } from "../i18n/index.ts";
import { isGameGoneClose, isGameNotFoundMessage } from "./gone.ts";
import { BUILD_ID } from "./build.ts";
import { closeKind, decideReload, reconnectDelay, whenIdle, type CloseKind } from "./update.ts";

let sock: WebSocket | null = null;
let currentGame: string | null = null;
let retry = 0;
let retryTimer: number | undefined;
let pingTimer: number | undefined;
let closedByUs = false;
/** a deploy restarts the server: reconnect fast until it is back (reset on the next successful open) */
let reconnectKind: CloseKind = "normal";
let reloadPending = false;
/** this device is renewing its own token: the server closes its socket on purpose, we reconnect when done */
let rotating = false;

function url(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

const PING_INTERVAL_MS = 25_000;
/** how long a reload for a new build may wait for the running animations to finish */
const RELOAD_MAX_WAIT_MS = 5000;
const RELOAD_POLL_MS = 200;
/** after this many fast retries a restart is no longer treated as a short deploy pause */
const FAST_RETRY_ATTEMPTS = 30;
/** sessionStorage: the build id this tab already reloaded for (loop guard) */
const RELOAD_MARKER_KEY = "poly:reloadedFor";

/** how long an action may stay unanswered (the server sends `update` or `error` for every action) */
export const PENDING_TIMEOUT_MS = 10_000;
let pendingTimer: number | undefined;

/** true when the message went out; false when there is no open socket (nothing is queued or retried) */
function send(msg: ClientMessage): boolean {
  if (sock && sock.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

/** the server answered (or the connection is gone): the action bar may accept input again */
function clearPending(): void {
  window.clearTimeout(pendingTimer);
  if (app.pending !== null) {
    set({ pending: null });
  }
}

/** minimal envelope check; payload shapes are trusted (server is authoritative) */
function isServerMessage(v: unknown): v is ServerMessage {
  return typeof v === "object" && v !== null && typeof (v as { t?: unknown }).t === "string";
}

function open(): void {
  if (!currentGame) return;
  const gameId = currentGame;
  const ws = new WebSocket(url());
  sock = ws;
  ws.onopen = () => {
    if (sock !== ws) {
      ws.close();
      return;
    }
    retry = 0;
    reconnectKind = "normal";
    set({ connected: true });
    send({ t: "hello", gameId, playerToken: getToken(gameId) });
    window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => send({ t: "ping" }), PING_INTERVAL_MS);
  };
  ws.onmessage = (ev) => {
    if (sock !== ws) {
      return;
    }
    const parsed = attemptSync<unknown>("ws:parse", () => JSON.parse(String(ev.data)));
    if (parsed.ok && isServerMessage(parsed.value)) {
      handle(parsed.value);
    }
  };
  ws.onclose = (ev) => {
    // a superseded socket (disconnect()/reconnect to another game) must not touch shared state
    if (sock !== ws) {
      return;
    }
    window.clearInterval(pingTimer);
    sock = null;
    window.clearTimeout(pendingTimer);
    // an action in flight may or may not have been applied: the next welcome shows the truth, nothing is resent
    set({ connected: false, pending: null });
    // the retention sweep deleted this game: no reconnecting, the token is useless now
    if (isGameGoneClose(ev.code)) {
      clearToken(gameId);
      set({ gameGone: true });
      return;
    }
    // our own token renewal closes this socket on purpose: rotateSeatToken() reconnects with the new token
    const rotatedByUs = rotating && ev.code === WS_CLOSE_TOKEN_ROTATED;
    if (!closedByUs && !rotatedByUs && currentGame === gameId) {
      // a deploy (1012) or a writer-lease handover (4503): the next server is there within seconds, retry fast
      const kind = closeKind(ev.code);
      if (kind !== "normal" && reconnectKind !== kind) {
        reconnectKind = kind;
        retry = 0;
        toast(t(kind === "restart" ? "net.updating" : "net.handover"), "info", undefined, 8000);
      }
      const pace = retry < FAST_RETRY_ATTEMPTS ? reconnectKind : "normal";
      retryTimer = window.setTimeout(open, reconnectDelay(pace, retry++));
    }
  };
  ws.onerror = () => {
    /* onclose follows */
  };
}

function reloadedFor(): string | null {
  const r = attemptSync("session:read", () => sessionStorage.getItem(RELOAD_MARKER_KEY));
  return r.ok ? r.value : null;
}

/** The server runs another build than this page: reload once the animations are idle (docs/DESIGN.md #44). */
function checkBuild(serverBuild: string): void {
  const decision = decideReload({ server: serverBuild, own: BUILD_ID, reloadedFor: reloadedFor() });
  if (decision === "none") return;
  if (decision === "warn") {
    console.warn(
      `[ws] server build ${serverBuild} differs from page build ${BUILD_ID}; already reloaded once`,
    );
    return;
  }
  if (reloadPending) return;
  reloadPending = true;
  toast(t("net.newVersion"), "info", undefined, RELOAD_MAX_WAIT_MS + 1000);
  void whenIdle(() => !app.busy && app.backlog === 0, RELOAD_MAX_WAIT_MS, RELOAD_POLL_MS).then(
    () => {
      const marked = attemptSync("session:write", () =>
        sessionStorage.setItem(RELOAD_MARKER_KEY, serverBuild),
      );
      // without the marker a stale page could reload forever
      if (marked.ok) location.reload();
      else console.warn("[ws] sessionStorage unavailable, not reloading for the new build");
    },
  );
}

function handle(msg: ServerMessage): void {
  switch (msg.t) {
    case "welcome": {
      // a stored token that no longer maps to a seat (renewed link, removed seat) is dropped so that the
      // invite link works again and the UI can say so
      const gameId = msg.lobby.gameId;
      const rejected = msg.you === null && getToken(gameId) !== null;
      if (rejected) {
        clearToken(gameId);
      }
      // the server replays the chat history after the welcome: start from empty, a reconnect must not duplicate lines
      clearPending();
      set({
        you: msg.you,
        lobby: msg.lobby,
        seatRejected: rejected,
        chat: [],
        chatSeq: 0,
        chatReadSeq: 0,
        chatRefused: null,
      });
      if (msg.state) director.hardSync(msg.state);
      else set({ state: null });
      checkBuild(msg.build);
      break;
    }
    case "lobby":
      // the server deletes the history when the host switches chat off: so does the page
      set({
        lobby: msg.lobby,
        ...(msg.lobby.chat.mode === "off"
          ? { chat: [], chatSeq: 0, chatReadSeq: 0, chatRefused: null }
          : {}),
      });
      break;
    case "update":
      clearPending();
      director.enqueue(msg.state, msg.events);
      break;
    case "chat":
      set({
        chatSeq: app.chatSeq + 1,
        chat: [
          ...app.chat.slice(-199),
          { from: msg.from, name: msg.name, text: msg.text, at: msg.at },
        ],
      });
      break;
    case "quick-chat":
      set({
        chatSeq: app.chatSeq + 1,
        chat: [
          ...app.chat.slice(-199),
          { from: msg.from, name: msg.name, quick: msg.id, at: msg.at },
        ],
      });
      break;
    case "chat-rejected":
      set({ chatRefused: msg.reason });
      break;
    case "presence":
      set({ presence: msg.connected });
      break;
    case "error":
      {
        // the server sends the German text: shown translated when it is a known message, as received otherwise
        // a link to a game that does not exist (any more) leads nowhere: say so (GameGone) instead of waiting forever
        if (isGameNotFoundMessage(msg.message) && app.lobby === null && currentGame) {
          clearToken(currentGame);
          set({ gameGone: true });
          break;
        }
        const text = serverMessageText(msg.message);
        window.clearTimeout(pendingTimer);
        set({ lastError: text, actionError: text, pending: null });
        toast(text, "bad");
      }
      break;
    case "pong":
      break;
    default: {
      const unhandled: never = msg;
      console.warn("[ws] unbekannte Nachricht", unhandled);
    }
  }
}

export function connect(gameId: string): void {
  disconnect();
  closedByUs = false;
  currentGame = gameId;
  retry = 0;
  reconnectKind = "normal";
  open();
}

export function disconnect(): void {
  closedByUs = true;
  currentGame = null;
  window.clearTimeout(retryTimer);
  window.clearInterval(pingTimer);
  const old = sock;
  sock = null;
  old?.close();
  window.clearTimeout(pendingTimer);
  set({ connected: false, pending: null });
}

/**
 * Sends a game action. Without an open socket nothing is queued (a stale action must never be applied after a
 * reconnect, when the table may have moved on): the refusal is visible (`actionError`) and `false` is returned so
 * that drafts stay in place. Otherwise `pending` marks the action until the server's `update`/`error` arrives.
 */
export function sendAction(action: GameAction): boolean {
  if (!send({ t: "action", action })) {
    const text = t("net.offlineAction");
    set({ actionError: text });
    toast(text, "bad");
    return false;
  }
  set({ pending: action.type, actionError: null });
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    if (app.pending !== null) {
      const text = t("net.noAnswer");
      set({ pending: null, actionError: text });
      toast(text, "bad");
    }
  }, PENDING_TIMEOUT_MS);
  return true;
}
/** false: offline, the text stays in the input */
export function sendChat(text: string): boolean {
  set({ chatRefused: null });
  return send({ t: "chat", text });
}
export function sendQuickChat(id: QuickChatId): boolean {
  set({ chatRefused: null });
  return send({ t: "quick-chat", id });
}

/**
 * Rotate the token of my seat (see POST /seats/me/token): the server drops every socket of the seat
 * (including ours), we keep the new token and reconnect with it.
 */
export async function rotateSeatToken(gameId: string): Promise<void> {
  rotating = true;
  const done = await attempt("ws:rotate-token", async () =>
    saveToken(gameId, await api.rotateToken(gameId)),
  );
  rotating = false;
  if (currentGame === gameId && (done.ok || sock === null)) {
    connect(gameId);
  }
  if (!done.ok) {
    throw done.error;
  }
}
