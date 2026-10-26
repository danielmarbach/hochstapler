// REST access to the server under test. Used only to *set up* scenarios ("Angenommen"): creating games quickly and
// the test-mode fixtures. Everything a scenario verifies or does as a player goes through the browser UI.
import { POW_HEADER, PowChallengeResponseSchema, encodePowPayload, solvePow } from "@poly/engine";
import type { BotLevel, GameSettings, JoinResponse } from "@poly/engine";
import type { StatePatch } from "../../packages/server/src/test-mode.ts";

export interface Seat {
  gameId: string;
  playerId: string;
  token: string;
  inviteCode: string;
}

export class Api {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Game creation needs a solved proof of work (docs/DESIGN.md #70). The server runs in test mode, whose challenges are
   * cheap, but the challenge is never skipped: this is the same exchange the browser does.
   */
  private async powHeaders(): Promise<Record<string, string>> {
    const res = await fetch(`${this.baseUrl}/api/pow/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create-game" }),
    });
    const { challenge } = PowChallengeResponseSchema.parse(await res.json());
    const solution = await solvePow(challenge);
    return { [POW_HEADER]: encodePowPayload({ challenge, solution }) };
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-player-token": token } : {}),
        ...(method === "POST" && path === "/api/games" ? await this.powHeaders() : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  }

  async createGame(o: {
    host: string;
    settings: Partial<GameSettings>;
    bots?: BotLevel[];
    maxPlayers: number;
  }): Promise<Seat> {
    const r = (await this.call("POST", "/api/games", {
      hostName: o.host,
      settings: o.settings,
      bots: o.bots ?? [],
      maxPlayers: o.maxPlayers,
    })) as JoinResponse;
    return {
      gameId: r.gameId,
      playerId: r.playerId,
      token: r.playerToken,
      inviteCode: r.inviteCode,
    };
  }

  async join(host: Seat, name: string, tokenId?: string): Promise<Seat> {
    const r = (await this.call("POST", `/api/games/${host.gameId}/join`, {
      name,
      inviteCode: host.inviteCode,
      ...(tokenId === undefined ? {} : { tokenId }),
    })) as JoinResponse;
    return {
      gameId: r.gameId,
      playerId: r.playerId,
      token: r.playerToken,
      inviteCode: r.inviteCode,
    };
  }

  /** own seat, lobby only: choose the game piece (docs/DESIGN.md #75) */
  async pickToken(seat: Seat, tokenId: string): Promise<void> {
    await this.call("PATCH", `/api/games/${seat.gameId}/seats/me`, { tokenId }, seat.token);
  }

  /** host only: chat mode / mute (docs/DESIGN.md #69) */
  async patchChat(
    host: Seat,
    update: { mode?: "free" | "quick" | "off"; mute?: { playerId: string; muted: boolean } },
  ): Promise<void> {
    await this.call("PATCH", `/api/games/${host.gameId}/chat`, update, host.token);
  }

  async start(host: Seat): Promise<void> {
    await this.call("POST", `/api/games/${host.gameId}/start`, {}, host.token);
  }

  /** test mode: queue dice results (consumed by the next rolls, bots included) */
  async queueDice(gameId: string, sequence: [number, number][]): Promise<void> {
    await this.call("POST", `/api/test/games/${gameId}/dice`, { sequence });
  }

  /** test mode: load/patch a fixture state */
  async patchState(gameId: string, patch: StatePatch): Promise<void> {
    await this.call("POST", `/api/test/games/${gameId}/state`, patch);
  }

  /** test mode: make the game look abandoned for a year and run the retention sweep (the game is deleted) */
  async expire(gameId: string): Promise<void> {
    await this.call("POST", `/api/test/games/${gameId}/expire`, {});
  }
}
