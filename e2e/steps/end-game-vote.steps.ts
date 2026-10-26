// Ending the game by vote: menu, vote banner and results page.
import { expect } from "@playwright/test";
import { formatMoney } from "@poly/engine";
import { Then, When } from "../support/fixtures.ts";

When("{player} proposes ending the game", async ({ world }, name: string) => {
  await world.get(name).proposeEndGame();
});

When("{player} agrees to end the game", async ({ world }, name: string) => {
  await world.get(name).testId("end-vote-yes").click();
});

When("{player} rejects ending the game", async ({ world }, name: string) => {
  await world.get(name).testId("end-vote-no").click();
});

Then(
  "{player} sees the request from {player} to end the game",
  async ({ world }, viewer: string, proposer: string) => {
    const vote = world.get(viewer).testId("end-vote");
    await expect(vote).toBeVisible();
    await expect(vote).toContainText(`${proposer} möchte das Spiel beenden`);
    await expect(world.get(viewer).testId("end-vote-yes")).toBeEnabled();
  },
);

Then(
  "{player} sees that {player} has already agreed",
  async ({ world }, viewer: string, agreed: string) => {
    await expect(world.get(viewer).testId("end-vote-agreed")).toContainText(agreed);
  },
);

Then(
  "the results page for {player} shows {player} ahead of {player}",
  async ({ world }, viewer: string, first: string, second: string) => {
    const rows = world.get(viewer).testId("results-row");
    await expect(rows.first()).toHaveAttribute("data-player-name", first);
    await expect(rows.nth(1)).toHaveAttribute("data-player-name", second);
    await expect(rows.first()).toHaveAttribute("data-rank", "1");
  },
);

Then(
  "the results page for {player} shows {player} with a net worth of {amount}",
  async ({ world }, viewer: string, name: string, amount: number) => {
    const row = world
      .get(viewer)
      .page.locator(`[data-testid="results-row"][data-player-name="${name}"]`);
    await expect(row.getByTestId("results-total")).toHaveText(formatMoney(world.theme, amount));
  },
);

Then("the results page for {player} offers a new game", async ({ world }, name: string) => {
  await expect(world.get(name).testId("new-game")).toBeVisible();
  await expect(world.get(name).testId("new-game")).toBeEnabled();
});

Then("the game continues for {player}", async ({ world }, name: string) => {
  const actor = world.get(name);
  await expect(actor.testId("end-vote")).toBeHidden();
  await expect(actor.testId("game-over")).toBeHidden();
  await expect(actor.testId("hud")).toBeVisible();
});

Then(
  "{player} cannot propose ending the game again right away",
  async ({ world }, name: string) => {
    const actor = world.get(name);
    await actor.openMenu();
    await expect(actor.testId("menu-end-game")).toBeDisabled();
    await actor.closeMenu();
  },
);
