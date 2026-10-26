// Interaction and accessibility (UI review package B): keyboard handling of dialogs, tabs, the drawn card, offline
// state, chat scrolling, auction amounts and joining.
import { expect } from "@playwright/test";
import { formatMoney } from "@poly/engine";
import { Given, Then, When } from "../support/fixtures.ts";

/** names used in the scenarios -> data-testid of the control */
const FOCUS_TARGETS: Record<string, string> = {
  "the trade button": "open-trade",
  "the menu button": "menu-toggle",
  Cancel: "end-game-cancel",
  No: "end-vote-no",
  "the card heading": "card-heading",
  "the results heading": "winner",
  "the close button": "device-link-close",
  "the card button": "card-continue",
};

function focusTarget(label: string): string {
  const id = FOCUS_TARGETS[label];
  if (!id) {
    throw new Error(`Unknown focus target "${label}".`);
  }
  return id;
}

// ---- keyboard ----
When("{player} presses {word}", async ({ world }, name: string, key: string) => {
  await world.get(name).page.keyboard.press(key);
});

Then(
  "the keyboard focus of {player} is on {string}",
  async ({ world }, name: string, label: string) => {
    await expect(world.get(name).testId(focusTarget(label))).toBeFocused();
  },
);

Then(
  "the keyboard focus of {player} is inside the open dialog",
  async ({ world }, name: string) => {
    const page = world.get(name).page;
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]"))))
      .toBe(true);
  },
);

Then(
  "{player} can tab {int} times without leaving the open dialog",
  async ({ world }, name: string, times: number) => {
    const page = world.get(name).page;
    for (let i = 0; i < times; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]"))),
      ).toBe(true);
    }
    for (let i = 0; i < times; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]"))),
      ).toBe(true);
    }
  },
);

When("{player} opens the trade dialog with the keyboard", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.testId("open-trade").focus();
  await actor.page.keyboard.press("Enter");
  await expect(actor.testId("trade-dialog")).toBeVisible();
});

When(
  "{player} opens the end-game confirmation with the keyboard",
  async ({ world }, name: string) => {
    const actor = world.get(name);
    await actor.testId("menu-toggle").focus();
    await actor.page.keyboard.press("Enter");
    await actor.testId("menu-end-game").focus();
    await actor.page.keyboard.press("Enter");
    await expect(actor.testId("end-game-dialog")).toBeVisible();
  },
);

When(
  "{player} opens the device transfer dialog with the keyboard",
  async ({ world }, name: string) => {
    const actor = world.get(name);
    await actor.testId("menu-toggle").focus();
    await actor.page.keyboard.press("Enter");
    await actor.testId("device-link-open").focus();
    await actor.page.keyboard.press("Enter");
    await expect(actor.testId("device-link-dialog")).toBeVisible();
  },
);

Then("the trade dialog of {player} is closed", async ({ world }, name: string) => {
  await expect(world.get(name).testId("trade-dialog")).toBeHidden();
});

Then("the end-game confirmation of {player} is closed", async ({ world }, name: string) => {
  await expect(world.get(name).testId("end-game-dialog")).toBeHidden();
});

Then("the device transfer dialog of {player} is closed", async ({ world }, name: string) => {
  await expect(world.get(name).testId("device-link-dialog")).toBeHidden();
});

Then("{player} still sees the request to end the game", async ({ world }, name: string) => {
  await expect(world.get(name).testId("end-vote")).toBeVisible();
});

// ---- tabs ----
When("{player} opens the log panel", async ({ world }, name: string) => {
  await world.get(name).openLog();
});

When("{player} focuses the tab {string}", async ({ world }, name: string, tab: string) => {
  await world.get(name).page.getByRole("tab", { name: tab, exact: true }).focus();
});

Then(
  "the tab {string} of {player} is selected and focused",
  async ({ world }, tab: string, name: string) => {
    const t = world.get(name).page.getByRole("tab", { name: tab, exact: true });
    await expect(t).toHaveAttribute("aria-selected", "true");
    await expect(t).toBeFocused();
    await expect(t).toHaveAttribute("tabindex", "0");
  },
);

Then(
  "only the tab {string} of {player} is in the tab order and its panel is labelled by it",
  async ({ world }, tab: string, name: string) => {
    const page = world.get(name).page;
    const selected = page.getByRole("tab", { name: tab, exact: true });
    await expect(selected).toHaveAttribute("tabindex", "0");
    const panelId = await selected.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute(
      "aria-labelledby",
      (await selected.getAttribute("id")) ?? "",
    );
    for (const other of await page.getByRole("tab", { selected: false }).all()) {
      await expect(other).toHaveAttribute("tabindex", "-1");
    }
  },
);

// ---- event card ----
When("{player} presses Continue on the event card", async ({ world }, name: string) => {
  await world.get(name).testId("card-continue").click();
});

Then("{player} no longer sees the event card", async ({ world }, name: string) => {
  await expect(world.get(name).testId("card-popup")).toBeHidden();
});

Then(
  "the Continue button of {player} is at least 44 pixels high",
  async ({ world }, name: string) => {
    // layout height: the card is still rotated and scaled while it flips in, which shrinks the bounding box
    const height = await world
      .get(name)
      .testId("card-continue")
      .evaluate((el) => (el as HTMLElement).offsetHeight);
    expect(height).toBeGreaterThanOrEqual(44);
  },
);

Then("the log of {player} contains {string}", async ({ world }, name: string, text: string) => {
  const actor = world.get(name);
  await actor.openLog();
  await expect(actor.testId("log-entry").filter({ hasText: text }).first()).toBeVisible();
});

// ---- offline ----
Then(
  "{player} sees that the actions are paused because of the lost connection",
  async ({ world }, name: string) => {
    await expect(world.get(name).testId("action-gate")).toContainText("Offline");
  },
);

Then("{player} cannot roll", async ({ world }, name: string) => {
  await expect(world.get(name).action("roll")).toHaveCount(0);
});

Then("{player} can roll again", async ({ world }, name: string) => {
  await expect(world.get(name).action("roll")).toBeEnabled({ timeout: 20_000 });
});

When(
  "{player} drafts an offer of {amount} for Ben",
  async ({ world }, name: string, cash: number) => {
    const actor = world.get(name);
    await actor.openTrade();
    await actor.testId("trade-partner").filter({ hasText: "Ben" }).click();
    await actor.testId("trade-cash").first().fill(String(cash));
  },
);

Then("{player} cannot send the offer and is told why", async ({ world }, name: string) => {
  const actor = world.get(name);
  await expect(actor.testId("trade-send")).toBeDisabled();
  await expect(actor.testId("trade-note")).toContainText("Offline");
});

Then(
  "the offer draft of {player} still shows {amount}",
  async ({ world }, name: string, cash: number) => {
    await expect(world.get(name).testId("trade-cash").first()).toHaveValue(String(cash));
  },
);

When("{player} sends the drafted offer", async ({ world }, name: string) => {
  const actor = world.get(name);
  await expect(actor.testId("trade-send")).toBeEnabled({ timeout: 20_000 });
  await actor.testId("trade-send").click();
});

Then("the offer draft of {player} is empty again", async ({ world }, name: string) => {
  const actor = world.get(name);
  await expect(actor.testId("trade-cash").first()).toHaveValue("0");
  await expect(actor.testId("trade-history").first()).toBeVisible();
});

// ---- chat ----
When("{player} opens the chat", async ({ world }, name: string) => {
  await world.get(name).openChat();
});

When("{player} scrolls the chat to the top", async ({ world }, name: string) => {
  const body = world.get(name).page.locator(".lbody");
  const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThan(24);
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
});

Then("{player} sees the pill {string}", async ({ world }, name: string, text: string) => {
  await expect(world.get(name).testId("new-messages")).toHaveText(text);
});

Then("{player} does not see the new messages pill", async ({ world }, name: string) => {
  await expect(world.get(name).testId("new-messages")).toHaveCount(0);
});

Then("the chat of {player} is still scrolled to the top", async ({ world }, name: string) => {
  const top = await world
    .get(name)
    .page.locator(".lbody")
    .evaluate((el) => el.scrollTop);
  expect(top).toBe(0);
});

Then("the chat of {player} is scrolled to the bottom", async ({ world }, name: string) => {
  const body = world.get(name).page.locator(".lbody");
  await expect
    .poll(() => body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(24);
});

When("{player} presses the pill {string}", async ({ world }, name: string, text: string) => {
  await world.get(name).page.getByRole("button", { name: text, exact: true }).click();
});

When(
  "{player} sends {string} with the Send button",
  async ({ world }, name: string, text: string) => {
    const actor = world.get(name);
    await actor.openChat();
    await expect(actor.testId("chat-send")).toBeDisabled();
    await actor.testId("chat-input").fill(text);
    await actor.testId("chat-send").click();
    await expect(actor.testId("chat-input")).toHaveValue("");
  },
);

Then("the Send button of {player} is at least 44 pixels high", async ({ world }, name: string) => {
  const height = await world
    .get(name)
    .testId("chat-send")
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(height).toBeGreaterThanOrEqual(44);
});

Then("the log button of {player} shows {string}", async ({ world }, name: string, text: string) => {
  await expect(world.get(name).testId("log-toggle")).toHaveText(text);
});

When("{player} closes the log panel", async ({ world }, name: string) => {
  await world
    .get(name)
    .page.locator(".logpanel")
    .getByRole("button", { name: "Schliessen" })
    .click();
});

Then(
  "the chat is labelled as a polite live region for {player}",
  async ({ world }, name: string) => {
    const region = world.get(name).page.getByRole("log", { name: "Chatnachrichten" });
    await expect(region).toHaveAttribute("aria-live", "polite");
  },
);

// ---- auction ----
Then(
  "the auction for {player} shows the list price {amount}",
  async ({ world }, name: string, price: number) => {
    await expect(world.get(name).testId("auction-listed")).toContainText(
      formatMoney(world.theme, price),
    );
  },
);

When("{player} raises the bid by {int}", async ({ world }, name: string, step: number) => {
  await world.get(name).testId(`bid-plus-${step}`).click();
});

Then("the bid amount of {player} shows {int}", async ({ world }, name: string, amount: number) => {
  await expect(world.get(name).testId("bid-amount")).toHaveValue(String(amount));
});

When("{player} types the bid amount {int}", async ({ world }, name: string, amount: number) => {
  await world.get(name).testId("bid-amount").fill(String(amount));
});

When("{player} places the bid", async ({ world }, name: string) => {
  await world.get(name).testId("action-bid").click();
});

Then(
  "{player} sees that {player} is on the move while {player} is bidding",
  async ({ world }, viewer: string, mover: string, bidder: string) => {
    const actor = world.get(viewer);
    await actor.showPlayers();
    await expect(actor.panel(mover).locator(".turn-tag")).toHaveText("Am Zug");
    await expect(actor.panel(bidder).getByTestId("bidding-tag")).toHaveText("Bietet");
  },
);

Then("{player} sees the explanation of the auto-bid maximum", async ({ world }, name: string) => {
  await expect(world.get(name).testId("autobid-hint")).toBeVisible();
});

// ---- joining ----
When(
  "{player} opens the invite link of {player}'s game",
  async ({ world }, guest: string, host: string) => {
    const seat = world.seats.get(host);
    if (!seat) {
      throw new Error(`${host} has not opened a game yet.`);
    }
    const actor = await world.actor(guest);
    await actor.page.goto(`/#/join/${seat.gameId}/${seat.inviteCode}`);
  },
);

Then("{player} is told that the game is full and cannot join", async ({ world }, name: string) => {
  const actor = world.get(name);
  await expect(actor.testId("join-blocked")).toContainText("voll");
  await expect(actor.testId("join-game")).toBeDisabled();
});

When("{player} submits the form without a name", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.testId("join-game").click();
});

Then(
  "{player} sees the name field marked as invalid with the message",
  async ({ world }, name: string) => {
    const actor = world.get(name);
    const field = actor.testId("join-name");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute("aria-describedby", "join-error");
    await expect(actor.testId("join-error")).toHaveAttribute("role", "alert");
    await expect(field).toBeFocused();
  },
);

Given("the lobby cannot be loaded for {player} at first", async ({ world }, name: string) => {
  const actor = await world.actor(name);
  let failed = false;
  await actor.page.route(/\/api\/games\/[^/]+$/, async (route) => {
    if (!failed && route.request().method() === "GET") {
      failed = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
});

When("{player} presses the Retry button", async ({ world }, name: string) => {
  await world.get(name).testId("join-retry").click();
});

Then("{player} can join the game", async ({ world }, name: string) => {
  await expect(world.get(name).testId("join-game")).toBeEnabled();
});
