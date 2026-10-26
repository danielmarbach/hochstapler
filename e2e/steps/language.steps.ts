// Language choice: picker on the start page (pills) and in the game (select at the top right).
import { expect } from "@playwright/test";
import type { Lang } from "@poly/engine";
import { Given, Then, When } from "../support/fixtures.ts";
import type { Actor } from "../support/actor.ts";

/** Display name in the picker -> language code */
const LANGUAGES: Record<string, Lang> = {
  Deutsch: "de",
  English: "en",
  Lozärnerdütsch: "gsw",
  Français: "fr",
  Italiano: "it",
};

function code(label: string): Lang {
  const lang = LANGUAGES[label];
  if (!lang) {
    throw new Error(`Unknown language "${label}".`);
  }
  return lang;
}

/** the compact picker is shown in the game, the pills on the start page */
async function expectSelected(actor: Actor, label: string): Promise<void> {
  const lang = code(label);
  const select = actor.testId("lang-select");
  if (await select.isVisible()) {
    await expect(select).toHaveValue(lang);
  } else {
    await expect(actor.testId(`lang-option-${lang}`)).toHaveAttribute("aria-pressed", "true");
  }
}

Given("{player} opens the start page", async ({ world }, name: string) => {
  const actor = await world.actor(name);
  await actor.page.goto("/");
  await expect(actor.testId("create-game")).toBeVisible();
});

When(
  "{player} selects the language {string} on the start page",
  async ({ world }, name: string, label: string) => {
    await world
      .get(name)
      .testId(`lang-option-${code(label)}`)
      .click();
  },
);

When(
  "{player} selects the language {string} in the game",
  async ({ world }, name: string, label: string) => {
    await world.get(name).testId("lang-select").selectOption(code(label));
  },
);

Then(
  "the start page for {player} shows the text {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).page.getByRole("heading", { name: text })).toBeVisible();
  },
);

Then(
  "the language {string} is selected for {player}",
  async ({ world }, label: string, name: string) => {
    await expectSelected(world.get(name), label);
  },
);

Then(
  "the page of {player} has the document language {string}",
  async ({ world }, name: string, lang: string) => {
    await expect(world.get(name).page.locator("html")).toHaveAttribute("lang", lang);
  },
);

When(
  "{player} creates a game in {country} with a bot in the selected language",
  async ({ world }, host: string, themeId: string) => {
    world.themeId = themeId;
    const actor = world.get(host);
    await actor.page.locator("input.field.big").fill(host);
    await actor.page.locator(`[data-testid="country"][data-theme="${themeId}"]`).click();
    // the form starts with two bots: remove one
    await actor.page.locator('[data-testid="bot-row"] button.x').first().click();
    await expect(actor.testId("bot-row")).toHaveCount(1);
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

Then("{player} sees the game board", async ({ world }, name: string) => {
  await world.get(name).testId("hud").waitFor();
});

Then(
  "the action bar for {player} shows {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).action("roll")).toHaveText(text);
  },
);

Then(
  "the log for {player} shows the entry {string}",
  async ({ world }, name: string, text: string) => {
    const actor = world.get(name);
    await actor.openLog();
    await expect(actor.testId("log-entry").filter({ hasText: text })).toBeVisible();
  },
);
