// Rematch from the results screen: the API call (the seat token of the finished game, never in the URL) and the
// local link from the finished game to the rematch the player already sits in (so "back" does not ask twice).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POW_HEADER } from "@poly/engine";
import { api } from "../src/net/api.ts";
import { enterRematch } from "../src/net/rematch.ts";
import type { PowTicket } from "../src/net/pow.ts";
import { getRematch, saveJoin, saveRematch, saveToken } from "../src/net/store.ts";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("rematch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", fakeStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the finished game with the seat token in the header and no wish by default", async () => {
    saveToken("old1", "secret-token");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ gameId: "new1" }), { status: 201 }));
    await expect(api.rematch("old1")).resolves.toEqual({ gameId: "new1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/games/old1/rematch");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers).toMatchObject({ "x-player-token": "secret-token" });
    expect(url).not.toContain("secret-token");
  });

  it("shows the server's refusal", async () => {
    saveToken("old1", "t");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Das Spiel ist voll." }), { status: 409 }),
    );
    await expect(api.rematch("old1")).rejects.toThrow("Das Spiel ist voll.");
  });

  it("remembers the rematch a player sits in, as long as the seat token of it exists", () => {
    expect(getRematch("old1")).toBeNull();
    saveRematch("old1", "new1");
    expect(getRematch("old1")).toBeNull();
    saveJoin("new1", "token", "CODE");
    expect(getRematch("old1")).toBe("new1");
    expect(getRematch("other")).toBeNull();
  });

  describe("entering the rematch (the call that opens the lobby carries a proof of work)", () => {
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });
    const ticketOf = (header: string): PowTicket => ({
      header: Promise.resolve(header),
      cancel: vi.fn(),
    });
    const headersOfCall = (n: number): Record<string, string> => {
      const init = fetchMock.mock.calls[n]?.[1] as RequestInit | undefined;
      return (init?.headers ?? {}) as Record<string, string>;
    };

    beforeEach(() => saveToken("old1", "secret-token"));

    it("sends the solved proof when no rematch lobby is open yet", async () => {
      fetchMock.mockResolvedValue(answer(201, { gameId: "new1" }));
      const start = vi.fn(() => ticketOf("solved-1"));
      await expect(enterRematch("old1", false, start)).resolves.toEqual({ gameId: "new1" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(headersOfCall(0)).toMatchObject({ [POW_HEADER]: "solved-1" });
    });

    it("joins an open lobby without any proof of work", async () => {
      fetchMock.mockResolvedValue(answer(201, { gameId: "new1" }));
      const start = vi.fn(() => ticketOf("never-needed"));
      await expect(enterRematch("old1", true, start)).resolves.toEqual({ gameId: "new1" });
      expect(start).not.toHaveBeenCalled();
      expect(headersOfCall(0)).not.toHaveProperty(POW_HEADER);
    });

    it("solves one after all when the lobby it wanted to join is gone", async () => {
      fetchMock
        .mockResolvedValueOnce(
          answer(403, { error: "Die Sicherheitsprüfung fehlt. Bitte nochmal versuchen." }),
        )
        .mockResolvedValueOnce(answer(201, { gameId: "new2" }));
      const start = vi.fn(() => ticketOf("solved-2"));
      await expect(enterRematch("old1", true, start)).resolves.toEqual({ gameId: "new2" });
      expect(headersOfCall(0)).not.toHaveProperty(POW_HEADER);
      expect(headersOfCall(1)).toMatchObject({ [POW_HEADER]: "solved-2" });
    });

    it("retries once with a fresh challenge when the solution was refused, then gives up", async () => {
      const refusal = answer(403, {
        error: "Die Sicherheitsprüfung ist abgelaufen. Bitte nochmal versuchen.",
      });
      fetchMock.mockImplementation(() => Promise.resolve(refusal.clone()));
      const tickets = [ticketOf("old"), ticketOf("fresh")];
      const start = vi.fn(() => tickets.shift() ?? ticketOf("unexpected"));
      await expect(enterRematch("old1", false, start)).rejects.toThrow("abgelaufen");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(headersOfCall(1)).toMatchObject({ [POW_HEADER]: "fresh" });
    });

    it("passes every other refusal on untouched", async () => {
      fetchMock.mockResolvedValue(answer(409, { error: "Das Spiel ist voll." }));
      await expect(enterRematch("old1", true, () => ticketOf("x"))).rejects.toThrow(
        "Das Spiel ist voll.",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
