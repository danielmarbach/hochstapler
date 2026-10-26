// Responsive coverage beyond German on the default zoom (UI review F15): English and Lozärnerdütsch variants of the
// start page, lobby, the heavy HUD and the results on the narrowest phone and on the desktop, plus 200% zoom.
import { expect, settle, test, verifyScreen } from "../support/responsive.ts";
import {
  expectPlayerCardsSound,
  expectSoundLayout,
  expectTokenPickerSound,
  expectVisibleWithoutScrolling,
} from "../support/layout.ts";

const COVERED_PROJECTS = ["se-320", "desktop-1440"];
const GAME_OVER = '[data-testid="game-over"]';

for (const lang of ["en", "gsw"] as const) {
  test.describe(`Language ${lang}`, () => {
    test.beforeEach(async ({ context }, info) => {
      test.skip(!COVERED_PROJECTS.includes(info.project.name), "narrowest phone and desktop only");
      await context.addInitScript((value) => localStorage.setItem("poly:lang", value), lang);
    });

    test("Home", async ({ page, device }) => {
      await page.goto("/#/");
      await expect(page.getByTestId("create-game")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expectTokenPickerSound(page, { tiles: 8, taken: 0 });
      await expectVisibleWithoutScrolling(page.getByTestId("create-game"), "Create game");
      await verifyScreen(page, device, `home-${lang}`);
    });

    test("Lobby (host with bots)", async ({ page, device, table }) => {
      const host = await table.createLobby(["easy", "normal"]);
      await table.openAs(host, "start-game");
      await expect(page.getByTestId("seat")).toHaveCount(3);
      await expectVisibleWithoutScrolling(page.getByTestId("start-game"), "Start game");
      await verifyScreen(page, device, `lobby-${lang}`);
    });

    test("Heavy HUD (player cards)", async ({ page, device, table }) => {
      await table.startHeavyGame();
      if (device.phonePortrait) {
        await table.actor.openSheetTab("players");
      }
      await expect(table.actor.testId("player-panel")).toHaveCount(4);
      await settle(page);
      await expectPlayerCardsSound(page);
      await verifyScreen(page, device, `heavy-players-${lang}`);
    });

    test("Heavy results", async ({ page, device, table }) => {
      await table.startHeavyGame();
      await table.patch({
        endVote: {
          by: table.playerId("Heidi"),
          agreed: [table.playerId("Max"), table.playerId("Zoe")],
        },
      });
      await table.actor.testId("end-vote-yes").click();
      await expect(table.actor.testId("game-over")).toBeVisible();
      await expect(table.actor.testId("results-row")).toHaveCount(4);
      await verifyScreen(page, device, `heavy-results-${lang}`, { scope: GAME_OVER });
    });
  });
}

test.describe("200% zoom (desktop window at half the CSS pixels)", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1440", "the zoom is emulated from the desktop window");
    // browser zoom 200% on a 1440x900 window leaves 720x450 CSS pixels
    await page.setViewportSize({ width: 720, height: 450 });
  });

  test("Home", async ({ page, device }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("create-game")).toBeVisible();
    await expectSoundLayout(page, { touch: device.touch });
    // only the poster fits on the first screen; once the form scrolls into view its footer holds the button
    await page.mouse.move(360, 300);
    await page.mouse.wheel(0, 400);
    await settle(page);
    await expectVisibleWithoutScrolling(page.getByTestId("create-game"), "Create game");
    await verifyScreen(page, device, "home-zoom200");
  });

  test("Heavy HUD", async ({ page, device, table }) => {
    await table.startHeavyGame();
    await expect(table.actor.action("roll")).toBeEnabled();
    await expectVisibleWithoutScrolling(table.actor.action("roll"), "Roll");
    await settle(page);
    await verifyScreen(page, device, "heavy-hud-zoom200");
  });
});
