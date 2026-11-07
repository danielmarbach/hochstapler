// Drawn icons and labels (docs/DESIGN.md #104): the toolbar in the top right and the give-up control carry a text
// label where there is room and are icon-only elsewhere; the accessible names never change with the layout.
import type { Locator } from "@playwright/test";
import { expect, test, verifyScreen } from "../support/responsive.ts";
import type { Device } from "../support/responsive.ts";

/** the desktop layout has room for the toolbar text; on a tablet the centred turn banner leaves none */
const toolbarLabelled = (device: Device): boolean => device.width > 1100 && device.height > 500;
/** the action bar has room for "Aufgeben" from tablet landscape on */
const giveUpLabelled = (device: Device): boolean => device.width >= 1000 && device.height > 500;

/** only what a person sees: `display: none` text does not count (the buttons set their text in capitals) */
const visibleText = (button: Locator, text: string): Promise<void> =>
  expect(button).toHaveText(new RegExp(`^${text}$`, "i"), { useInnerText: true });

const drawnIcon = (button: Locator): Locator => button.locator('svg.ico[aria-hidden="true"]');

test.describe("Toolbar in the top right", () => {
  test.beforeEach(async ({ table }) => {
    await table.startGame();
  });

  test("draws its icons and labels them where there is room", async ({ page, device }) => {
    const toolbar = page.locator(".topright");
    const controls = [
      { name: "Menü", label: "Menü" },
      { name: "Startseite", label: "Startseite" },
      ...(device.phonePortrait
        ? []
        : [
            { name: "Kamera folgt der Figur", label: "Kamera" },
            { name: "Glow", label: "Glow" },
          ]),
    ];
    for (const { name, label } of controls) {
      const button = toolbar.getByRole("button", { name, exact: true });
      await expect(button, name).toBeVisible();
      await expect(drawnIcon(button), `${name}: icon`).toHaveCount(1);
      await visibleText(button, toolbarLabelled(device) ? label : "");
    }
    await verifyScreen(page, device, "hud-toolbar", { screenshot: false });
  });

  test("keeps the switches of a phone in the menu, with drawn icons", async ({ device, table }) => {
    test.skip(!device.phonePortrait, "only phones move the switches into the menu");
    await table.actor.openMenu();
    const camera = table.actor.testId("game-menu").getByRole("menuitemcheckbox", {
      name: "Kamera folgt der Figur",
    });
    await expect(drawnIcon(camera)).toHaveCount(1);
    await expect(
      table.actor.testId("game-menu").getByRole("menuitemcheckbox", { name: "Glow an/aus" }),
    ).toBeVisible();
    await expect(drawnIcon(table.actor.testId("device-link-open"))).toHaveCount(1);
  });

  test("names the give-up control in words", async ({ page, device }) => {
    test.skip(device.phonePortrait, "phones give up from the players tab of the sheet");
    const giveUp = page.getByRole("button", { name: "Aufgeben (Bankrott)", exact: true });
    await expect(giveUp).toBeVisible();
    await expect(drawnIcon(giveUp)).toHaveCount(1);
    await visibleText(giveUp, giveUpLabelled(device) ? "Aufgeben" : "");
  });
});

test.describe("Headings without a small label above", () => {
  test("Join starts with the heading", async ({ page, table }) => {
    const host = await table.createLobby([]);
    await page.goto(`/#/join/${host.gameId}/${host.inviteCode}`);
    await expect(page.getByRole("heading", { level: 1, name: "Hochstapler" })).toBeVisible();
    await expect(page.locator(".eyebrow")).toHaveCount(0);
  });

  test("Lobby starts with the heading", async ({ page, table }) => {
    const host = await table.createLobby([]);
    await table.openAs(host, "start-game");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".eyebrow")).toHaveCount(0);
  });

  test("Results announce the winner without repeating the dialog title", async ({
    page,
    table,
  }) => {
    await table.startGame();
    await table.patch({
      endVote: {
        by: table.playerId("Ben"),
        agreed: [table.playerId("Clara")],
      },
    });
    await table.actor.testId("end-vote-yes").click();
    await expect(table.actor.testId("game-over")).toBeVisible();
    await expect(page.locator(".eyebrow")).toHaveCount(0);
  });

  test("The vote banner states the question once", async ({ page, table }) => {
    await table.startGame();
    await table.patch({ endVote: { by: table.playerId("Ben"), agreed: [] } });
    await expect(table.actor.testId("end-vote")).toBeVisible();
    await expect(page.locator(".eyebrow")).toHaveCount(0);
  });

  test("Problem screens use their title as the heading", async ({ page, table }) => {
    const host = await table.createLobby([]);
    await page.goto(`/#/resume/${host.gameId}/zzzzzzzzzzzzzzzzzzzzzzzz`);
    await expect(
      page.getByTestId("resume-problem").getByRole("heading", {
        level: 1,
        name: "Link funktioniert nicht",
      }),
    ).toBeVisible();
    await page.goto("/#/game/gibtsnicht");
    await expect(
      page.getByTestId("game-gone").getByRole("heading", { level: 1, name: "Spiel nicht mehr da" }),
    ).toBeVisible();
    await expect(page.locator(".eyebrow")).toHaveCount(0);
  });
});
