// Device switch: the same seat on a second device (own browser context = own localStorage).
import { expect } from "@playwright/test";
import { When, Then } from "../support/fixtures.ts";
import type { World } from "../support/fixtures.ts";
import type { Actor } from "../support/actor.ts";

const PHONE = "Anna's phone";
const OTHER_PHONE = "Anna's second phone";

/** Links the scenario has seen (each scenario has its own World object). */
const seenLinks = new WeakMap<World, { oldLink: string }>();

const laptop = (world: World): Actor => world.get("Anna");

/** In the game the entry sits in the "⋯" menu, in the lobby it is a plain button. */
async function openDeviceLink(actor: Actor, label?: string): Promise<void> {
  const menu = actor.testId("menu-toggle");
  if (await menu.isVisible()) {
    await menu.click();
  }
  const button = actor.testId("device-link-open");
  if (label !== undefined) {
    await expect(button).toHaveAttribute("aria-label", label);
  }
  await button.click();
}

async function currentLink(world: World): Promise<string> {
  const anna = laptop(world);
  if (!(await anna.testId("device-link-dialog").isVisible())) {
    await openDeviceLink(anna);
  }
  const field = anna.testId("device-link");
  await expect(field).toBeVisible();
  return field.inputValue();
}

async function openOn(world: World, device: string, link: string): Promise<void> {
  const actor = await world.actor(device, "phone");
  await actor.page.goto(link);
}

When("{player} opens {string} on the laptop", async ({ world }, name: string, label: string) => {
  const actor = world.get(name);
  await openDeviceLink(actor, label);
  await expect(actor.testId("device-link-dialog")).toBeVisible();
});

Then("the dialog shows a QR code and the hint {string}", async ({ world }, warning: string) => {
  const dialog = laptop(world).testId("device-link-dialog");
  await expect(dialog.getByTestId("device-qr")).toBeVisible();
  await expect(dialog.getByTestId("device-link-warning")).toContainText(warning);
  await expect(dialog.getByTestId("device-link-renew")).toBeVisible();
  await expect(dialog.getByTestId("device-link")).toHaveValue(/#\/resume\//);
});

When("Anna opens her personal link on the phone", async ({ world }) => {
  await openOn(world, PHONE, await currentLink(world));
});

When("Anna opens her new personal link on the phone", async ({ world }) => {
  const link = await currentLink(world);
  expect(link).not.toBe(seenLinks.get(world)?.oldLink);
  await openOn(world, PHONE, link);
});

When("Anna renews the link on the laptop", async ({ world }) => {
  const actor = laptop(world);
  seenLinks.set(world, { oldLink: await currentLink(world) });
  await actor.testId("device-link-renew").click();
  await expect(actor.toast("Neuer Link erstellt")).toBeVisible();
});

When("Anna opens the old link on a new phone", async ({ world }) => {
  const old = seenLinks.get(world)?.oldLink;
  if (!old) {
    throw new Error("There is no old link yet.");
  }
  await openOn(world, OTHER_PHONE, old);
});

When("someone opens {string} on the phone", async ({ world }, hash: string) => {
  const actor = await world.actor(PHONE, "phone");
  await actor.page.goto(`/${hash}`);
});

Then("{player} is in the game as {string} on the phone", async ({ world }, name, label: string) => {
  const phone = world.get(PHONE);
  await phone.testId("hud").waitFor();
  await phone.showPlayers();
  await expect(phone.panel(name)).toContainText(label);
});

Then("it is Anna's turn on the phone", async ({ world }) => {
  await expect(world.get(PHONE).action("roll")).toBeEnabled();
});

Then("the address bar of Anna's phone contains no token", async ({ world }) => {
  const url = world.get(PHONE).page.url();
  expect(url).toMatch(new RegExp(`/#/game/${world.gameId}$`));
  const token = world.seats.get("Anna")?.token ?? "";
  expect(token.length).toBeGreaterThan(10);
  expect(url).not.toContain(token);
  expect(url).not.toContain("resume");
  expect(url).not.toContain("lang");
  // the token is (even more so) not in the path or the query
  const { pathname, search } = new URL(url);
  expect(`${pathname}${search}`).toBe("/");
});

Then(
  "{player} is still in the game as {string} on the laptop",
  async ({ world }, name: string, label: string) => {
    const actor = world.get(name);
    // the dialog (still open) covers the page
    await actor.testId("device-link-close").click();
    await expect(actor.testId("device-link-dialog")).toBeHidden();
    await expect(actor.testId("connection-lost")).toBeHidden();
    await actor.showPlayers();
    await expect(actor.panel(name)).toContainText(label);
    await expect(actor.testId("spectator")).toBeHidden();
  },
);

Then("Anna's phone shows the message that the link does not work", async ({ world }) => {
  await expect(world.get(PHONE).testId("resume-problem")).toBeVisible();
});

Then("the new phone shows the message that the link does not work", async ({ world }) => {
  const problem = world.get(OTHER_PHONE).testId("resume-problem");
  await expect(problem).toBeVisible();
  await expect(problem).toContainText("Link");
});

Then("the phone shows the message that the link does not work", async ({ world }) => {
  await expect(world.get(PHONE).testId("resume-problem")).toBeVisible();
});

Then("the phone offers the way back to the start page", async ({ world }) => {
  const home = world.get(PHONE).testId("resume-home");
  await expect(home).toHaveText("Zur Startseite");
  await expect(home).toHaveAttribute("href", "#/");
});

/** Display name in the picker -> language code */
const LANGUAGES: Record<string, string> = {
  Deutsch: "de",
  English: "en",
  Lozärnerdütsch: "gsw",
  Français: "fr",
  Italiano: "it",
};

async function expectPhoneLanguage(world: World, label: string): Promise<void> {
  const lang = LANGUAGES[label];
  if (!lang) {
    throw new Error(`Unknown language "${label}".`);
  }
  const phone = world.get(PHONE);
  await expect(phone.testId("lang-select")).toHaveValue(lang);
  await expect(phone.page.locator("html")).toHaveAttribute("lang", lang);
  await expect.poll(() => phone.page.evaluate(() => localStorage.getItem("poly:lang"))).toBe(lang);
}

Then("the phone shows the game in {string}", async ({ world }, label: string) => {
  await world.get(PHONE).testId("hud").waitFor();
  await expectPhoneLanguage(world, label);
});

Then("the phone remembers {string} after a reload", async ({ world }, label: string) => {
  const phone = world.get(PHONE);
  await phone.page.reload();
  await phone.testId("hud").waitFor();
  await expectPhoneLanguage(world, label);
});
