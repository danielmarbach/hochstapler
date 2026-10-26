import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTheme, type LobbyInfo } from "@poly/engine";
import { createGame, startTestServer, type TestServer } from "./harness.ts";

describe("bots get country-themed names", () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer({ botDelayMs: 0 });
  });
  afterEach(async () => {
    await ts.dispose();
  });

  const botNames = (lobby: LobbyInfo): string[] =>
    lobby.seats.filter((s) => s.kind === "bot").map((s) => s.name);
  const lobbyOf = async (gameId: string): Promise<LobbyInfo> =>
    (await ts.api<LobbyInfo>("GET", `/api/games/${gameId}`)).json;

  it("names bots after the chosen country", async () => {
    const host = await createGame(ts, { settings: { themeId: "fr" }, bots: ["easy", "hard"] });
    expect(botNames(await lobbyOf(host.gameId))).toEqual(getTheme("fr").botNames.slice(0, 2));
  });

  it("renames auto-named bots when the host switches the country in the lobby", async () => {
    const host = await createGame(ts, { settings: { themeId: "ch" }, bots: ["normal", "normal"] });
    const r = await ts.api<LobbyInfo>(
      "PATCH",
      `/api/games/${host.gameId}/settings`,
      { themeId: "it" },
      host.token,
    );
    expect(r.status).toBe(200);
    expect(botNames(r.json)).toEqual(getTheme("it").botNames.slice(0, 2));
  });

  it("never gives a bot the name of a human at the table", async () => {
    const [first, second] = getTheme("de").botNames;
    const host = await createGame(ts, { host: first, settings: { themeId: "de" }, bots: ["easy"] });
    expect(botNames(await lobbyOf(host.gameId))).toEqual([second]);
  });

  it("adds bots added later in the lobby with the next themed name", async () => {
    const host = await createGame(ts, { settings: { themeId: "ch" }, bots: ["easy"] });
    const r = await ts.api<LobbyInfo>(
      "POST",
      `/api/games/${host.gameId}/bots`,
      { botLevel: "hard" },
      host.token,
    );
    expect(botNames(r.json)).toEqual(getTheme("ch").botNames.slice(0, 2));
  });
});
