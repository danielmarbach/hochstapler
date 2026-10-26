// Invitation flow entirely through the UI: start page, lobby, invite link, joining.
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures.ts";

Given(
  "{player} has opened a game in {country}",
  async ({ world }, host: string, themeId: string) => {
    world.themeId = themeId;
    const seat = await world.api.createGame({
      host,
      settings: { themeId, turnTimeoutSec: 0 },
      maxPlayers: 2,
    });
    world.game = seat;
    world.seats.set(host, seat);
  },
);

When(
  "{player} creates a game in {country} with a bot on the start page",
  async ({ world }, host: string, themeId: string) => {
    world.themeId = themeId;
    const actor = await world.actor(host);
    await actor.page.goto("/");
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(host);
    await actor.page.locator(`[data-testid="country"][data-theme="${themeId}"]`).click();
    // the form starts with two bots: remove one
    await actor.page.getByRole("button", { name: "Bot entfernen" }).first().click();
    await expect(actor.testId("bot-row")).toHaveCount(1);
    await actor.testId("create-game").click();
    await expect(actor.testId("start-game")).toBeVisible();
    const gameId = new URL(actor.page.url()).hash.split("/")[2];
    if (!gameId) {
      throw new Error("After creating, the game ID is missing from the address.");
    }
    world.game = { gameId, playerId: "p1", token: "", inviteCode: "" };
    world.seats.set(host, world.game);
  },
);

Then(
  "the lobby for {player} shows the host {string} and a bot",
  async ({ world }, name: string, host: string) => {
    const actor = world.get(name);
    await expect(
      actor.testId("seat").filter({ hasText: host }).getByText("Host", { exact: true }),
    ).toBeVisible();
    await expect(actor.testId("seat").filter({ hasText: "Bot ·" })).toHaveCount(1);
  },
);

Then(
  "the lobby for {player} shows the country {string}",
  async ({ world }, name: string, country: string) => {
    await expect(world.get(name).page.getByRole("heading", { level: 1 })).toContainText(country);
  },
);

When("{player} copies the invite link", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.testId("copy-invite").click();
  await expect(actor.toast("Einladungslink kopiert")).toBeVisible();
  // the app's Permissions-Policy denies clipboard-read (the game never reads it): use the spy from World.actor()
  world.inviteLink = await actor.page.evaluate(
    () => (window as unknown as { __copied?: string }).__copied ?? "",
  );
  expect(world.inviteLink).toContain("#/join/");
});

When(
  "{player} opens the invite link and joins as {string}",
  async ({ world }, guest: string, name: string) => {
    const actor = await world.actor(guest);
    await actor.page.goto(world.inviteLink);
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(name);
    await actor.testId("join-game").click();
    await expect(actor.testId("seat").filter({ hasText: name })).toBeVisible();
  },
);

When(
  "{player} opens an invite link with a wrong code and joins as {string}",
  async ({ world }, guest: string, name: string) => {
    const actor = await world.actor(guest);
    await actor.page.goto(`/#/join/${world.gameId}/ABCDEF`);
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(name);
    await actor.testId("join-game").click();
  },
);

Then(
  "{player} sees the error message {string}",
  async ({ world }, name: string, message: string) => {
    await expect(world.get(name).page.getByText(message)).toBeVisible();
  },
);

Then(
  "{player} sees the fellow player {string} in the lobby",
  async ({ world }, name: string, other: string) => {
    await expect(world.get(name).testId("seat").filter({ hasText: other })).toBeVisible();
  },
);

When("{player} starts the game", async ({ world }, name: string) => {
  await world.get(name).testId("start-game").click();
});

Then(
  "{player} and {player} see the board with {int} players",
  async ({ world }, a: string, b: string, count: number) => {
    for (const name of [a, b]) {
      const actor = world.get(name);
      await expect(actor.page.locator("canvas")).toBeVisible();
      await actor.showPlayers();
      await expect(actor.testId("player-panel")).toHaveCount(count);
    }
  },
);
