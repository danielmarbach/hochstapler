// Choosing a game piece (docs/DESIGN.md #75) entirely through the UI: start page, invitation, lobby, HUD.
import { expect } from "@playwright/test";
import { Then, When } from "../support/fixtures.ts";
import type { Actor } from "../support/actor.ts";

/** the tile of a piece by its German name; a taken tile is labelled "<piece>, vergeben an <name>" */
const tile = (actor: Actor, piece: string) =>
  actor.testId("token").filter({ has: actor.page.locator(".pkname", { hasText: piece }) });

When(
  "{player} creates a game in {country} with the piece {string} on the start page",
  async ({ world }, host: string, themeId: string, piece: string) => {
    world.themeId = themeId;
    const actor = await world.actor(host);
    await actor.page.goto("/");
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(host);
    await actor.page.locator(`[data-testid="country"][data-theme="${themeId}"]`).click();
    await actor.page.getByRole("button", { name: piece, exact: true }).click();
    await expect(actor.page.getByRole("button", { name: piece, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // humans only: drop the two bots the form starts with
    for (let i = 0; i < 2; i++) {
      await actor.page.getByRole("button", { name: "Bot entfernen" }).first().click();
    }
    await expect(actor.testId("bot-row")).toHaveCount(0);
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
  "{player} has the piece {string} in the lobby",
  async ({ world }, name: string, piece: string) => {
    await expect(
      world.get(name).page.getByRole("button", { name: piece, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  },
);

When("{player} opens the invite link", async ({ world }, guest: string) => {
  const actor = await world.actor(guest);
  await actor.page.goto(world.inviteLink);
  await expect(actor.testId("join-game")).toBeVisible();
});

Then(
  "{player} sees the piece {string} taken by {string}",
  async ({ world }, name: string, piece: string, holder: string) => {
    const actor = world.get(name);
    const taken = actor.page.getByRole("button", { name: `${piece}, vergeben an ${holder}` });
    await expect(taken).toHaveAttribute("aria-disabled", "true");
    await expect(taken).toHaveAttribute("aria-pressed", "false");
  },
);

Then(
  "{player} sees the piece {string} taken by {string} in the lobby",
  async ({ world }, name: string, piece: string, holder: string) => {
    const taken = world
      .get(name)
      .page.getByRole("button", { name: `${piece}, vergeben an ${holder}` });
    await expect(taken).toHaveAttribute("aria-disabled", "true");
  },
);

Then(
  "{player} sees the piece {string} free in the lobby",
  async ({ world }, name: string, piece: string) => {
    const free = world.get(name).page.getByRole("button", { name: piece, exact: true });
    await expect(free).toHaveAttribute("aria-disabled", "false");
  },
);

When(
  "{player} picks the piece {string} and joins as {string}",
  async ({ world }, guest: string, piece: string, name: string) => {
    const actor = world.get(guest);
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(name);
    await tile(actor, piece).click();
    await expect(tile(actor, piece)).toHaveAttribute("aria-pressed", "true");
    await actor.testId("join-game").click();
    await expect(actor.testId("seat").filter({ hasText: name })).toBeVisible();
    await expect(tile(actor, piece)).toHaveAttribute("aria-pressed", "true");
  },
);

When(
  "{player} picks the piece {string} in the lobby",
  async ({ world }, name: string, piece: string) => {
    await tile(world.get(name), piece).click();
  },
);

Then("{player} cannot pick the piece {string}", async ({ world }, name: string, piece: string) => {
  const actor = world.get(name);
  const taken = tile(actor, piece);
  await expect(taken).toHaveAttribute("aria-disabled", "true");
  await taken.click({ force: true });
  await expect(taken).toHaveAttribute("aria-pressed", "false");
  await expect(taken).toHaveAttribute("aria-disabled", "true");
});

Then(
  "in the game {player} plays the piece {string} and {player} the piece {string}",
  async ({ world }, a: string, pieceA: string, b: string, pieceB: string) => {
    const viewer = world.get(a);
    await viewer.showPlayers();
    await expect(viewer.panel(a)).toHaveAttribute("data-token", pieceA);
    await expect(viewer.panel(b)).toHaveAttribute("data-token", pieceB);
  },
);
