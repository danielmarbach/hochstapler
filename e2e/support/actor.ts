import type { BrowserContext, Locator, Page, WebSocketRoute } from "@playwright/test";
import { expect } from "@playwright/test";
import { formatMoney } from "@poly/engine";
import type { Theme } from "@poly/engine";

export type Layout = "desktop" | "phone";

export type SheetTab = "players" | "props" | "board" | "securities" | "trades" | "log";

/** One human player in his own browser context (own localStorage, i.e. his own player token). */
export class Actor {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly layout: Layout;
  private online = true;
  private readonly sockets = new Set<WebSocketRoute>();

  constructor(name: string, context: BrowserContext, page: Page, layout: Layout) {
    this.name = name;
    this.context = context;
    this.page = page;
    this.layout = layout;
  }

  /** lets the test cut and restore the game connection (routes the page's WebSocket through the test) */
  async controlConnection(): Promise<void> {
    await this.context.routeWebSocket(/\/ws$/, (ws) => {
      if (!this.online) {
        void ws.close();
        return;
      }
      ws.connectToServer();
      this.sockets.add(ws);
    });
  }

  async goOffline(): Promise<void> {
    this.online = false;
    for (const ws of this.sockets) {
      await ws.close();
    }
    this.sockets.clear();
  }

  goOnline(): void {
    this.online = true;
  }

  get phone(): boolean {
    return this.layout === "phone";
  }

  /** opens the game page with the player's token already stored (what the invite flow leaves behind) */
  async openGame(gameId: string, token: string, inviteCode: string): Promise<void> {
    await this.context.addInitScript(
      ([id, t, code]) => {
        localStorage.setItem(`poly:token:${id}`, t);
        localStorage.setItem(`poly:invite:${id}`, code);
      },
      [gameId, token, inviteCode] as const,
    );
    await this.page.goto(`/#/game/${gameId}`);
  }

  // ---- generic locators ----
  testId(id: string): Locator {
    return this.page.getByTestId(id);
  }

  action(id: string): Locator {
    return this.testId(`action-${id}`);
  }

  panel(playerName: string): Locator {
    return this.page.locator(`[data-testid="player-panel"][data-player-name="${playerName}"]`);
  }

  toast(text: string | RegExp): Locator {
    return this.testId("toast").filter({ hasText: text });
  }

  // ---- layout aware navigation ----
  /** phone: expands the bottom sheet (no-op when open) and selects the tab */
  async openSheetTab(tab: SheetTab): Promise<void> {
    const sheet = this.testId("sheet");
    if ((await sheet.getAttribute("data-open")) !== "true") {
      await this.testId("sheet-handle").click();
      await expect(sheet).toHaveAttribute("data-open", "true");
    }
    await this.testId(`sheet-tab-${tab}`).click();
    await expect(this.testId("sheet-pane")).toHaveAttribute("data-tab", tab);
  }

  async collapseSheet(): Promise<void> {
    const sheet = this.testId("sheet");
    if ((await sheet.getAttribute("data-open")) === "true") {
      await this.testId("sheet-handle").click();
      await expect(sheet).toHaveAttribute("data-open", "false");
    }
  }

  /** makes the player panels (names, cash, badges) visible */
  async showPlayers(): Promise<void> {
    if (this.phone) {
      await this.openSheetTab("players");
    }
  }

  /** opens the protocol (phone: "Log" tab of the sheet, desktop: the log panel) */
  async openLog(): Promise<void> {
    if (this.phone) {
      await this.openSheetTab("log");
    } else if (!(await this.testId("log-entry").first().isVisible())) {
      await this.testId("log-toggle").click();
    }
  }

  /** opens the chat (phone: "Log" tab of the sheet, desktop: the log panel) and selects its tab */
  async openChat(): Promise<void> {
    const tab = this.testId("chat-tab");
    if (!(await tab.isVisible())) {
      if (this.phone) {
        await this.openSheetTab("log");
      } else {
        await this.testId("log-toggle").click();
      }
    }
    await tab.click();
  }

  async openProperties(): Promise<void> {
    if (this.phone) {
      // on a phone the postcard covers the whole screen
      if (await this.testId("property-card").isVisible()) {
        await this.closePropertyCard();
      }
      await this.openSheetTab("props");
    } else if (!(await this.testId("drawer").isVisible())) {
      await this.testId("open-properties").click();
      await expect(this.testId("drawer")).toBeVisible();
    }
  }

  /** opens the board list (phone: sheet tab, desktop: drawer tab) */
  async openBoard(): Promise<void> {
    if (this.phone) {
      if (await this.testId("property-card").isVisible()) {
        await this.closePropertyCard();
      }
      await this.openSheetTab("board");
    } else {
      // the drawer of the action bar ("Besitz") has the board as its second tab; spectators have a button of their own
      if (!(await this.testId("drawer").isVisible())) {
        const spectator = await this.testId("open-board").isVisible();
        await this.testId(spectator ? "open-board" : "open-properties").click();
      }
      await this.testId("drawer-tab-board").click();
    }
    await expect(this.testId("board-list")).toBeVisible();
  }

  /** a field of the board list by its (German) name */
  boardEntry(tileName: string): Locator {
    return this.page.locator(`[data-testid="board-tile"][data-tile-name="${tileName}"]`);
  }

  boardEntryAt(index: number): Locator {
    return this.page.locator(`[data-testid="board-tile"][data-tile="${index}"]`);
  }

  /** opens the "Wertpapiere" panel (phone: sheet tab, desktop: drawer tab) */
  async openSecurities(): Promise<void> {
    if (this.phone) {
      if (await this.testId("property-card").isVisible()) {
        await this.closePropertyCard();
      }
      await this.openSheetTab("securities");
    } else {
      if (!(await this.testId("drawer").isVisible())) {
        await this.testId("open-securities").click();
      }
      await this.testId("drawer-tab-securities").click();
    }
    await expect(this.testId("securities-panel")).toBeVisible();
  }

  async closeProperties(): Promise<void> {
    if (this.phone) {
      await this.collapseSheet();
    } else if (await this.testId("drawer").isVisible()) {
      await this.testId("drawer").getByRole("button", { name: "Schliessen" }).click();
    }
  }

  /** a company in the price list, by its (German) name */
  securityRow(name: string): Locator {
    return this.testId("security-row").filter({ hasText: name });
  }

  /** a lot of the portfolio, by the company's (German) name */
  lotRow(name: string): Locator {
    return this.testId("lot-row").filter({ hasText: name });
  }

  propertyRow(tileName: string): Locator {
    return this.page.locator(`[data-testid="property-row"][data-tile-name="${tileName}"]`);
  }

  /** opens the postcard of an own property from the property list */
  async openPropertyCard(tileName: string): Promise<void> {
    await this.openProperties();
    await this.propertyRow(tileName).getByRole("button").first().click();
    await expect(this.testId("property-card")).toBeVisible();
  }

  async closePropertyCard(): Promise<void> {
    await this.testId("close-card").click();
    await expect(this.testId("property-card")).toBeHidden();
  }

  /** opens the trade dialog (phone: via the "Handel" tab of the sheet) */
  async openTrade(): Promise<void> {
    if (!(await this.testId("trade-dialog").isVisible())) {
      if (this.phone) {
        await this.openSheetTab("trades");
        await this.testId("trade-new").click();
      } else {
        await this.testId("open-trade").click();
      }
    }
    await expect(this.testId("trade-dialog")).toBeVisible();
  }

  /** opens the loan dialog of the show-off mode (phone: from the action row of the collapsed sheet) */
  async openLoan(): Promise<void> {
    if (!(await this.testId("loan-dialog").isVisible())) {
      if (this.phone) {
        await this.collapseSheet();
      }
      await this.testId("open-loan").click();
    }
    await expect(this.testId("loan-dialog")).toBeVisible();
  }

  async closeLoan(): Promise<void> {
    await this.testId("loan-close").click();
    await expect(this.testId("loan-dialog")).toBeHidden();
  }

  async closeTrade(): Promise<void> {
    await this.testId("trade-close").click();
    await expect(this.testId("trade-dialog")).toBeHidden();
  }

  /** a pending offer in the open trade dialog */
  offerFrom(playerName: string): Locator {
    return this.testId("trade-dialog").locator(
      `[data-testid="trade-offer"][data-from="${playerName}"]`,
    );
  }

  /** opens the game menu ("⋯" next to the camera buttons) */
  async openMenu(): Promise<void> {
    if (!(await this.testId("game-menu").isVisible())) {
      await this.testId("menu-toggle").click();
    }
    await expect(this.testId("game-menu")).toBeVisible();
  }

  async closeMenu(): Promise<void> {
    if (await this.testId("game-menu").isVisible()) {
      await this.testId("menu-toggle").click();
      await expect(this.testId("game-menu")).toBeHidden();
    }
  }

  /** menu -> "Spiel beenden…" -> confirm: asks everybody to end the game */
  async proposeEndGame(): Promise<void> {
    await this.openMenu();
    await this.testId("menu-end-game").click();
    await expect(this.testId("end-game-dialog")).toBeVisible();
    await this.testId("end-game-start").click();
    await expect(this.testId("end-game-dialog")).toBeHidden();
  }

  // ---- reading the state ----
  async expectCash(playerName: string, amount: number, theme: Theme): Promise<void> {
    await this.showPlayers();
    await expect(this.panel(playerName).getByTestId("player-cash")).toHaveText(
      formatMoney(theme, amount),
    );
  }
}
