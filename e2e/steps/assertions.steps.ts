// "Then": what players see in their browser.
import { expect } from "@playwright/test";
import { formatMoney } from "@poly/engine";
import { Then } from "../support/fixtures.ts";

Then(
  "{player} is offered the chance to buy {string}",
  async ({ world }, name: string, tile: string) => {
    const actor = world.get(name);
    await expect(actor.testId("buy-offer")).toContainText(tile);
    await expect(actor.action("buy")).toBeEnabled();
  },
);

Then("{player} has a balance of {amount}", async ({ world }, name: string, amount: number) => {
  await world.get(name).expectCash(name, amount, world.theme);
});

Then(
  "{player} sees that {player} has a balance of {amount}",
  async ({ world }, viewer: string, name: string, amount: number) => {
    await world.get(viewer).expectCash(name, amount, world.theme);
  },
);

Then("{player} owns {streets}", async ({ world }, name: string, tiles: string[]) => {
  const actor = world.get(name);
  await actor.openProperties();
  for (const tile of tiles) {
    await expect(actor.propertyRow(tile)).toBeVisible();
  }
});

Then("{player} does not own {streets}", async ({ world }, name: string, tiles: string[]) => {
  const actor = world.get(name);
  await actor.openProperties();
  for (const tile of tiles) {
    await expect(actor.propertyRow(tile)).toBeHidden();
  }
});

Then("{player} can end his/her turn", async ({ world }, name: string) => {
  await expect(world.get(name).action("end-turn")).toBeEnabled();
});

Then("it is {player}'s turn again", async ({ world }, name: string) => {
  await expect(world.get(name).action("roll")).toBeEnabled();
});

// ---- Auction ----
Then("an auction is running for {string}", async ({ world }, tile: string) => {
  for (const actor of world.allActors()) {
    await expect(actor.testId("auction")).toContainText(tile);
  }
});

Then("it is {player}'s turn to bid", async ({ world }, name: string) => {
  await expect(world.get(name).testId("bid-slider")).toBeVisible();
});

Then("{player} sees the notice that he/she has to raise money", async ({ world }, name: string) => {
  await expect(world.get(name).testId("debt-notice")).toBeVisible();
});

Then(
  "the auction for {player} shows the highest bid {amount} from {player}",
  async ({ world }, name: string, amount: number, bidder: string) => {
    await expect(world.get(name).testId("auction-highest")).toContainText(
      `${formatMoney(world.theme, amount)} von ${bidder}`,
    );
  },
);

Then(
  "the auction for {player} shows the auto-bid up to {amount}",
  async ({ world }, name: string, max: number) => {
    await expect(world.get(name).testId("autobid-active")).toContainText(
      formatMoney(world.theme, max),
    );
  },
);

Then("the auction for {player} shows no auto-bid", async ({ world }, name: string) => {
  await expect(world.get(name).testId("autobid-active")).toBeHidden();
});

// ---- Building ----
Then(
  "{player} has {building} on {streets}",
  async ({ world }, name: string, level: number, tiles: string[]) => {
    const actor = world.get(name);
    await actor.openProperties();
    for (const tile of tiles) {
      await expect(actor.propertyRow(tile)).toHaveAttribute("data-level", String(level));
    }
  },
);

Then("{player} can build on {string}", async ({ world }, name: string, tile: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await expect(actor.propertyRow(tile).getByTestId("row-build")).toBeEnabled();
});

Then("{player} cannot build on {string}", async ({ world }, name: string, tile: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await expect(actor.propertyRow(tile).getByTestId("row-build")).toBeDisabled();
});

Then(
  "the button {string} in the property card of {player} is enabled",
  async ({ world }, label: string, name: string) => {
    await expect(
      world.get(name).testId("property-card").getByRole("button", { name: label }),
    ).toBeEnabled();
  },
);

Then(
  "the button {string} in the property card of {player} is disabled",
  async ({ world }, label: string, name: string) => {
    await expect(
      world.get(name).testId("property-card").getByRole("button", { name: label }),
    ).toBeDisabled();
  },
);

// ---- Mortgages ----
Then("{string} of {player} is mortgaged", async ({ world }, tile: string, name: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await expect(actor.propertyRow(tile)).toHaveAttribute("data-mortgaged", "true");
});

Then("{string} of {player} is not mortgaged", async ({ world }, tile: string, name: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await expect(actor.propertyRow(tile)).toHaveAttribute("data-mortgaged", "false");
});

// ---- Jail, cards ----
Then("{player} is in jail", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.showPlayers();
  await expect(actor.panel(name).getByTestId("player-meta")).toContainText("U-Haft");
});

Then("{player} is no longer in jail", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.showPlayers();
  await expect(actor.panel(name).getByTestId("player-meta")).not.toContainText("U-Haft");
});

Then(
  "{player} and {player} see the event card {string}",
  async ({ world }, a: string, b: string, card: string) => {
    const text = world.cardText(card);
    for (const name of [a, b]) {
      await expect(world.get(name).testId("card-text")).toHaveText(text);
    }
  },
);

Then(
  "{player} sees the keyword {string} in the message",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).toast(text).first()).toBeVisible();
  },
);

// ---- Handel ----
Then(
  "the trade of {player} shows the status {string}",
  async ({ world }, name: string, status: string) => {
    const actor = world.get(name);
    await actor.openTrade();
    await expect(actor.testId("trade-dialog").getByTestId("trade-status").first()).toHaveText(
      status,
    );
    await actor.closeTrade();
  },
);

Then(
  "{player} sees the counter note {string} on the offer from {player}",
  async ({ world }, name: string, note: string, from: string) => {
    const actor = world.get(name);
    await actor.openTrade();
    await expect(actor.offerFrom(from).getByTestId("trade-counter-note")).toContainText(note);
    await actor.closeTrade();
  },
);

Then(
  "{player} cannot answer the offer from {player} with a counteroffer",
  async ({ world }, name: string, from: string) => {
    const actor = world.get(name);
    await actor.openTrade();
    const offer = actor.offerFrom(from);
    await expect(offer.getByTestId("trade-accept")).toBeVisible();
    await expect(offer.getByTestId("trade-counter")).toHaveCount(0);
    await expect(offer.getByTestId("trade-counter-last")).toBeVisible();
    await actor.closeTrade();
  },
);

Then("{player} has a trade offer from {player}", async ({ world }, name: string, from: string) => {
  const actor = world.get(name);
  await expect(actor.toast(`Neues Handelsangebot von ${from}`).first()).toBeVisible();
});

// ---- Absence, connection ----
Then(
  "{player} sees the badge {string} on {player}",
  async ({ world }, viewer: string, badge: string, name: string) => {
    const actor = world.get(viewer);
    await actor.showPlayers();
    await expect(actor.panel(name).getByTestId("player-badge")).toContainText(badge);
  },
);

Then(
  "{player} no longer sees the badge {string} on {player}",
  async ({ world }, viewer: string, badge: string, name: string) => {
    const actor = world.get(viewer);
    await actor.showPlayers();
    await expect(actor.panel(name)).toBeVisible();
    await expect(
      actor.panel(name).getByTestId("player-badge").filter({ hasText: badge }),
    ).toHaveCount(0);
  },
);

Then("{player} sees themselves as {string}", async ({ world }, name: string, label: string) => {
  const actor = world.get(name);
  await actor.showPlayers();
  await expect(actor.panel(name)).toContainText(label);
});

// ---- Game over ----
Then(
  "{player} sees that {player} wins the game",
  async ({ world }, viewer: string, winner: string) => {
    await expect(world.get(viewer).testId("winner")).toHaveText(`${winner} gewinnt!`);
  },
);

// ---- Mobile ----
Then("the menu for {player} is collapsed", async ({ world }, name: string) => {
  await expect(world.get(name).testId("sheet")).toHaveAttribute("data-open", "false");
});

Then("the menu for {player} is expanded", async ({ world }, name: string) => {
  await expect(world.get(name).testId("sheet")).toHaveAttribute("data-open", "true");
});

Then(
  "the tab for {player} shows the text {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).testId("sheet-pane")).toContainText(text);
  },
);

Then("the property card for {player} fills the whole screen", async ({ world }, name: string) => {
  const actor = world.get(name);
  const card = actor.testId("property-card");
  await expect(card).toBeVisible();
  const viewport = actor.page.viewportSize();
  const box = await card.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box?.width).toBeCloseTo(viewport?.width ?? 0, -1);
  expect(box?.height).toBeCloseTo(viewport?.height ?? 0, -1);
});

Then(
  "the property card for {player} shows the owner {string}",
  async ({ world }, name: string, owner: string) => {
    await expect(world.get(name).testId("card-owner")).toContainText(owner);
  },
);

Then("{player} sees the notice that the connection is lost", async ({ world }, name: string) => {
  await expect(world.get(name).testId("connection-lost")).toBeVisible();
});

Then("{player} no longer sees a connection notice", async ({ world }, name: string) => {
  await expect(world.get(name).testId("connection-lost")).toBeHidden({ timeout: 20_000 });
});

// ---- Desktop ----
Then(
  "the screen of {player} shows the players {string} and {string} side by side with their balance",
  async ({ world }, name: string, first: string, second: string) => {
    const actor = world.get(name);
    for (const player of [first, second]) {
      await expect(actor.panel(player)).toBeVisible();
      await expect(actor.panel(player).getByTestId("player-cash")).toContainText("CHF");
    }
  },
);

Then("{player} has no menu bar at the bottom", async ({ world }, name: string) => {
  await expect(world.get(name).testId("sheet")).toHaveCount(0);
  await expect(world.get(name).testId("action-bar")).toBeVisible();
});
