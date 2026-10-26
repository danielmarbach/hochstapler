// Phone menu opener and the "more" menu (UI review T07).
import { expect } from "@playwright/test";
import { When, Then } from "../support/fixtures.ts";

Then(
  "the menu opener for {player} is labelled {string} and at least 44 pixels big",
  async ({ world }, name: string, label: string) => {
    const opener = world.get(name).testId("sheet-open");
    await expect(opener).toBeVisible();
    await expect(opener).toContainText(label);
    const box = await opener.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  },
);

Then("the menu opener for {player} shows no hint", async ({ world }, name: string) => {
  await expect(world.get(name).testId("sheet-open").locator(".pip")).toHaveCount(0);
  await expect(world.get(name).testId("sheet-open")).toHaveAttribute("aria-label", "Menü");
});

Then(
  "the menu opener for {player} shows the hint {string}",
  async ({ world }, name: string, hint: string) => {
    const opener = world.get(name).testId("sheet-open");
    await expect(opener.locator(".pip")).toBeVisible();
    await expect(opener).toHaveAttribute("aria-label", new RegExp(hint));
  },
);

When("{player} taps the menu opener", async ({ world }, name: string) => {
  await world.get(name).testId("sheet-open").tap();
});

Then("{player} has no camera buttons next to the menu", async ({ world }, name: string) => {
  const actor = world.get(name);
  await expect(actor.testId("menu-toggle")).toBeVisible();
  await expect(actor.page.getByRole("button", { name: "Kamera folgt der Figur" })).toHaveCount(0);
  await expect(actor.page.getByRole("button", { name: "Glow" })).toHaveCount(0);
});

When("{player} opens the game menu", async ({ world }, name: string) => {
  await world.get(name).openMenu();
});

Then(
  "{player} finds the camera switch {string} in the game menu",
  async ({ world }, name: string, label: string) => {
    const item = world.get(name).testId("game-menu").getByRole("menuitemcheckbox", { name: label });
    await expect(item).toBeVisible();
    const before = await item.getAttribute("aria-checked");
    await item.click();
    await expect(item).not.toHaveAttribute("aria-checked", before ?? "");
  },
);
