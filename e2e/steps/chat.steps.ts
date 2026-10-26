// Chat scenarios (docs/DESIGN.md #69): sending, blocked messages, spectators, host controls.
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures.ts";

When("{player} sends the chat message {string}", async ({ world }, name: string, text: string) => {
  const actor = world.get(name);
  await actor.openChat();
  const input = actor.testId("chat-input");
  await input.fill(text);
  await input.press("Enter");
});

When("{player} sends the quick message {string}", async ({ world }, name: string, text: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await actor.testId("quick-bar").getByRole("button", { name: text, exact: true }).click();
});

Then("{player} sees the chat hint {string}", async ({ world }, name: string, hint: string) => {
  await expect(world.get(name).testId("chat-hint")).toHaveText(hint);
});

Then(
  "{player} sees the chat message {string} from {player}",
  async ({ world }, name: string, text: string, from: string) => {
    const actor = world.get(name);
    await actor.openChat();
    await expect(
      actor.testId("chat-line").filter({ hasText: from }).filter({ hasText: text }),
    ).toBeVisible();
  },
);

Then("{player} has received no other chat message", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await expect(actor.testId("chat-line")).toHaveCount(1);
});

Given("{player} watches the game", async ({ world }, name: string) => {
  const actor = await world.actor(name);
  // no token: the page opens as a spectator
  await actor.page.goto(`/#/game/${world.gameId}`);
  await actor.testId("hud").waitFor();
});

Then(
  "{player} has no chat and does not see {string}",
  async ({ world }, name: string, text: string) => {
    const actor = world.get(name);
    if (actor.phone) {
      await actor.openSheetTab("log");
    } else {
      await actor.testId("log-toggle").click();
    }
    await expect(actor.testId("chat-tab")).toHaveCount(0);
    await expect(actor.page.getByText(text)).toHaveCount(0);
  },
);

When("{player} switches the chat to quick messages", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await actor.testId("chat-mode-quick").click();
  await expect(actor.testId("chat-mode-quick")).toHaveAttribute("aria-pressed", "true");
});

Then("{player} can only send quick messages", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await expect(actor.testId("quick-bar")).toBeVisible();
  await expect(actor.testId("chat-input")).toHaveCount(0);
});

When("{player} mutes {player}", async ({ world }, name: string, other: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await actor.page.locator(`[data-testid="mute-toggle"][data-player-name="${other}"]`).click();
  await expect(
    actor.page.locator(`[data-testid="mute-toggle"][data-player-name="${other}"]`),
  ).toHaveAttribute("aria-pressed", "true");
});

When("{player} lets {player} write again", async ({ world }, name: string, other: string) => {
  const actor = world.get(name);
  await actor.openChat();
  const toggle = actor.page.locator(`[data-testid="mute-toggle"][data-player-name="${other}"]`);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

Then("{player} sees that he is muted and cannot write", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await expect(actor.testId("chat-muted")).toBeVisible();
  await expect(actor.testId("chat-input")).toBeDisabled();
});

Then("{player} can write in the chat again", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openChat();
  await expect(actor.testId("chat-muted")).toHaveCount(0);
  await expect(actor.testId("chat-input")).toBeEnabled();
});

Given("{player} has joined {player}'s game", async ({ world }, guest: string, host: string) => {
  const hostSeat = world.seats.get(host);
  if (!hostSeat) {
    throw new Error(`${host} has not opened a game yet.`);
  }
  const seat = await world.api.join(hostSeat, guest);
  world.seats.set(guest, seat);
  const actor = await world.actor(guest);
  await actor.openGame(seat.gameId, seat.token, seat.inviteCode);
  await expect(actor.testId("lobby-chat")).toBeVisible();
});

When("{player} opens the lobby", async ({ world }, name: string) => {
  const seat = world.seats.get(name);
  if (!seat) {
    throw new Error(`${name} is not seated at the table.`);
  }
  const actor = await world.actor(name);
  await actor.openGame(seat.gameId, seat.token, seat.inviteCode);
  await expect(actor.testId("start-game")).toBeVisible();
});

When("{player} sets the chat to quick messages in the lobby", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.testId("chat-settings").locator("summary").click();
  await actor.testId("chat-mode-quick").click();
  await expect(actor.testId("chat-mode-quick")).toHaveAttribute("aria-pressed", "true");
});

Then(
  "the lobby for {player} shows the chat mode {string}",
  async ({ world }, name: string, mode: string) => {
    await expect(world.get(name).testId("lobby-chat")).toHaveText(`· Chat: ${mode}`);
  },
);
