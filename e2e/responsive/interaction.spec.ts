// Package A of the UI review (UI review by GPT 6.1 Sol, 2026-10-25): contrast, touch targets, focus, pressed
// state, device-link readability, trade feedback and the debt recovery panel. Same fixtures as screens.spec.ts, so the
// checks run on every viewport of the matrix.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/responsive.ts";
import { contrastRatio, textAndBackground } from "../support/contrast.ts";
import { animationsFinished, expectTouchTargets } from "../support/layout.ts";

const MIN_TARGET = 44;

/** a keyboard press switches Chromium to keyboard modality, so `:focus-visible` applies to a scripted focus() too */
async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press("Shift");
  await expect(async () => {
    await target.focus();
    await expect(target).toBeFocused({ timeout: 500 });
  }).toPass();
  // the focus ring is a transition: measure it once it has settled
  await animationsFinished(page);
}

async function outlineOf(
  target: Locator,
): Promise<{ style: string; width: number; offset: number }> {
  return target.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      style: s.outlineStyle,
      width: parseFloat(s.outlineWidth),
      offset: parseFloat(s.outlineOffset),
    };
  });
}

async function expectVisibleFocus(page: Page, target: Locator, what: string): Promise<void> {
  await expect(target, `${what} is rendered`).toBeVisible();
  await focusByKeyboard(page, target);
  const o = await outlineOf(target);
  expect(o.style, `${what}: outline style`).not.toBe("none");
  expect(o.width, `${what}: outline width`).toBeGreaterThanOrEqual(3);
  expect(o.offset, `${what}: outline offset`).toBeGreaterThanOrEqual(3);
}

async function expectMinTarget(target: Locator, what: string): Promise<void> {
  const count = await target.count();
  expect(count, `${what}: found`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await target.nth(i).boundingBox();
    expect(box, `${what} #${i} has a box`).not.toBeNull();
    expect(box?.height ?? 0, `${what} #${i} height`).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
    expect(box?.width ?? 0, `${what} #${i} width`).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
  }
}

test.describe("Chat names (T06)", () => {
  test("names are ink with a colour swatch and meet AA contrast", async ({ page, table }) => {
    await table.startGame();
    await table.actor.openChat();
    await table.actor.testId("chat-input").fill("Hallo zusammen");
    await table.actor.testId("chat-input").press("Enter");
    const line = table.actor.testId("chat-line").first();
    await expect(line).toContainText("Hallo zusammen");
    const name = line.getByTestId("chat-name");
    const { fg, bg } = await textAndBackground(name);
    expect(contrastRatio(fg, bg), `chat name ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    const swatch = line.getByTestId("chat-swatch");
    await expect(swatch).toBeVisible();
    const border = await swatch.evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(parseFloat(border)).toBeGreaterThanOrEqual(2);
    await page.mouse.move(0, 0);
  });
});

test.describe("Touch targets (F05)", () => {
  test("quick chat buttons are 44px", async ({ device, table }) => {
    test.skip(!device.touch, "desktop keeps the compact controls (see the hybrid test)");
    await table.startGame();
    await table.api.patchChat(table.hostSeat, { mode: "quick" });
    await table.actor.openChat();
    await expect(table.actor.testId("quick-bar")).toBeVisible();
    await expectMinTarget(table.actor.testId("quick-bar").getByRole("button"), "quick chat");
  });

  test("property controls and segmented buttons are 44px", async ({ page, device, table }) => {
    test.skip(!device.touch, "desktop keeps the compact controls (see the hybrid test)");
    await table.startGame();
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], { owner: table.playerId("Anna") });
    await table.actor.openProperties();
    const drawer = device.phonePortrait ? "sheet-pane" : "drawer";
    await expectMinTarget(table.actor.testId(drawer).locator(".sq"), "property controls");
    await page.goto("/#/");
    await page.getByRole("button", { name: "+ Bot hinzufügen" }).click();
    await expectMinTarget(page.locator(".seg button"), "segmented buttons");
  });
});

test.describe("Hybrid devices (F05)", () => {
  // a laptop with a touchscreen: the primary pointer is a mouse, but a finger is available (`any-pointer: coarse`)
  test.use({ hasTouch: true });

  test("44px targets apply when any pointer is coarse", async ({ page, device, table }, info) => {
    test.skip(
      info.project.name !== "desktop-1440",
      "hybrid emulation is only meaningful on a desktop viewport",
    );
    expect(device.width).toBeGreaterThan(1000);
    expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);
    await table.startGame();
    await table.api.patchChat(table.hostSeat, { mode: "quick" });
    await table.setProperties(["Weggisgasse"], { owner: table.playerId("Anna") });
    await table.actor.openChat();
    await expectMinTarget(table.actor.testId("quick-bar").getByRole("button"), "quick chat");
    await table.actor.openProperties();
    await expectMinTarget(table.actor.testId("drawer").locator(".sq"), "property controls");
    await page.goto("/#/");
    await page.getByRole("button", { name: "+ Bot hinzufügen" }).click();
    await expectMinTarget(page.locator(".seg button"), "segmented buttons");
    await expectTouchTargets(page);
  });
});

test.describe("Visible focus (F04)", () => {
  test("start page fields and buttons", async ({ page }) => {
    await page.goto("/#/");
    await expectVisibleFocus(page, page.getByRole("textbox").first(), "name field");
    await expectVisibleFocus(page, page.getByTestId("create-game"), "create button");
  });

  test("game controls, chat and device link", async ({ page, table }) => {
    await table.startGame();
    await expectVisibleFocus(page, table.actor.action("roll"), "roll button");
    await table.actor.openChat();
    await expectVisibleFocus(page, table.actor.testId("chat-input"), "chat field");
    await table.actor.openMenu();
    await table.actor.testId("device-link-open").click();
    // the dialog moves focus to its close button when it opens; only then is the field ours to focus
    await expect(table.actor.testId("device-link-close")).toBeFocused();
    await expectVisibleFocus(page, table.actor.testId("device-link"), "device link field");
    await expectVisibleFocus(page, table.actor.testId("device-link-copy"), "copy button");
  });

  test("trade amount field", async ({ page, table }) => {
    await table.startGame();
    await table.actor.openTrade();
    await expectVisibleFocus(page, table.actor.testId("trade-cash").first(), "trade cash field");
  });
});

test.describe("Pressed state (F03)", () => {
  test("turn pace and bot levels expose aria-pressed", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: "+ Bot hinzufügen" }).click();
    for (const button of await page.locator(".limits .limit").all()) {
      await expect(button).toHaveAttribute("aria-pressed", /^(true|false)$/);
    }
    await expect(page.locator(".limits .limit[aria-pressed=true]")).toHaveCount(1);
    const levels = page.locator('[data-testid="bot-row"] .seg button');
    expect(await levels.count()).toBeGreaterThan(1);
    await expect(
      page.locator('[data-testid="bot-row"] .seg button[aria-pressed=true]'),
    ).toHaveCount(await page.getByTestId("bot-row").count());
    await levels.nth(0).click();
    await expect(levels.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(levels.nth(1)).toHaveAttribute("aria-pressed", "false");
  });

  test("lobby bot level", async ({ table }) => {
    await table.createLobby([]);
    await table.openAs(table.hostSeat, "start-game");
    // the start button lives in the sticky footer (T08), the bot level switch in the host bar above it
    const levels = table.page.locator(".hostbar .seg button");
    expect(await levels.count()).toBeGreaterThan(1);
    await expect(levels.and(table.page.locator("[aria-pressed=true]"))).toHaveCount(1);
  });
});

test.describe("Padding scopes (F14)", () => {
  test("a phone keeps its own page padding (tablet rules start at 600px)", async ({
    page,
    device,
    table,
  }) => {
    test.skip(!device.phonePortrait, "only phone portrait has its own padding");
    const host = await table.createLobby([]);
    await page.goto(`/#/join/${host.gameId}/${host.inviteCode}`);
    await expect(page.getByTestId("join-game")).toBeVisible();
    const padding = await page
      .locator(".page.center.right")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
    expect(padding).toBe(12);
  });
});

test.describe("Continue on another device (F12)", () => {
  test.beforeEach(async ({ table }) => {
    await table.startGame();
    await table.actor.testId("menu-toggle").click();
    await table.actor.testId("device-link-open").click();
    await expect(table.actor.testId("device-link-dialog")).toBeVisible();
  });

  test("the renewal consequences stay readable", async ({ table }) => {
    const hint = table.actor.testId("device-link-renew-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("abgemeldet");
    const size = await hint.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(13);
  });

  test("the overlay honours the safe area", async ({ page, table }) => {
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-t", "40px");
      document.documentElement.style.setProperty("--safe-b", "30px");
    });
    await animationsFinished(page);
    const padding = await table.actor.testId("device-link-dialog").evaluate((el) => {
      const s = getComputedStyle(el.parentElement ?? el);
      return { top: parseFloat(s.paddingTop), bottom: parseFloat(s.paddingBottom) };
    });
    expect(padding.top).toBeGreaterThanOrEqual(40);
    expect(padding.bottom).toBeGreaterThanOrEqual(30);
  });

  test("the link field does not zoom iOS (16px)", async ({ device, table }) => {
    test.skip(!device.touch, "mobile only");
    const size = await table.actor
      .testId("device-link")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe("Text inputs on mobile (F12)", () => {
  const fontSize = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  test("name, chat, trade and auction fields are 16px", async ({ page, device, table }) => {
    test.skip(!device.touch, "mobile only");
    await table.startGame();
    await table.actor.openChat();
    expect(await fontSize(table.actor.testId("chat-input")), "chat").toBeGreaterThanOrEqual(16);
    await table.actor.openTrade();
    expect(
      await fontSize(table.actor.testId("trade-cash").first()),
      "trade",
    ).toBeGreaterThanOrEqual(16);
    await page.goto("/#/");
    expect(await fontSize(page.getByRole("textbox").first()), "name field").toBeGreaterThanOrEqual(
      16,
    );
  });

  test("auction auto-bid field is 16px", async ({ device, table }) => {
    test.skip(!device.touch, "mobile only");
    await table.startGame();
    const tile = table.tile("Weggisgasse");
    await table.patch({
      players: { [table.playerId("Anna")]: { position: tile } },
      phase: { type: "await-buy", tile },
    });
    await table.actor.action("decline").click();
    await expect(table.actor.testId("autobid-input")).toBeVisible();
    expect(await fontSize(table.actor.testId("autobid-input"))).toBeGreaterThanOrEqual(16);
  });

  test("lobby invitation field is 16px", async ({ device, table }) => {
    test.skip(!device.touch, "mobile only");
    await table.createLobby([]);
    await table.openAs(table.hostSeat, "start-game");
    expect(await fontSize(table.actor.testId("invite-link"))).toBeGreaterThanOrEqual(16);
  });
});

test.describe("Trade feedback (F10)", () => {
  test.beforeEach(async ({ table }) => {
    await table.startGame();
    await table.setProperties(["Weggisgasse"], { owner: table.playerId("Anna") });
    await table.setProperties(["Kapellbrücke"], { owner: table.playerId("Ben") });
    await table.actor.openTrade();
  });

  test("a disabled Send button says why, and the summary follows the selection", async ({
    table,
  }) => {
    const dialog = table.actor.testId("trade-dialog");
    await expect(table.actor.testId("trade-send")).toBeDisabled();
    const reason = dialog.getByTestId("trade-send-reason");
    await expect(reason).toBeVisible();
    const size = await reason.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(13);
    await expect(dialog.getByTestId("trade-summary-give")).toContainText("nichts");
    await expect(dialog.getByTestId("trade-summary-get")).toContainText("nichts");

    await dialog.getByTestId("trade-tile").filter({ hasText: "Weggisgasse" }).click();
    await dialog.getByTestId("trade-tile").filter({ hasText: "Kapellbrücke" }).click();
    await expect(table.actor.testId("trade-send")).toBeEnabled();
    await expect(reason).toBeHidden();
    await expect(dialog.getByTestId("trade-summary-give")).toContainText("Weggisgasse");
    await expect(dialog.getByTestId("trade-summary-get")).toContainText("Kapellbrücke");
  });
});

test.describe("Debt with securities (T10)", () => {
  test.beforeEach(async ({ table }) => {
    await table.startGame({ securities: true, securitiesLockRounds: 3 });
    await table.patch({
      round: 5,
      players: {
        [table.playerId("Anna")]: {
          cash: 20,
          holdings: [
            {
              secId: table.securityId("Pilatus Bergbahnen AG"),
              shares: 10,
              buyPrice: 80,
              boughtRound: 4,
            },
          ],
        },
      },
      phase: {
        type: "debt",
        debtor: table.playerId("Anna"),
        creditor: table.playerId("Ben"),
        amount: 900,
      },
    });
  });

  test("the recovery hint mentions securities", async ({ table }) => {
    await expect(table.actor.testId("debt-notice")).toContainText("Wertpapiere");
  });

  test("holdings and proceeds come first, selling leads and bankruptcy is secondary", async ({
    table,
  }) => {
    await table.actor.openSecurities();
    const panel = table.actor.testId("securities-panel");
    await expect(panel.getByTestId("securities-debt")).toBeVisible();
    const portfolioTop = await panel
      .getByTestId("portfolio")
      .evaluate((el) => el.getBoundingClientRect().top);
    const marketTop = await panel
      .getByTestId("security-list")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(portfolioTop, "portfolio above the price list").toBeLessThan(marketTop);
    const sell = panel.getByTestId("lot-emergency-sell");
    await expect(sell).toHaveClass(/\bcta\b/);
    await expect(panel.getByTestId("lot-after-sale")).toContainText("Restschuld");
    await expect(table.actor.action("bankrupt")).toHaveClass(/\bghost\b/);
  });

  test("a sale that covers the debt says so", async ({ table }) => {
    await table.patch({
      phase: {
        type: "debt",
        debtor: table.playerId("Anna"),
        creditor: table.playerId("Ben"),
        amount: 100,
      },
    });
    await table.actor.openSecurities();
    await expect(table.actor.testId("lot-after-sale")).toContainText("gedeckt");
  });
});
