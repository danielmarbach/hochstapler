// Keyboard-only smoke test (UI review F15): from the start page to a running game without a pointer.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/responsive.ts";

/** Presses Tab until the element matching `selector` has focus (fails when it cannot be reached). */
async function tabTo(page: Page, selector: string, maxPresses = 120): Promise<number> {
  for (let presses = 1; presses <= maxPresses; presses++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) {
      return presses;
    }
  }
  throw new Error(`"${selector}" cannot be reached with the Tab key within ${maxPresses} presses`);
}

test("create, lobby and start with the keyboard only", async ({ page, device }, info) => {
  test.skip(
    !["desktop-1440", "se-320"].includes(info.project.name),
    "one wide and one narrow screen",
  );
  await page.goto("/#/");
  await expect(page.getByTestId("create-game")).toBeVisible();

  await tabTo(page, 'input[aria-label="Dein Name"]');
  await page.keyboard.type("Anna");
  await tabTo(page, '[data-testid="token"]'); // the piece picker is reachable
  await tabTo(page, '[data-testid="create-game"]');
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("start-game")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("seat")).toHaveCount(3);
  await tabTo(page, '[data-testid="start-game"]');
  // the sticky footer keeps the focused button on screen
  const box = await page.getByTestId("start-game").boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(device.height);
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("hud")).toBeVisible({ timeout: 20_000 });
});
