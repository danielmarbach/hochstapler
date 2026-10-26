import type {
  BotLevel,
  ChatUpdateRequest,
  CreateGameRequest,
  GameSettings,
  JoinGameRequest,
  JoinResponse,
  LobbyInfo,
} from "@poly/engine";
import { POW_HEADER, RotateTokenResponseSchema, attempt, attemptSync } from "@poly/engine";
import { UiError } from "../i18n/index.ts";
import { getToken } from "./store.ts";

/** German message of an error response (shown translated, see serverMessageText), null when it has none */
function errorMessage(data: unknown): string | null {
  if (typeof data === "object" && data !== null) {
    const { error, message } = data as { error?: unknown; message?: unknown };
    if (typeof error === "string") {
      return error;
    }
    if (typeof message === "string") {
      return message;
    }
  }
  return null;
}

/** How long a request keeps being repeated while no server instance holds the database (handover). */
const STANDBY_RETRY_MS = 30_000;

function standbyAnswer(status: number, data: unknown): boolean {
  return (
    status === 503 &&
    typeof data === "object" &&
    data !== null &&
    (data as { standby?: unknown }).standby === true
  );
}

/**
 * The server is trusted: a successful response body is typed as T without further validation. A 503 with
 * `standby: true` means this instance has no database right now (writer-lease handover) and applied nothing: the same
 * request is repeated after 0.5-1.5 s until an instance serves it, for up to half a minute.
 */
async function call<T>(
  method: string,
  url: string,
  body?: unknown,
  token?: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const giveUpAt = Date.now() + STANDBY_RETRY_MS;
  for (;;) {
    const r = await callOnce<T>(method, url, body, token, extraHeaders);
    if (r.ok) {
      return r.value;
    }
    if (!r.standby || Date.now() >= giveUpAt) {
      throw r.error;
    }
    await new Promise((ok) => setTimeout(ok, 500 + Math.random() * 1000));
  }
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error; standby: boolean };

async function callOnce<T>(
  method: string,
  url: string,
  body?: unknown,
  token?: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<Attempt<T>> {
  const sent = await attempt("api:fetch", () =>
    fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { "x-player-token": token } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  if (!sent.ok) {
    return { ok: false, error: new UiError("net.unreachable"), standby: false };
  }
  const res = sent.value;
  const text = await res.text();
  // a non-JSON body is treated like an empty one
  const parsed = attemptSync<unknown>("api:parse", () => (text ? JSON.parse(text) : null));
  const data: unknown = parsed.ok ? parsed.value : null;
  if (!res.ok) {
    const message = errorMessage(data);
    const error =
      message === null ? new UiError("net.status", { status: res.status }) : new Error(message);
    return { ok: false, error, standby: standbyAnswer(res.status, data) };
  }
  if (data === null) {
    return { ok: false, error: new UiError("net.invalidResponse"), standby: false };
  }
  return { ok: true, value: data as T };
}

export const api = {
  /** `powHeader`: the solved proof of work (net/pow.ts, docs/DESIGN.md #70) */
  createGame: (req: CreateGameRequest, powHeader: string) =>
    call<JoinResponse>("POST", "/api/games", req, null, { [POW_HEADER]: powHeader }),
  getLobby: (id: string) => call<LobbyInfo>("GET", `/api/games/${id}`),
  join: (id: string, req: JoinGameRequest) =>
    call<JoinResponse>("POST", `/api/games/${id}/join`, req),
  addBot: (id: string, botLevel: BotLevel) =>
    call<LobbyInfo>("POST", `/api/games/${id}/bots`, { botLevel }, getToken(id)),
  removeSeat: (id: string, playerId: string) =>
    call<LobbyInfo>("DELETE", `/api/games/${id}/seats/${playerId}`, undefined, getToken(id)),
  /** own seat, lobby only: choose the game piece (docs/DESIGN.md #75); 409 when somebody else holds it */
  pickToken: (id: string, tokenId: string) =>
    call<LobbyInfo>("PATCH", `/api/games/${id}/seats/me`, { tokenId }, getToken(id)),
  patchSettings: (id: string, s: Partial<GameSettings>) =>
    call<LobbyInfo>("PATCH", `/api/games/${id}/settings`, s, getToken(id)),
  /** host only: chat mode and muting (docs/DESIGN.md #69) */
  patchChat: (id: string, update: ChatUpdateRequest) =>
    call<LobbyInfo>("PATCH", `/api/games/${id}/chat`, update, getToken(id)),
  start: (id: string) => call<LobbyInfo>("POST", `/api/games/${id}/start`, {}, getToken(id)),
  /** new personal token for my seat; the old one stops working (validated: it ends up in localStorage and links) */
  rotateToken: async (id: string): Promise<string> => {
    const raw = await call<unknown>("POST", `/api/games/${id}/seats/me/token`, {}, getToken(id));
    const parsed = RotateTokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UiError("net.invalidResponse");
    }
    return parsed.data.playerToken;
  },
  themes: () => call<{ id: string; name: string; flag: string }[]>("GET", "/api/themes"),
};
