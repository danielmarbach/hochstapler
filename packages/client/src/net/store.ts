import { attemptSync } from "@poly/engine";
import { useEffect, useRef, useState } from "preact/hooks";
import { IS_TOUCH, LITE_RENDER } from "../platform.ts";
import type {
  ChatRejectReason,
  GameAction,
  LobbyInfo,
  PlayerId,
  PublicGameState,
  QuickChatId,
  TradeOffer,
} from "@poly/engine";

/** one chat line: typed text, or a predefined quick message (`quick`, translated by the client) */
export interface ChatMsg {
  from: PlayerId;
  name: string;
  text?: string;
  quick?: QuickChatId;
  at: number;
}
export interface Toast {
  id: number;
  text: string;
  kind: "info" | "good" | "bad" | "warn";
  color?: string;
}
export interface CardPopup {
  playerId: PlayerId;
  deck: "chance" | "community";
  cardId: string;
}

export interface AppState {
  gameId: string | null;
  you: PlayerId | null;
  lobby: LobbyInfo | null;
  /** state as currently shown (lags behind the server while animations run) */
  state: PublicGameState | null;
  connected: boolean;
  presence: PlayerId[];
  chat: ChatMsg[];
  /** chat messages received on this connection / how many of them the player has seen (unread = difference) */
  chatSeq: number;
  chatReadSeq: number;
  /** why the server did not publish the last message I typed (cleared when I type again) */
  chatRefused: ChatRejectReason | null;
  toasts: Toast[];
  cardPopup: CardPopup | null;
  busy: boolean;
  /** type of the action sent to the server whose answer (`update` or `error`) is still outstanding */
  pending: GameAction["type"] | null;
  /** why the last action did not go through (server refusal, no answer, offline); cleared by the next send */
  actionError: string | null;
  backlog: number;
  selectedTile: number | null;
  drawerOpen: boolean;
  /** tab of the desktop drawer (the securities tab exists only in securities games) */
  drawerTab: "props" | "securities" | "board";
  tradeOpen: boolean;
  tradeDraft: TradeDraft | null;
  /** confirmation dialog of "end game…" */
  endGameDialog: boolean;
  logOpen: boolean;
  followCam: boolean;
  bloom: boolean;
  lastError: string | null;
  /** a stored seat token was refused by the server (renewed link, seat gone): the token has been dropped */
  seatRejected: boolean;
  /** the game was deleted (inactivity) or never existed: the token has been dropped */
  gameGone: boolean;
}

/** prefilled trade form; `counterOf` = the incoming offer it answers with a counteroffer */
export type TradeDraft = Partial<TradeOffer> & { counterOf?: string };

export const initialState: AppState = {
  gameId: null,
  you: null,
  lobby: null,
  state: null,
  connected: false,
  presence: [],
  chat: [],
  chatSeq: 0,
  chatReadSeq: 0,
  chatRefused: null,
  toasts: [],
  cardPopup: null,
  busy: false,
  pending: null,
  actionError: null,
  backlog: 0,
  selectedTile: null,
  drawerOpen: false,
  drawerTab: "props",
  tradeOpen: false,
  tradeDraft: null,
  endGameDialog: false,
  logOpen: false,
  followCam: true,
  bloom: !IS_TOUCH && !LITE_RENDER,
  lastError: null,
  seatRejected: false,
  gameGone: false,
};

export let app: AppState = { ...initialState };
const listeners = new Set<() => void>();

export function set(patch: Partial<AppState>): void {
  app = { ...app, ...patch };
  for (const l of [...listeners]) l();
}

export function resetGame(gameId: string | null): void {
  set({ ...initialState, gameId, followCam: app.followCam, bloom: app.bloom });
}

export function useApp<T>(sel: (s: AppState) => T): T {
  const [v, setV] = useState<T>(() => sel(app));
  const selRef = useRef(sel);
  selRef.current = sel; // always use the latest selector (it may close over props)
  useEffect(() => {
    const l = () => {
      const n = selRef.current(app);
      setV((prev) => (Object.is(prev, n) ? prev : n));
    };
    l();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}

let toastId = 1;
export function toast(
  text: string,
  kind: Toast["kind"] = "info",
  color?: string,
  ttl = 4200,
): void {
  const id = toastId++;
  set({ toasts: [...app.toasts.slice(-5), { id, text, kind, color }] });
  setTimeout(() => set({ toasts: app.toasts.filter((t) => t.id !== id) }), ttl);
}

// ---- persistence of tokens ----
export const tokenKey = (gameId: string) => `poly:token:${gameId}`;
export const inviteKey = (gameId: string) => `poly:invite:${gameId}`;
function readStorage(key: string): string | null {
  const r = attemptSync("storage:read", () => localStorage.getItem(key));
  return r.ok ? r.value : null;
}
export const getToken = (gameId: string): string | null => readStorage(tokenKey(gameId));
export const getInvite = (gameId: string): string | null => readStorage(inviteKey(gameId));
export function saveToken(gameId: string, token: string): void {
  attemptSync("storage:write", () => localStorage.setItem(tokenKey(gameId), token));
}
export function clearToken(gameId: string): void {
  attemptSync("storage:remove", () => localStorage.removeItem(tokenKey(gameId)));
}
export function saveJoin(gameId: string, token: string, invite: string): void {
  // storage unavailable (private mode): the session works until reload
  attemptSync("storage:write", () => {
    localStorage.setItem(tokenKey(gameId), token);
    localStorage.setItem(inviteKey(gameId), invite);
  });
}

export type ActionSender = (a: GameAction) => void;
