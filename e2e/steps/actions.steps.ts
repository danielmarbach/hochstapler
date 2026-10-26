// "When": what players do in their browser. Everything runs through clicks/taps on the UI.
import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { When } from "../support/fixtures.ts";

When("{player} rolls", async ({ world }, name: string) => {
  await world.get(name).action("roll").click();
});

When("{player} rolls by tapping", async ({ world }, name: string) => {
  await world.get(name).action("roll").tap();
});

When("{player} buys the property", async ({ world }, name: string) => {
  await world.get(name).action("buy").click();
});

When("{player} declines the purchase", async ({ world }, name: string) => {
  await world.get(name).action("decline").click();
});

When("{player} bids {amount}", async ({ world }, name: string, amount: number) => {
  const actor = world.get(name);
  await actor.testId("bid-slider").fill(String(amount));
  await actor.action("bid").click();
});

When("{player} sets an auto-bid up to {amount}", async ({ world }, name: string, max: number) => {
  const actor = world.get(name);
  await actor.testId("autobid-input").fill(String(max));
  await actor.testId("autobid-set").click();
});

When("{player} passes", async ({ world }, name: string) => {
  await world.get(name).action("pass").click();
});

When("{player} ends his/her turn", async ({ world }, name: string) => {
  await world.get(name).action("end-turn").click();
});

When("{player} pays bail", async ({ world }, name: string) => {
  await world.get(name).action("pay-jail").click();
});

When("{player} closes the event card", async ({ world }, name: string) => {
  const actor = world.get(name);
  const popup = actor.testId("card-popup");
  // the popup also closes by itself after a few seconds; if it is still open, closing it must work
  // (a failed click used to be swallowed here and hid a real bug: the hovered card stayed open)
  if (await popup.isVisible()) {
    await popup.click({ timeout: 8_000 }).catch(async (error: unknown) => {
      if (await popup.isVisible()) {
        throw error; // still open → closing really failed
      }
    });
  }
  await expect(popup).toBeHidden();
});

When("{player} declares bankruptcy", async ({ world }, name: string) => {
  await world.get(name).action("bankrupt").click();
});

When("{player} reloads the page", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.page.reload();
  await actor.testId("hud").waitFor();
});

// ---- Properties, building, mortgages ----
When("{player} opens her properties", async ({ world }, name: string) => {
  await world.get(name).openProperties();
});

When("{player} builds on {string}", async ({ world }, name: string, tile: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await actor.propertyRow(tile).getByTestId("row-build").click();
});

/**
 * Clicks a button of a property row and returns once the server's answer is on screen (`data-mortgaged`).
 * The client disables the row buttons while an update animates. A click dispatched in the instant a previous update
 * disables the button is lost without any error, and the next step would then act on a state that never changed
 * (flake under full-suite load: "Auction: winning the bid with little cash", the second mortgage was never sent).
 * So the click is repeated while the button is still there and enabled but nothing happened; a button that is gone
 * (the action went through) is never clicked twice.
 */
async function clickUntilApplied(row: Locator, button: string, mortgaged: "true" | "false") {
  const target = row.getByTestId(button);
  await expect(async () => {
    if ((await target.count()) > 0 && (await target.isEnabled())) {
      await target.click({ timeout: 2000 });
    }
    await expect(row).toHaveAttribute("data-mortgaged", mortgaged, { timeout: 2500 });
  }).toPass({ timeout: 20_000 });
}

When("{player} takes out a mortgage on {string}", async ({ world }, name: string, tile: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await clickUntilApplied(actor.propertyRow(tile), "row-mortgage", "true");
});

When("{player} repays the mortgage on {string}", async ({ world }, name: string, tile: string) => {
  const actor = world.get(name);
  await actor.openProperties();
  await clickUntilApplied(actor.propertyRow(tile), "row-unmortgage", "false");
});

When(
  "{player} opens the property card of {string}",
  async ({ world }, name: string, tile: string) => {
    await world.get(name).openPropertyCard(tile);
  },
);

When(
  "{player} taps {string} in the property card",
  async ({ world }, name: string, label: string) => {
    await world.get(name).testId("property-card").getByRole("button", { name: label }).click();
  },
);

When("{player} closes the property card", async ({ world }, name: string) => {
  await world.get(name).closePropertyCard();
});

// ---- Trading ----
When(
  "{player} offers {player} {amount} for {string}",
  async ({ world }, name: string, partner: string, amount: number, tile: string) => {
    const actor = world.get(name);
    await actor.openTrade();
    await actor.testId("trade-partner").filter({ hasText: partner }).click();
    await actor.testId("trade-tile").filter({ hasText: tile }).click();
    await actor.testId("trade-cash").first().fill(String(amount));
    await actor.testId("trade-send").click();
    await actor.closeTrade();
  },
);

When(
  "{player} gives {player} {amount}",
  async ({ world }, name: string, partner: string, amount: number) => {
    const actor = world.get(name);
    await actor.openTrade();
    await actor.testId("trade-partner").filter({ hasText: partner }).click();
    await actor.testId("trade-cash").first().fill(String(amount));
    await actor.testId("trade-send").click();
    await actor.closeTrade();
  },
);

When("{player} accepts the offer from {player}", async ({ world }, name: string, from: string) => {
  const actor = world.get(name);
  await actor.openTrade();
  await actor.offerFrom(from).getByTestId("trade-accept").click();
  await actor.closeTrade();
});

When("{player} rejects the offer from {player}", async ({ world }, name: string, from: string) => {
  const actor = world.get(name);
  await actor.openTrade();
  await actor.offerFrom(from).getByTestId("trade-reject").click();
  await actor.closeTrade();
});

When(
  "{player} counters the offer from {player} and asks {amount}",
  async ({ world }, name: string, from: string, amount: number) => {
    const actor = world.get(name);
    await actor.openTrade();
    await actor.offerFrom(from).getByTestId("trade-counter").click();
    // prefilled from the other side: the second amount field is what the proposer gives
    await actor.testId("trade-cash").nth(1).fill(String(amount));
    await actor.testId("trade-send").click();
    await actor.closeTrade();
  },
);

When(
  "{player} counters the offer from {player} and pays {amount}",
  async ({ world }, name: string, from: string, amount: number) => {
    const actor = world.get(name);
    await actor.openTrade();
    await actor.offerFrom(from).getByTestId("trade-counter").click();
    await actor.testId("trade-cash").first().fill(String(amount));
    await actor.testId("trade-send").click();
    await actor.closeTrade();
  },
);

// ---- Mobile ----
When("{player} expands the menu", async ({ world }, name: string) => {
  await world.get(name).testId("sheet-handle").click();
});

When("{player} collapses the menu", async ({ world }, name: string) => {
  await world.get(name).testId("sheet-handle").click();
});

When(
  "{player} switches to the tab {string} in the menu",
  async ({ world }, name: string, tab: string) => {
    const actor = world.get(name);
    await actor.testId("sheet").getByRole("tab", { name: tab }).click();
  },
);

// ---- Connection ----
When("{player} loses the connection", async ({ world }, name: string) => {
  await world.get(name).goOffline();
});

When("{player} is back online", async ({ world }, name: string) => {
  world.get(name).goOnline();
});
