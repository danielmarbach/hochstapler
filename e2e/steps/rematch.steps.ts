// Rematch: the results page opens one new lobby per game (same bots) that every player joins from their own page.
import { expect } from "@playwright/test";
import { Then, When } from "../support/fixtures.ts";
import type { World } from "../support/fixtures.ts";

const gameHash = (url: string): string => new URL(url).hash;

Then("the results page for {player} offers a rematch", async ({ world }, name: string) => {
  const rematch = world.get(name).testId("rematch");
  await expect(rematch).toBeEnabled();
  await expect(rematch).toHaveText("Revanche");
  // a new game from scratch stays available, as the secondary choice
  await expect(world.get(name).testId("new-game")).toBeVisible();
});

Then(
  "the results page for {player} offers to join the rematch",
  async ({ world }, name: string) => {
    await expect(world.get(name).testId("rematch")).toHaveText("Revanche beitreten");
  },
);

/** clicks the rematch button and waits until the browser has moved on to the new lobby */
async function enterRematch(world: World, name: string): Promise<void> {
  const actor = world.get(name);
  await actor.testId("rematch").click();
  await expect(actor.testId("seat").first()).toBeVisible();
  expect(actor.page.url()).not.toContain(world.gameId);
}

When("{player} asks for a rematch", async ({ world }, name: string) => {
  await enterRematch(world, name);
});

When("{player} joins the rematch", async ({ world }, name: string) => {
  await enterRematch(world, name);
});

When("{player} goes back to the results", async ({ world }, name: string) => {
  await world.get(name).page.goBack();
  await expect(world.get(name).testId("game-over")).toBeVisible();
});

Then(
  "{player} is the host of a new lobby with the bot {player}",
  async ({ world }, name: string, bot: string) => {
    const actor = world.get(name);
    await expect(actor.testId("start-game")).toBeVisible();
    await expect(actor.testId("seat")).toHaveCount(2);
    await expect(
      actor.testId("seat").filter({ hasText: name }).locator(".badge.host"),
    ).toBeVisible();
    await expect(actor.testId("seat").filter({ hasText: bot })).toBeVisible();
    expect(gameHash(actor.page.url())).not.toContain(world.gameId);
  },
);

Then(
  "{player} sits in the same lobby as {player}",
  async ({ world }, guest: string, host: string) => {
    const guestActor = world.get(guest);
    await expect(guestActor.testId("seat").filter({ hasText: guest })).toBeVisible();
    await expect(guestActor.testId("start-game")).toHaveCount(0);
    expect(gameHash(guestActor.page.url())).toBe(gameHash(world.get(host).page.url()));
    expect(gameHash(guestActor.page.url())).not.toContain(world.gameId);
  },
);
