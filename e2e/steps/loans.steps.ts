// Show-off mode (docs/DESIGN.md #93): steps for borrowing, interest and repayment. Everything
// players do or see runs through the UI (desktop: action bar, phone: the sheet's action row);
// cash, debts and turns are only set through the test-mode fixtures for "Given".
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures.ts";
import type { World } from "../support/fixtures.ts";

async function startLoanGame(world: World, host: string, guest: string, themeId: string) {
  world.themeId = themeId;
  const hostSeat = await world.api.createGame({
    host,
    settings: { themeId, turnTimeoutSec: 0, loans: true },
    bots: [],
    maxPlayers: 2,
  });
  const guestSeat = await world.api.join(hostSeat, guest);
  await world.api.start(hostSeat);
  world.game = hostSeat;
  world.seats.set(host, hostSeat);
  world.seats.set(guest, guestSeat);
  for (const [name, seat] of [
    [host, hostSeat],
    [guest, guestSeat],
  ] as const) {
    const actor = await world.actor(name);
    await actor.openGame(seat.gameId, seat.token, seat.inviteCode);
  }
  for (const name of [host, guest]) {
    await world.get(name).testId("hud").waitFor();
  }
}

// ---- Given ----
Given(
  "{player} and {player} play a game in {country} with the show-off mode",
  async ({ world }, host: string, guest: string, themeId: string) => {
    await startLoanGame(world, host, guest, themeId);
  },
);

// ---- When ----
When(
  "{player} creates a game in {country} with the show-off mode on the start page",
  async ({ world }, host: string, themeId: string) => {
    world.themeId = themeId;
    const actor = await world.actor(host);
    await actor.page.goto("/");
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(host);
    await actor.page.locator(`[data-testid="country"][data-theme="${themeId}"]`).click();
    await actor.testId("rules-toggle").click();
    // off by default; switching it on adds it to the house rules summary
    await expect(actor.testId("rules-summary")).not.toContainText("Protzmodus");
    await actor.testId("toggle-loans").click();
    await expect(actor.testId("rules-summary")).toContainText("Protzmodus");
    await actor.testId("create-game").click();
    await expect(actor.testId("start-game")).toBeVisible();
  },
);

When("{player} opens the loan dialog", async ({ world }, name: string) => {
  await world.get(name).openLoan();
});

When("{player} borrows {amount}", async ({ world }, name: string, amount: number) => {
  const actor = world.get(name);
  await actor.openLoan();
  const dialog = actor.testId("loan-dialog");
  const step = 100;
  for (let n = step; n < amount; n += step) {
    await dialog.getByTestId("loan-take-plus").click();
  }
  await dialog.getByTestId("loan-take-confirm").click();
  await expect(dialog.getByTestId("loan-tranche").first()).toBeVisible();
  await actor.closeLoan();
});

When("{player} repays {amount}", async ({ world }, name: string, amount: number) => {
  const actor = world.get(name);
  await actor.openLoan();
  const dialog = actor.testId("loan-dialog");
  await expect(dialog.getByTestId("loan-repay-confirm")).toContainText(
    String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, "'"),
  );
  await dialog.getByTestId("loan-repay-confirm").click();
  await expect(dialog.getByTestId("loan-none")).toBeVisible();
  await actor.closeLoan();
});

// ---- Then ----
Then(
  "the lobby for {player} shows the show-off notice {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).testId("lobby-loans")).toContainText(text);
  },
);

Then("{player} has no loan button", async ({ world }, name: string) => {
  await expect(world.get(name).testId("open-loan")).toHaveCount(0);
});

Then("{player} cannot borrow", async ({ world }, name: string) => {
  const actor = world.get(name);
  // the debt phase has arrived first, so the buttons below reflect it
  await expect(actor.testId("debt-notice")).toBeVisible();
  const button = actor.testId("open-loan");
  // desktop: the action bar entry stays but is disabled; phone: the action row does not offer it
  if (actor.phone) {
    await expect(button).toHaveCount(0);
  } else {
    await expect(button).toBeDisabled();
  }
});

Then(
  "the loan dialog for {player} says {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).testId("loan-lender")).toContainText(text);
  },
);

Then(
  "the loan dialog for {player} shows the rate {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).testId("loan-rate")).toHaveText(text);
  },
);

Then(
  "the player card of {player} shows {string}",
  async ({ world }, name: string, text: string) => {
    const actor = world.get(name);
    await actor.showPlayers();
    await expect(actor.panel(name).getByTestId("player-loan")).toHaveText(text);
  },
);

Then("the player card of {player} shows no loan", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.showPlayers();
  await expect(actor.panel(name).getByTestId("player-loan")).toHaveCount(0);
});
