// Expired games (retention, docs/DESIGN.md #57): the server deletes inactive games; whoever still has a link afterwards
// sees a friendly explanation. The deletion itself is triggered through test mode, everything else through the UI.
import { expect } from "@playwright/test";
import { When, Then } from "../support/fixtures.ts";

const MESSAGE = "Dieses Spiel ist abgelaufen oder existiert nicht";
const PHONE = "Anna's phone";

When("the game is deleted due to inactivity", async ({ world }) => {
  await world.api.expire(world.gameId);
});

When("{player} opens her game link again", async ({ world }, name: string) => {
  await world.get(name).page.reload();
});

Then(
  "{player} sees the message that the game has expired or does not exist",
  async ({ world }, name: string) => {
    await expect(world.get(name).testId("game-gone")).toContainText(MESSAGE);
  },
);

Then(
  "the phone shows the message that the game has expired or does not exist",
  async ({ world }) => {
    await expect(world.get(PHONE).testId("game-gone")).toContainText(MESSAGE);
  },
);

Then("{player} no longer has a stored token for the game", async ({ world }, name: string) => {
  const gameId = world.gameId;
  const stored = await world
    .get(name)
    .page.evaluate((id) => localStorage.getItem(`poly:token:${id}`), gameId);
  expect(stored).toBeNull();
});

When("{player} chooses the way back to the start page", async ({ world }, name: string) => {
  const home = world.get(name).testId("game-gone-home");
  await expect(home).toHaveText("Zur Startseite");
  await home.click();
});

Then("{player} sees the start page", async ({ world }, name: string) => {
  await expect(world.get(name).testId("create-game")).toBeVisible();
});
