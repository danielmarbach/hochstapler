// French and Italian on the responsive matrix (docs/DESIGN.md #76): the longest texts of these languages must fit
// the same layouts as the German baselines. Phone, smallest phone (se-320) and desktop are enough to prove it; the
// other viewports share their layout rules with these. Baselines carry the language suffix: <screen>-fr.png.
import { expect, settle, test, verifyScreen } from "../support/responsive.ts";
import { expectVisibleWithoutScrolling } from "../support/layout.ts";
import type { Page } from "@playwright/test";

const LANGUAGES = [
  {
    lang: "fr",
    home: "Qui es-tu ?",
    roll: "Lancer",
    buy: "Acheter",
    decline: "Refuser",
    sheetTab: "Joueurs",
    results: "Classement",
  },
  {
    lang: "it",
    home: "Chi sei?",
    roll: "Tira",
    buy: "Compra",
    decline: "Rifiuta",
    sheetTab: "Giocatori",
    results: "Classifica",
  },
] as const;

/** se-320, phone-390 (portrait) and desktop-1440 (widths of the projects in playwright.config.ts) */
const WIDTHS = [320, 390, 1440];

async function chooseLanguage(page: Page, lang: string): Promise<void> {
  // runs after the fixture's default ("de" unless a language is stored): the explicit choice of this test wins
  await page.addInitScript((value) => localStorage.setItem("poly:lang", value), lang);
}

const GAME_OVER = '[data-testid="game-over"]';
const PROPERTY_CARD = '[data-testid="property-card"]';

for (const language of LANGUAGES) {
  test.describe(`Language ${language.lang}`, () => {
    test.beforeEach(({ device }) => {
      test.skip(
        !WIDTHS.includes(device.width) || device.height < 560,
        "language matrix: phone, se-320, desktop",
      );
    });

    test("Home with all five languages in one row", async ({ page, device }) => {
      await chooseLanguage(page, language.lang);
      await page.goto("/#/");
      await expect(page.getByTestId("create-game")).toBeVisible();
      await expect(page.getByRole("heading", { name: language.home })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", language.lang);

      // the language picker: five buttons, one row, inside the viewport, the chosen one pressed
      const options = page.locator('[data-testid^="lang-option-"]');
      await expect(options).toHaveCount(5);
      const boxes = await options.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }),
      );
      const [first] = boxes;
      for (const box of boxes) {
        expect(Math.abs(box.top - (first?.top ?? 0)), "all languages in one row").toBeLessThan(2);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(device.width);
      }
      await expect(page.getByTestId(`lang-option-${language.lang}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await verifyScreen(page, device, `home-${language.lang}`);
    });

    test("Lobby (host with bots)", async ({ page, device, table }) => {
      await chooseLanguage(page, language.lang);
      const host = await table.createLobby(["easy", "normal"]);
      await table.openAs(host, "start-game");
      await expect(page.getByTestId("seat")).toHaveCount(3);
      await verifyScreen(page, device, `lobby-${language.lang}`);
    });

    test("Game: buy or decline", async ({ page, device, table }) => {
      await chooseLanguage(page, language.lang);
      await table.startGame();
      await table.patch({
        players: { [table.playerId("Anna")]: { position: table.tile("Weggisgasse") } },
        phase: { type: "await-buy", tile: table.tile("Weggisgasse") },
      });
      await expect(table.actor.action("buy")).toHaveText(language.buy);
      await settle(page);
      await expect(table.actor.action("decline")).toContainText(language.decline);
      await expectVisibleWithoutScrolling(table.actor.action("buy"), "Buy");
      await expectVisibleWithoutScrolling(table.actor.action("decline"), "Decline");
      await verifyScreen(page, device, `await-buy-${language.lang}`);
    });

    test("Game: property card with buildings", async ({ page, device, table }) => {
      await chooseLanguage(page, language.lang);
      await table.startGame();
      const street = ["Weggisgasse", "Pilatusstrasse"];
      await table.setProperties(street, { owner: table.playerId("Anna") });
      await table.setProperties(street, { level: 2 });
      await table.actor.openPropertyCard("Weggisgasse");
      await expect(table.actor.testId("property-card")).toBeVisible();
      if (device.phonePortrait) {
        await expectVisibleWithoutScrolling(
          table.actor.testId("property-card").locator(".pfoot"),
          "Property card action bar",
        );
      }
      await verifyScreen(page, device, `property-card-${language.lang}`, { scope: PROPERTY_CARD });
    });

    test("Game: securities price list", async ({ page, device, table }) => {
      await chooseLanguage(page, language.lang);
      await table.startGame({ securities: true, securitiesLockRounds: 3 });
      await table.actor.openSecurities();
      await expect(table.actor.testId("security-row")).toHaveCount(6);
      await verifyScreen(page, device, `securities-market-${language.lang}`);
    });

    test("Results page", async ({ page, device, table }) => {
      await chooseLanguage(page, language.lang);
      await table.startGame();
      await table.setProperties(["Weggisgasse", "Pilatusstrasse"], {
        owner: table.playerId("Anna"),
      });
      await table.setProperties(["Kapellbrücke"], { owner: table.playerId("Ben") });
      await table.setProperties(["Kapellbrücke"], { mortgaged: true });
      await table.patch({
        players: {
          [table.playerId("Ben")]: { cash: 2400 },
          [table.playerId("Clara")]: { cash: 900 },
        },
        endVote: { by: table.playerId("Ben"), agreed: [table.playerId("Clara")] },
      });
      await table.actor.testId("end-vote-yes").click();
      await expect(table.actor.testId("game-over")).toBeVisible();
      await expect(table.actor.testId("results-row")).toHaveCount(3);
      await expect(table.actor.testId("game-over")).toContainText(language.results);
      await verifyScreen(page, device, `results-${language.lang}`, { scope: GAME_OVER });
    });

    test("Heavy game: player cards and the menu keep their layout", async ({
      page,
      device,
      table,
    }) => {
      await chooseLanguage(page, language.lang);
      await table.startHeavyGame();
      if (device.phonePortrait) {
        await table.actor.openSheetTab("players");
        await expect(table.actor.testId("sheet-tab-players")).toContainText(language.sheetTab);
      }
      await expect(table.actor.testId("player-panel")).toHaveCount(4);
      await verifyScreen(page, device, `heavy-players-${language.lang}`, { screenshot: false });
    });
  });
}
