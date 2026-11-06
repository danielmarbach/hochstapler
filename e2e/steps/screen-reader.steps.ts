// Screen reader labels: live regions, presence and colour-group stamps have a text equivalent.
import { expect } from "@playwright/test";
import { Then, When } from "../support/fixtures.ts";

const LIVE_REGION =
  '[role="status"], [role="alert"], [role="log"], [aria-live]:not([aria-live="off"])';

Then(
  "the turn banner of {player} announces {string} as a status",
  async ({ world }, name: string, text: string) => {
    const banner = world.get(name).testId("turn-banner");
    await expect(banner.getByRole("status")).toHaveText(new RegExp(text));
  },
);

Then(
  "the countdown of {player} is a timer outside of every live region",
  async ({ world }, name: string) => {
    const banner = world.get(name).testId("turn-banner");
    const timer = banner.getByRole("timer");
    await expect(timer).toBeVisible();
    await expect(timer).toHaveText(/\d+:\d{2}/);
    expect(await timer.evaluate((el, sel) => el.closest(sel) !== null, LIVE_REGION)).toBe(false);
    await expect(banner.getByRole("status")).not.toContainText(/\d+:\d{2}/);
  },
);

Then(
  "{player} sees that {player} is {string}",
  async ({ world }, name: string, other: string, state: string) => {
    const actor = world.get(name);
    await actor.showPlayers();
    await expect(actor.panel(other).getByRole("img", { name: state, exact: true })).toBeVisible();
  },
);

When("{player} closes the game page", async ({ world }, name: string) => {
  await world.get(name).page.close();
});

Then(
  "{player} sees the stamp {string} on {player}",
  async ({ world }, name: string, label: string, owner: string) => {
    const actor = world.get(name);
    await actor.showPlayers();
    // a title tooltip is a fallback name at best and does not exist on touch: the label must be explicit
    await expect(
      actor.panel(owner).getByRole("listitem", { name: label, exact: true }),
    ).toHaveAttribute("aria-label", label);
  },
);
