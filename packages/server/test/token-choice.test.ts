// Players choose their own game piece (docs/DESIGN.md #75): PATCH /api/games/:id/seats/me, create and join with tokenId.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JoinResponse, LobbyInfo } from "@poly/engine";
import { THEMES } from "@poly/engine";
import { TestClient, createGame, joinGame, startGame, startTestServer } from "./harness.ts";
import type { Seat, TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer({
    limits: { createBurst: 1000, createPerHour: 1000, joinBurst: 1000, joinPerHour: 1000 },
  });
});
afterAll(async () => {
  await ts.dispose();
});

const tokenIds = (themeId: string): string[] =>
  (THEMES[themeId]?.tokens ?? []).map((tok) => tok.id);
const CH = tokenIds("ch");
const first = (ids: string[], i: number): string => {
  const id = ids[i];
  if (id === undefined) throw new Error("test theme has too few tokens");
  return id;
};
const lobbyOf = async (gameId: string): Promise<LobbyInfo> =>
  (await ts.api<LobbyInfo>("GET", `/api/games/${gameId}`)).json;
const tokenOf = async (seat: Seat): Promise<string | undefined> =>
  (await lobbyOf(seat.gameId)).seats.find((s) => s.playerId === seat.playerId)?.tokenId;
const pick = (seat: Pick<Seat, "gameId">, tokenId: unknown, auth?: string) =>
  ts.api<LobbyInfo>("PATCH", `/api/games/${seat.gameId}/seats/me`, { tokenId }, auth);

describe("choosing a game piece (PATCH /api/games/:id/seats/me)", () => {
  it("changes the own piece and tells the lobby", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const watcher = await TestClient.join(ts, host);
    const wanted = first(CH, 5);
    const r = await pick(host, wanted, host.token);
    expect(r.status).toBe(200);
    expect(r.json.seats.find((s) => s.playerId === host.playerId)?.tokenId).toBe(wanted);
    expect(await tokenOf(host)).toBe(wanted);
    const msg = await watcher.until((m) => m.t === "lobby" && m.lobby.seats[0]?.tokenId === wanted);
    expect(msg.t).toBe("lobby");
    await watcher.close();
  });

  it("is idempotent for the piece already held", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const own = await tokenOf(host);
    expect((await pick(host, own, host.token)).status).toBe(200);
    expect(await tokenOf(host)).toBe(own);
  });

  it("lets a joined guest choose, never touching the seat of somebody else", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const guest = await joinGame(ts, host, "Ben");
    const hostPiece = await tokenOf(host);
    const wanted = first(CH, 7);
    expect((await pick(guest, wanted, guest.token)).status).toBe(200);
    expect(await tokenOf(guest)).toBe(wanted);
    expect(await tokenOf(host)).toBe(hostPiece);
  });

  it("answers 409 when another seat (human or bot) holds the piece, and changes nothing", async () => {
    const host = await createGame(ts, { host: "Anna", bots: ["easy"], maxPlayers: 3 });
    const guest = await joinGame(ts, host, "Ben");
    const hostPiece = await tokenOf(host);
    const bot = (await lobbyOf(host.gameId)).seats.find((s) => s.kind === "bot");
    expect(hostPiece).toBeDefined();
    const mine = await tokenOf(guest);
    expect((await pick(guest, hostPiece, guest.token)).status).toBe(409);
    expect((await pick(guest, bot?.tokenId, guest.token)).status).toBe(409);
    expect(await tokenOf(guest)).toBe(mine);
  });

  it("gives exactly one winner when two seats race for the same piece", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const guest = await joinGame(ts, host, "Ben");
    const wanted = first(CH, 6);
    const results = await Promise.all([
      pick(host, wanted, host.token),
      pick(guest, wanted, guest.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const seats = (await lobbyOf(host.gameId)).seats;
    expect(seats.filter((s) => s.tokenId === wanted)).toHaveLength(1);
    expect(new Set(seats.map((s) => s.tokenId)).size).toBe(seats.length);
  });

  it("answers 400 for a piece that does not exist in the theme, 400 for bad bodies", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const before = await tokenOf(host);
    expect((await pick(host, "pretzel", host.token)).status).toBe(400); // a German piece in a Swiss game
    expect((await pick(host, "nope", host.token)).status).toBe(400);
    expect((await pick(host, 7, host.token)).status).toBe(400);
    expect((await pick(host, undefined, host.token)).status).toBe(400);
    expect((await pick(host, "x".repeat(100), host.token)).status).toBe(400);
    expect(await tokenOf(host)).toBe(before);
  });

  it("rejects extra body fields", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const r = await ts.api(
      "PATCH",
      `/api/games/${host.gameId}/seats/me`,
      { tokenId: first(CH, 3), playerId: "p2" },
      host.token,
    );
    expect(r.status).toBe(400);
  });

  it("requires the token of a seat of this game", async () => {
    const host = await createGame(ts, { host: "Anna" });
    const other = await createGame(ts, { host: "Zoe" });
    const before = await tokenOf(host);
    expect((await pick(host, first(CH, 4))).status).toBe(403);
    expect((await pick(host, first(CH, 4), "garbage")).status).toBe(403);
    expect((await pick(host, first(CH, 4), other.token)).status).toBe(403);
    expect(await tokenOf(host)).toBe(before);
  });

  it("allows only PATCH on the route (405 otherwise), 404 for an unknown game", async () => {
    const host = await createGame(ts, { host: "Anna" });
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const r = await ts.api(method, `/api/games/${host.gameId}/seats/me`, undefined, host.token);
      expect(r.status).toBe(405);
    }
    expect((await pick({ gameId: "zzzzzzzz" }, first(CH, 1), host.token)).status).toBe(404);
  });

  it("answers 409 once the game has started, and the piece stays", async () => {
    const host = await createGame(ts, { host: "Anna" });
    await joinGame(ts, host, "Ben");
    await startGame(ts, host);
    const before = await tokenOf(host);
    const free = CH.find((id) => id !== before);
    expect((await pick(host, free, host.token)).status).toBe(409);
    expect(await tokenOf(host)).toBe(before);
  });
});

describe("piece at create and join", () => {
  const create = (body: Record<string, unknown>) =>
    ts.api<JoinResponse>("POST", "/api/games", {
      hostName: "Anna",
      settings: { turnTimeoutSec: 0 },
      bots: ["easy", "easy"],
      maxPlayers: 4,
      ...body,
    });

  it("the host gets the chosen piece, the bots take what is left", async () => {
    const wanted = first(CH, 2);
    const r = await create({ tokenId: wanted });
    expect(r.status).toBe(201);
    const seats = (await lobbyOf(r.json.gameId)).seats;
    expect(seats[0]?.tokenId).toBe(wanted);
    expect(new Set(seats.map((s) => s.tokenId)).size).toBe(3);
  });

  it("the host's piece is checked against the chosen theme", async () => {
    expect((await create({ tokenId: "pretzel" })).status).toBe(400);
    const de = await create({ tokenId: "pretzel", settings: { turnTimeoutSec: 0, themeId: "de" } });
    expect(de.status).toBe(201);
    expect((await lobbyOf(de.json.gameId)).seats[0]?.tokenId).toBe("pretzel");
  });

  it("join with a free piece gets it", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const wanted = first(CH, 5);
    const r = await ts.api<JoinResponse>("POST", `/api/games/${host.gameId}/join`, {
      name: "Ben",
      inviteCode: host.inviteCode,
      tokenId: wanted,
    });
    expect(r.status).toBe(201);
    const seat = (await lobbyOf(host.gameId)).seats.find((s) => s.playerId === r.json.playerId);
    expect(seat?.tokenId).toBe(wanted);
  });

  it("join with a taken piece falls back to a free one (the lobby shows the result)", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const hostPiece = await tokenOf(host);
    const r = await ts.api<JoinResponse>("POST", `/api/games/${host.gameId}/join`, {
      name: "Ben",
      inviteCode: host.inviteCode,
      tokenId: hostPiece,
    });
    expect(r.status).toBe(201);
    const seats = (await lobbyOf(host.gameId)).seats;
    expect(seats).toHaveLength(2);
    expect(new Set(seats.map((s) => s.tokenId)).size).toBe(2);
  });

  it("join with a piece that is not in the theme is a 400 (a client bug, not a race)", async () => {
    const host = await createGame(ts, { host: "Anna", maxPlayers: 3 });
    const r = await ts.api("POST", `/api/games/${host.gameId}/join`, {
      name: "Ben",
      inviteCode: host.inviteCode,
      tokenId: "pretzel",
    });
    expect(r.status).toBe(400);
    expect((await lobbyOf(host.gameId)).seats).toHaveLength(1);
  });
});

describe("theme change and chosen pieces", () => {
  it("keeps a choice whose id exists in the new theme, reassigns the rest", async () => {
    const host = await createGame(ts, { host: "Anna", bots: ["easy"], maxPlayers: 3 });
    const chosen = first(CH, 6);
    await pick(host, chosen, host.token);
    // same theme again: nothing moves
    await ts.api("PATCH", `/api/games/${host.gameId}/settings`, { themeId: "ch" }, host.token);
    expect(await tokenOf(host)).toBe(chosen);
    // other theme: ids differ, so seats get valid and distinct pieces of the new theme
    const r = await ts.api<LobbyInfo>(
      "PATCH",
      `/api/games/${host.gameId}/settings`,
      { themeId: "fr" },
      host.token,
    );
    expect(r.status).toBe(200);
    const frIds = tokenIds("fr");
    const seats = r.json.seats;
    expect(seats.every((s) => frIds.includes(s.tokenId))).toBe(true);
    expect(new Set(seats.map((s) => s.tokenId)).size).toBe(seats.length);
    // the choice can be made again in the new theme
    const again = first(frIds, 7);
    expect((await pick(host, again, host.token)).status).toBe(200);
    expect(await tokenOf(host)).toBe(again);
  });
});
