// Lobby seats: the host confirms before a person loses their seat, bots go at once, presence has a text.
import { expect } from "@playwright/test";
import { Then, When } from "../support/fixtures.ts";

When(
  "{player} asks to remove {player} from the lobby",
  async ({ world }, host: string, guest: string) => {
    const actor = world.get(host);
    await actor.testId("seat").filter({ hasText: guest }).getByTestId("remove-seat").click();
  },
);

Then(
  "{player} is asked to confirm removing {player}",
  async ({ world }, host: string, guest: string) => {
    const dialog = world.get(host).testId("remove-seat-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(guest);
  },
);

When("{player} confirms removing {player}", async ({ world }, host: string, guest: string) => {
  const actor = world.get(host);
  const dialog = actor.testId("remove-seat-dialog");
  await expect(dialog).toContainText(guest);
  await actor.testId("remove-seat-confirm").click();
});

Then(
  "{player} is no longer asked to confirm removing a player",
  async ({ world }, host: string) => {
    await expect(world.get(host).testId("remove-seat-dialog")).toBeHidden();
  },
);

Then(
  "the keyboard focus of {player} is on the remove button of {player}",
  async ({ world }, host: string, guest: string) => {
    const actor = world.get(host);
    await expect(
      actor.testId("seat").filter({ hasText: guest }).getByTestId("remove-seat"),
    ).toBeFocused();
  },
);

Then(
  "the lobby for {player} still shows {player}",
  async ({ world }, host: string, guest: string) => {
    await expect(world.get(host).testId("seat").filter({ hasText: guest })).toHaveCount(1);
  },
);

Then(
  "the lobby for {player} no longer shows {player}",
  async ({ world }, host: string, guest: string) => {
    await expect(world.get(host).testId("seat").filter({ hasText: guest })).toHaveCount(0);
  },
);

When("{player} removes the bot from the lobby", async ({ world }, host: string) => {
  const actor = world.get(host);
  await actor.testId("seat").filter({ hasText: "Bot ·" }).getByTestId("remove-seat").click();
});

Then("the lobby for {player} shows no bot", async ({ world }, host: string) => {
  const actor = world.get(host);
  await expect(actor.testId("seat").filter({ hasText: "Bot ·" })).toHaveCount(0);
  await expect(actor.testId("remove-seat-dialog")).toHaveCount(0);
});

Then(
  "the lobby for {player} shows that {player} is {string}",
  async ({ world }, host: string, guest: string, state: string) => {
    const seat = world.get(host).testId("seat").filter({ hasText: guest });
    await expect(seat.getByRole("img", { name: state, exact: true })).toBeVisible();
  },
);
