// Responsive suite (docs/DESIGN.md #18, #23): every screen/state on every viewport of the matrix in
// playwright.config.ts. Each test reaches its state deterministically (REST + test-mode fixtures), then
// `verifyScreen` compares a screenshot (WebGL masked) and runs the generic layout rules (support/layout.ts).
import { expect, settle, test, verifyScreen } from "../support/responsive.ts";
import type { Device } from "../support/responsive.ts";
import {
  expectDrawerClearOfActionBar,
  expectHorizontallyCentred,
  expectTopRowClear,
  expectBoardClearOfHud,
  expectPlayerCardsSound,
  expectPosterNotClipped,
  expectTokenPickerSound,
  expectVisibleWithoutScrolling,
} from "../support/layout.ts";
import type { SheetTab } from "../support/actor.ts";

/** the action bar floats in the middle of the screen (not in the phone sheet, not beside the phone-landscape drawer) */
const centredBar = (device: Device): boolean => !device.phonePortrait && device.height > 500;

// An open modal hides the HUD behind it on purpose: its controls are audited, the HUD behind it is not.
const PROPERTY_CARD = '[data-testid="property-card"]';
const TRADE = '[data-testid="trade-dialog"]';
const DEVICE_LINK = '[data-testid="device-link-dialog"]';
const CARD = '[data-testid="card-popup"]';
const GAME_OVER = '[data-testid="game-over"]';
const END_GAME_DIALOG = '[data-testid="end-game-dialog"]';
const END_VOTE = '[data-testid="end-vote"]';

test.describe("Start page and invitation", () => {
  test("Home", async ({ page, device }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("create-game")).toBeVisible();
    await expectTokenPickerSound(page, { tiles: 8, taken: 0 });
    // the primary action is a sticky footer: reachable without scrolling; the house rules start folded away
    if (device.height > 500) {
      // (a short landscape screen shows the poster first: the footer sticks once the form scrolls into view)
      await expectVisibleWithoutScrolling(page.getByTestId("create-game"), "Create game");
    }
    await expect(page.getByTestId("rules-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("rules-summary")).toContainText("Versteigerungen");
    await expect(page.getByTestId("token-summary")).toContainText("Gewählt");
    await expectPosterNotClipped(page);
    await verifyScreen(page, device, "home");
  });

  test("Join (invitation)", async ({ page, device, table }) => {
    const host = await table.createLobby(["normal"]);
    await page.goto(`/#/join/${host.gameId}/${host.inviteCode}`);
    await expect(page.getByTestId("join-game")).toBeVisible();
    await expectTokenPickerSound(page, { tiles: 8, taken: 2 });
    await verifyScreen(page, device, "join");
  });

  test("Join (invitation, long names hold pieces)", async ({ page, device, table }) => {
    const host = await table.createLobby(["hard"]);
    await table.addGuest("Maximilian Musterman", "gondola");
    await table.addGuest("Wolfgang-Amadeus Mo", "fondue");
    await page.goto(`/#/join/${host.gameId}/${host.inviteCode}`);
    await expect(page.getByTestId("join-game")).toBeVisible();
    await expect(page.getByTestId("token")).toHaveCount(8);
    await expectTokenPickerSound(page, { tiles: 8, taken: 4 });
    await verifyScreen(page, device, "join-pieces-taken");
  });

  test("Personal link invalid", async ({ page, device, table }) => {
    // the game exists, the token does not belong to any seat
    const host = await table.createLobby([]);
    await page.goto(`/#/resume/${host.gameId}/zzzzzzzzzzzzzzzzzzzzzzzz`);
    await expect(page.getByTestId("resume-problem")).toBeVisible();
    await verifyScreen(page, device, "resume-problem");
  });

  test("Lobby (host with bots)", async ({ page, device, table }) => {
    const host = await table.createLobby(["easy", "normal"]);
    await table.openAs(host, "start-game");
    await expect(page.getByTestId("start-game")).toBeVisible();
    await expect(page.getByTestId("seat")).toHaveCount(3);
    await expectTokenPickerSound(page, { tiles: 8, taken: 2 });
    await expectVisibleWithoutScrolling(page.getByTestId("start-game"), "Start game");
    await expectVisibleWithoutScrolling(page.getByTestId("copy-invite"), "Copy invite link");
    await verifyScreen(page, device, "lobby");
  });

  test("Lobby (guest, pieces held by long names)", async ({ page, device, table }) => {
    await table.createLobby(["easy"]);
    await table.addGuest("Maximilian Musterman", "gondola");
    const guest = await table.addGuest("Wolfgang-Amadeus Mo", "fondue");
    await table.openAs(guest, "token-picker");
    await expect(page.getByTestId("seat")).toHaveCount(4);
    await expectTokenPickerSound(page, { tiles: 8, taken: 3 });
    await verifyScreen(page, device, "lobby-pieces-taken");
  });
});

test.describe("Game", () => {
  test.beforeEach(async ({ table }) => {
    await table.startGame();
  });

  test("Rolling (await-roll)", async ({ page, device, table }) => {
    await expect(table.actor.action("roll")).toBeEnabled();
    if (centredBar(device)) {
      // T05: the `rise` animation used to overwrite the transform that centred the bar
      await expectHorizontallyCentred(table.actor.testId("action-bar"), "Action bar");
    }
    await verifyScreen(page, device, "await-roll");
  });

  test("Debt bar stays centred (T05)", async ({ page, device, table }) => {
    test.skip(
      !centredBar(device),
      "phones keep the bar in the sheet (portrait) or in the right half (landscape)",
    );
    await table.patch({
      players: { [table.playerId("Anna")]: { cash: 50 } },
      phase: {
        type: "debt",
        debtor: table.playerId("Anna"),
        creditor: table.playerId("Ben"),
        amount: 900,
      },
    });
    await expect(table.actor.testId("debt-notice")).toBeVisible();
    await expectHorizontallyCentred(table.actor.testId("action-bar"), "Debt action bar");
    await verifyScreen(page, device, "debt-bar");
    // the tall debt bar must not cover the bottom of an open property drawer
    await table.actor.openProperties();
    await expect(table.actor.testId("drawer")).toBeVisible();
    await expectDrawerClearOfActionBar(page);
    await expectTopRowClear(page);
  });

  test("Buy or decline (await-buy)", async ({ page, device, table }) => {
    await table.patch({
      players: { [table.playerId("Anna")]: { position: table.tile("Weggisgasse") } },
      phase: { type: "await-buy", tile: table.tile("Weggisgasse") },
    });
    await expect(table.actor.action("buy")).toBeVisible();
    await expect(table.actor.action("decline")).toBeVisible();
    await expectVisibleWithoutScrolling(table.actor.action("buy"), "Kaufen");
    await expectVisibleWithoutScrolling(table.actor.action("decline"), "Ablehnen");
    await verifyScreen(page, device, "await-buy");
  });

  test("Property card with buildings", async ({ page, device, table }) => {
    const anna = table.playerId("Anna");
    const street = ["Weggisgasse", "Pilatusstrasse"];
    await table.setProperties(street, { owner: anna });
    await table.setProperties(street, { level: 2 });
    await table.actor.openPropertyCard("Weggisgasse");
    await expect(table.actor.testId("property-card")).toBeVisible();
    if (device.phonePortrait) {
      await expectVisibleWithoutScrolling(
        table.actor.testId("property-card").locator(".pfoot"),
        "Property card action bar",
      );
    }
    await verifyScreen(page, device, "property-card", { scope: PROPERTY_CARD });
  });

  test("Property list (drawer)", async ({ page, device, table }) => {
    test.skip(device.phonePortrait, "phone portrait uses the bottom sheet (see tabs test)");
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], { owner: table.playerId("Anna") });
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], { level: 3 });
    await table.actor.openProperties();
    await expect(table.actor.testId("drawer")).toBeVisible();
    await verifyScreen(page, device, "drawer", { screenshot: false });
  });

  test("Trade dialog", async ({ page, device, table }) => {
    await table.setProperties(["Weggisgasse"], { owner: table.playerId("Anna") });
    await table.setProperties(["Kapellbrücke"], { owner: table.playerId("Ben") });
    await table.actor.openTrade();
    await expectVisibleWithoutScrolling(table.actor.testId("trade-send"), "Send offer");
    await verifyScreen(page, device, "trade", { scope: TRADE });
  });

  test("Trade dialog with counteroffers", async ({ page, device, table }) => {
    await table.setProperties(["Weggisgasse"], { owner: table.playerId("Anna") });
    await table.setProperties(["Kapellbrücke"], { owner: table.playerId("Ben") });
    const benSeat = table.seats.get("Ben");
    if (!benSeat) {
      throw new Error("Ben does not sit at the table");
    }
    const ben = await table.openAs(benSeat, "hud", await page.context().newPage());
    const anna = table.actor;
    const closeBen = async () => {
      await ben.testId("trade-close").click();
      await expect(ben.testId("trade-dialog")).toBeHidden();
    };
    // Ben: 200 for Weggisgasse
    await ben.openTrade();
    await ben.testId("trade-partner").filter({ hasText: "Anna" }).click();
    await ben.testId("trade-tile").filter({ hasText: "Weggisgasse" }).click();
    await ben.testId("trade-cash").first().fill("200");
    await ben.testId("trade-send").click();
    await closeBen();
    // Anna answers with a counteroffer: the form opens prefilled from Ben's offer
    await anna.openTrade();
    await anna.offerFrom("Ben").getByTestId("trade-counter").click();
    await expect(anna.testId("trade-form-title")).toContainText("Gegenangebot an Ben");
    await expect(anna.testId("trade-summary-give")).toContainText("Weggisgasse");
    await expect(anna.testId("trade-summary-get")).toContainText("200");
    await expectVisibleWithoutScrolling(anna.testId("trade-send"), "Send counteroffer");
    await verifyScreen(page, device, "trade-counter", { scope: TRADE });
    await anna.testId("trade-cash").nth(1).fill("260");
    await anna.testId("trade-send").click();
    await anna.closeTrade();
    // Ben counters again; Anna sees the offer with its price note and the history of the first one
    await ben.openTrade();
    await ben.offerFrom("Anna").getByTestId("trade-counter").click();
    await ben.testId("trade-cash").first().fill("230");
    await ben.testId("trade-send").click();
    await closeBen();
    await anna.openTrade();
    await expect(anna.offerFrom("Ben").getByTestId("trade-counter-note")).toContainText("230");
    await expect(anna.testId("trade-history").first()).toBeVisible();
    await expectVisibleWithoutScrolling(anna.testId("trade-send"), "Send offer");
    await verifyScreen(page, device, "trade-counter-history", { scope: TRADE });
  });

  test("Continue on another device (dialog)", async ({ page, device, table }) => {
    await table.actor.testId("menu-toggle").click();
    await table.actor.testId("device-link-open").click();
    const dialog = table.actor.testId("device-link-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("device-qr")).toBeVisible();
    await expectVisibleWithoutScrolling(dialog.getByTestId("device-link-copy"), "Copy link");
    await expectVisibleWithoutScrolling(dialog.getByTestId("device-link-renew"), "Renew link");
    await expectVisibleWithoutScrolling(dialog.getByTestId("device-link-warning"), "Warnhinweis");
    // QR code and link carry this run's random game id and token: masked in the baseline
    await verifyScreen(page, device, "device-link", {
      scope: DEVICE_LINK,
      mask: [dialog.getByTestId("device-qr"), dialog.getByTestId("device-link")],
    });
  });

  test("Event card", async ({ page, device, table }) => {
    await table.api.queueDice(table.gameId, [[1, 2]]);
    await table.patch({
      players: { [table.playerId("Anna")]: { position: 4 } },
      nextCard: { chance: "ch-dividend" },
    });
    await table.actor.action("roll").click();
    await expect(table.actor.testId("card-popup")).toBeVisible();
    await expect(table.actor.testId("card-text")).toHaveText(
      table.theme.cardTexts["ch-dividend"] ?? "",
    );
    // hovering holds the card open (reading time) so the screenshot never races the auto-dismiss
    await table.actor.testId("card-popup").hover();
    await verifyScreen(page, device, "chance-card", { scope: CARD });
  });

  test("Auction", async ({ page, device, table }) => {
    const tile = table.tile("Weggisgasse");
    await table.patch({
      players: { [table.playerId("Anna")]: { position: tile } },
      phase: { type: "await-buy", tile },
    });
    await table.actor.action("decline").click();
    await expect(table.actor.testId("auction")).toBeVisible();
    await verifyScreen(page, device, "auction");
  });

  test("Game over", async ({ page, device, table }) => {
    await table.patch({
      players: {
        [table.playerId("Clara")]: { bankrupt: true },
        [table.playerId("Anna")]: { cash: 50 },
      },
      phase: {
        type: "debt",
        debtor: table.playerId("Anna"),
        creditor: table.playerId("Ben"),
        amount: 900,
      },
    });
    await table.actor.action("bankrupt").click();
    await expect(table.actor.testId("game-over")).toBeVisible();
    await expect(table.actor.testId("winner")).toContainText("Ben");
    await verifyScreen(page, device, "game-over", { scope: GAME_OVER });
  });

  test("End game (confirmation)", async ({ page, device, table }) => {
    await table.actor.openMenu();
    await table.actor.testId("menu-end-game").click();
    await expect(table.actor.testId("end-game-dialog")).toBeVisible();
    await expectVisibleWithoutScrolling(table.actor.testId("end-game-start"), "Start vote");
    await verifyScreen(page, device, "end-game-dialog", { scope: END_GAME_DIALOG });
  });

  test("End-game vote (banner)", async ({ page, device, table }) => {
    await table.patch({
      endVote: { by: table.playerId("Ben"), agreed: [table.playerId("Clara")] },
    });
    await expect(table.actor.testId("end-vote")).toBeVisible();
    await expect(table.actor.testId("end-vote-agreed")).toContainText("Clara");
    await expectVisibleWithoutScrolling(table.actor.testId("end-vote-yes"), "Yes");
    await expectVisibleWithoutScrolling(table.actor.testId("end-vote-no"), "No");
    await verifyScreen(page, device, "end-vote", { scope: END_VOTE });
  });

  test("Results page after vote", async ({ page, device, table }) => {
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], { owner: table.playerId("Anna") });
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], { level: 2 });
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
    await expect(table.actor.testId("new-game")).toBeVisible();
    await verifyScreen(page, device, "results", { scope: GAME_OVER });
  });

  test("Menu tabs in the bottom sheet", async ({ page, device, table }) => {
    test.skip(!device.phonePortrait, "bottom sheet only exists on phone portrait");
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], { owner: table.playerId("Anna") });
    const tabs: SheetTab[] = ["players", "props", "trades", "log"];
    for (const tab of tabs) {
      await table.actor.openSheetTab(tab);
      await verifyScreen(page, device, `sheet-${tab}`);
    }
  });
});

test.describe("Securities", () => {
  /** a market with a visible history, a headline and a portfolio with a locked and two free lots */
  test.beforeEach(async ({ table }) => {
    await table.startGame({ securities: true, securitiesLockRounds: 3 });
    const series: Record<string, number[]> = {
      "Pilatus Bergbahnen AG": [84, 78, 91],
      "Lozärner Schoggi AG": [61, 63, 62],
      "SBB Pünktlichkeits-AG": [38, 35, 31],
      "Zuger Krypto-Treuhand": [112, 97, 120],
      "Gotthard Energie AG": [69, 72, 74],
      "Bahnhofstrass Immobilien AG": [118, 116, 117],
    };
    for (let step = 0; step < 3; step++) {
      const prices: Record<string, number> = {};
      for (const [name, values] of Object.entries(series)) {
        prices[table.securityId(name)] = values[step] ?? 1;
      }
      await table.patch({ market: { prices } });
    }
    const anna = table.playerId("Anna");
    await table.patch({
      round: 5,
      market: {
        headline: { secId: table.securityId("SBB Pünktlichkeits-AG"), kind: "crash", pct: 30 },
      },
      players: {
        [anna]: {
          holdings: [
            {
              secId: table.securityId("Pilatus Bergbahnen AG"),
              shares: 10,
              buyPrice: 80,
              boughtRound: 4,
            },
            {
              secId: table.securityId("SBB Pünktlichkeits-AG"),
              shares: 20,
              buyPrice: 45,
              boughtRound: 1,
            },
            {
              secId: table.securityId("Zuger Krypto-Treuhand"),
              shares: 5,
              buyPrice: 100,
              boughtRound: 1,
            },
          ],
        },
      },
    });
  });

  test("Price list with headline", async ({ page, device, table }) => {
    await table.actor.openSecurities();
    await expect(table.actor.testId("securities-headline")).toBeVisible();
    await expect(table.actor.testId("security-row")).toHaveCount(6);
    await verifyScreen(page, device, "securities-market");
  });

  test("Buying with share count and cost preview", async ({ page, device, table }) => {
    await table.actor.openSecurities();
    const row = table.actor.securityRow("Gotthard Energie AG");
    await row.getByTestId("security-buy-open").click();
    await row.getByTestId("security-shares-plus").click();
    await row.getByTestId("security-shares-plus").click();
    await expect(row.getByTestId("security-cost")).toContainText("CHF 222");
    // webfonts change line heights; the panel re-reveals the form once they are in
    await settle(page);
    await expectVisibleWithoutScrolling(
      row.getByTestId("security-buy-confirm"),
      "Confirm purchase",
    );
    // Playwright scrolls on its own while clicking: pin the scroll position so the baseline is reproducible
    await row.getByTestId("security-buy-form").evaluate((form) => {
      let scroller = form.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      if (scroller) {
        const gap =
          form.getBoundingClientRect().bottom - (scroller.getBoundingClientRect().bottom - 8);
        scroller.scrollTop += gap;
      }
    });
    await page.mouse.move(0, 0); // no hover highlight in the baseline
    await verifyScreen(page, device, "securities-buy");
  });

  test("Portfolio with lock period, profit and loss", async ({ page, device, table }) => {
    await table.actor.openSecurities();
    const locked = table.actor.lotRow("Pilatus Bergbahnen AG");
    await expect(locked.getByTestId("lot-lock")).toContainText("noch 2 Runden gesperrt");
    await locked.scrollIntoViewIfNeeded();
    await verifyScreen(page, device, "securities-portfolio");
  });

  test("Emergency sale when in debt", async ({ page, device, table }) => {
    await table.patch({
      players: { [table.playerId("Anna")]: { cash: 20 } },
      phase: {
        type: "debt",
        debtor: table.playerId("Anna"),
        creditor: table.playerId("Ben"),
        amount: 400,
      },
    });
    await table.actor.openSecurities();
    const locked = table.actor.lotRow("Pilatus Bergbahnen AG");
    await expect(locked.getByTestId("lot-emergency-sell")).toBeVisible();
    await locked.scrollIntoViewIfNeeded();
    await verifyScreen(page, device, "securities-emergency");
  });
});

test.describe("Heavy ownership", () => {
  // four players with long names, Daniel owns almost the whole board (see Table.startHeavyGame)
  test.beforeEach(async ({ table }) => {
    await table.startHeavyGame();
  });

  test("Player cards with many properties", async ({ page, device, table }) => {
    if (device.phonePortrait) {
      await table.actor.openSheetTab("players");
    }
    await expect(table.actor.testId("player-panel")).toHaveCount(4);
    await expect(
      table.actor.testId("player-panel").first().getByTestId("player-meta"),
    ).toContainText("35");
    await settle(page);
    await expectPlayerCardsSound(page);
    await verifyScreen(page, device, "heavy-players");
  });

  test("Property list", async ({ page, device, table }) => {
    await table.actor.openProperties();
    await verifyScreen(page, device, "heavy-properties", { screenshot: false });
  });

  test("Board list", async ({ page, device, table }) => {
    await table.actor.openBoard();
    await expect(table.actor.testId("board-tile")).toHaveCount(52);
    await expect(table.actor.boardEntry("Weggisgasse")).toContainText("Daniel");
    await settle(page);
    await verifyScreen(page, device, "heavy-board", { screenshot: false });
  });

  test("Board is framed clear of the HUD (desktop and tablet)", async ({ page, device, table }) => {
    test.skip(device.phonePortrait || device.height <= 500, "phones keep their own layout");
    await expect(table.actor.action("roll")).toBeEnabled();
    await expectBoardClearOfHud(page);
    // a drawer is a layout change: the board is re-framed beside it and the player cards shrink to one line each
    await table.actor.openProperties();
    await expect(table.actor.testId("players-compact")).toBeVisible();
    await expect(table.actor.testId("player-panel")).toHaveCount(4);
    await expectBoardClearOfHud(page);
    await table.actor.closeProperties();
    await expect(table.actor.testId("players-compact")).toBeHidden();
    await expectBoardClearOfHud(page);
  });

  test("Trade dialog", async ({ page, device, table }) => {
    await table.actor.openTrade();
    await expectVisibleWithoutScrolling(table.actor.testId("trade-send"), "Send offer");
    await verifyScreen(page, device, "heavy-trade", { scope: TRADE, screenshot: false });
  });

  test("Securities panel", async ({ page, device, table }) => {
    await table.actor.openSecurities();
    await verifyScreen(page, device, "heavy-securities", { screenshot: false });
  });

  test("Results page", async ({ page, device, table }) => {
    await table.patch({
      endVote: {
        by: table.playerId("Heidi"),
        agreed: [table.playerId("Max"), table.playerId("Zoe")],
      },
    });
    await table.actor.testId("end-vote-yes").click();
    await expect(table.actor.testId("game-over")).toBeVisible();
    await expect(table.actor.testId("results-row")).toHaveCount(4);
    await verifyScreen(page, device, "heavy-results", { scope: GAME_OVER });
  });
});
