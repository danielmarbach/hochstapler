// Fixtures for the responsive suite (e2e/responsive/*.spec.ts): plain Playwright tests that reach a screen through
// the REST API + test-mode fixtures, then check layout rules and compare a screenshot (WebGL canvas masked).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";
import { BOARD, getTheme } from "@poly/engine";
import type { BotLevel, BuildingLevel, GameSettings, Theme } from "@poly/engine";
import type { StatePatch } from "../../packages/server/src/test-mode.ts";
import { Actor } from "./actor.ts";
import { Api } from "./api.ts";
import type { Seat } from "./api.ts";
import {
  animationsFinished,
  expectDrawerClearOfActionBar,
  expectSoundLayout,
  expectTopRowClear,
} from "./layout.ts";

const HIDE_CANVAS_CSS = readFileSync(resolve(import.meta.dirname, "screenshot.css"), "utf8");

/**
 * Playwright's `stylePath` injects a <style> element, which the app's CSP (`style-src 'self'`) rightly blocks.
 * A constructed stylesheet is CSSOM-only and not subject to CSP, so the suite runs under the real policy.
 */
async function hideCanvas(page: Page): Promise<void> {
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, HIDE_CANVAS_CSS);
}

/** What the current Playwright project emulates. */
export interface Device {
  readonly width: number;
  readonly height: number;
  readonly touch: boolean;
  /** narrow portrait: the HUD turns into a bottom sheet (`max-width: 599px`, see platform.ts) */
  readonly phonePortrait: boolean;
}

export const PLAYERS = ["Anna", "Ben", "Clara"] as const;

/** One scenario: a game on the test server, viewed by Anna in the page of the current project. */
export class Table {
  readonly api: Api;
  readonly page: Page;
  readonly device: Device;
  readonly theme: Theme = getTheme("ch");
  host: Seat | null = null;
  readonly seats = new Map<string, Seat>();
  anna: Actor | null = null;
  private readonly props = new Map<
    number,
    { owner: string | null; level: BuildingLevel; mortgaged: boolean }
  >();

  constructor(api: Api, page: Page, device: Device) {
    this.api = api;
    this.page = page;
    this.device = device;
  }

  get gameId(): string {
    if (!this.host) {
      throw new Error("No game yet");
    }
    return this.host.gameId;
  }

  /** the host's seat (the game exists) */
  get hostSeat(): Seat {
    if (!this.host) {
      throw new Error("No game yet");
    }
    return this.host;
  }

  get actor(): Actor {
    if (!this.anna) {
      throw new Error("Anna has not opened the game yet");
    }
    return this.anna;
  }

  playerId(name: string): string {
    const seat = this.seats.get(name);
    if (!seat) {
      throw new Error(`${name} does not sit at the table`);
    }
    return seat.playerId;
  }

  tile(name: string): number {
    const i = this.theme.tileNames.indexOf(name);
    if (i < 0) {
      throw new Error(`No tile ${name}`);
    }
    return i;
  }

  /** a game that has not started (lobby / invitation) */
  async createLobby(bots: BotLevel[]): Promise<Seat> {
    this.host = await this.api.createGame({
      host: "Anna",
      settings: { themeId: "ch", turnTimeoutSec: 0 },
      bots,
      maxPlayers: 4,
    });
    this.seats.set("Anna", this.host);
    return this.host;
  }

  /** a human guest at the lobby (optionally with a game piece of the Swiss theme) */
  async addGuest(name: string, tokenId?: string): Promise<Seat> {
    if (!this.host) {
      throw new Error("No game yet");
    }
    const seat = await this.api.join(this.host, name, tokenId);
    this.seats.set(name, seat);
    return seat;
  }

  /** Anna, Ben and Clara at the table, game running, Anna's browser on it */
  async startGame(settings: Partial<GameSettings> = {}): Promise<void> {
    const host = await this.api.createGame({
      host: "Anna",
      settings: { themeId: "ch", turnTimeoutSec: 0, ...settings },
      bots: [],
      maxPlayers: 3,
    });
    this.host = host;
    this.seats.set("Anna", host);
    this.seats.set("Ben", await this.api.join(host, "Ben"));
    this.seats.set("Clara", await this.api.join(host, "Clara"));
    await this.api.start(host);
    await this.openAs(host);
    await this.patch({
      current: this.playerId("Anna"),
      phase: { type: "await-roll" },
    });
  }

  /**
   * "Heavy ownership" (the screen nobody tested): four players with long names, the viewer (Daniel, on the move) owns
   * almost the whole board (six complete colour groups with houses and a hotel, a mortgaged street, all railways and
   * utilities, a get-out-of-jail card, securities), one opponent is in jail, one is a bot, one is away. Every card of
   * the player list carries its maximum of badges, tags and stamps.
   */
  async startHeavyGame(): Promise<void> {
    const host = await this.api.createGame({
      host: "Daniel",
      settings: { themeId: "ch", turnTimeoutSec: 0, securities: true, securitiesLockRounds: 3 },
      bots: [],
      maxPlayers: 4,
    });
    this.host = host;
    this.seats.set("Daniel", host);
    this.seats.set("Heidi", await this.api.join(host, "Heidi vom Pilatus"));
    this.seats.set("Max", await this.api.join(host, "Maximiliane Brunnenthal"));
    this.seats.set("Zoe", await this.api.join(host, "Zoë"));
    await this.api.start(host);
    await this.openAs(host);

    const daniel = host.playerId;
    const heidi = this.playerId("Heidi");
    const properties: NonNullable<StatePatch["properties"]> = {};
    const groupSeen = new Map<number, number>();
    for (const tile of BOARD) {
      if (tile.price === undefined) {
        continue;
      }
      let owner = daniel;
      let level: BuildingLevel = 0;
      let mortgaged = false;
      if (tile.kind === "street" && tile.group !== undefined) {
        const nth = groupSeen.get(tile.group) ?? 0;
        groupSeen.set(tile.group, nth + 1);
        if (tile.group >= 6 && nth === 0) {
          owner = heidi; // the last four colour groups are only partly Daniel's (outlined stamps)
        }
        if (tile.group <= 5) {
          level = ([2, 5, 3, 1, 4, 2] as const)[tile.group] ?? 0;
        }
        mortgaged = tile.group === 6 && nth === 1;
      }
      properties[String(tile.index)] = { owner, level, mortgaged };
    }
    const jail = BOARD.find((t) => t.kind === "jail")?.index ?? 10;
    await this.api.patchState(host.gameId, {
      properties,
      round: 7,
      players: {
        [daniel]: {
          cash: 999_999,
          jailCards: ["ch-jail"],
          holdings: [
            {
              secId: this.securityId("Pilatus Bergbahnen AG"),
              shares: 10,
              buyPrice: 80,
              boughtRound: 4,
            },
          ],
        },
        [heidi]: { cash: 480, position: jail, inJail: true, jailTurns: 1 },
        [this.playerId("Max")]: { controller: "bot", cash: 99_999 },
        [this.playerId("Zoe")]: { controller: "away", cash: 15 },
      },
      current: daniel,
      phase: { type: "await-roll" },
    });
  }

  /** opens the game page with the seat's token (what the invite flow leaves behind) */
  async openAs(seat: Seat, ready = "hud", page: Page = this.page): Promise<Actor> {
    const actor = new Actor(
      "Anna",
      page.context(),
      page,
      this.device.phonePortrait ? "phone" : "desktop",
    );
    await actor.openGame(seat.gameId, seat.token, seat.inviteCode);
    if (page === this.page) {
      this.anna = actor;
    }
    await actor.testId(ready).waitFor();
    return actor;
  }

  /** id of a company of the Swiss theme by its German name */
  securityId(name: string): string {
    const company = this.theme.securities.find((c) => c.name === name);
    if (!company) {
      throw new Error(`No security ${name}`);
    }
    return company.id;
  }

  async patch(patch: Omit<StatePatch, "properties">): Promise<void> {
    await this.api.patchState(this.gameId, patch);
  }

  async setProperties(
    tiles: string[],
    change: { owner?: string | null; level?: BuildingLevel; mortgaged?: boolean },
  ): Promise<void> {
    const properties: NonNullable<StatePatch["properties"]> = {};
    for (const name of tiles) {
      const index = this.tile(name);
      const merged = {
        owner: null,
        level: 0 as BuildingLevel,
        mortgaged: false,
        ...this.props.get(index),
        ...change,
      };
      this.props.set(index, merged);
      properties[String(index)] = merged;
    }
    await this.api.patchState(this.gameId, { properties });
  }
}

interface Fixtures {
  device: Device;
  table: Table;
}

export const test = base.extend<Fixtures>({
  // hermetic page: lite 3D (software WebGL), nothing but the test server is reachable
  page: async ({ page, context }, use) => {
    await context.addInitScript(() => localStorage.setItem("poly:lite", "1"));
    // the suite checks German texts (baselines, steps); a language the test picked itself survives reloads
    await context.addInitScript(() => {
      if (!localStorage.getItem("poly:lang")) {
        localStorage.setItem("poly:lang", "de");
      }
    });
    await context.route(
      (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
      (route) => route.abort(),
    );
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await use(page);
  },
  device: async ({ viewport, hasTouch }, use) => {
    const size = viewport ?? { width: 1440, height: 900 };
    await use({
      width: size.width,
      height: size.height,
      touch: hasTouch,
      phonePortrait: size.width <= 599,
    });
  },
  table: async ({ page, baseURL, device }, use) => {
    await use(new Table(new Api(baseURL ?? ""), page, device));
  },
});

export { expect };

/** Lets webfonts, tweens and the reduced-motion transitions settle before measuring or comparing. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await animationsFinished(page);
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/**
 * The standard check of one screen: screenshot (WebGL canvas masked, animations off) and the generic layout rules.
 * The screenshot is soft so that a visual diff does not hide a layout violation (and vice versa).
 */
export async function verifyScreen(
  page: Page,
  device: Device,
  name: string,
  options: { screenshot?: boolean; scope?: string; mask?: Locator[] } = {},
): Promise<void> {
  await settle(page);
  if (options.screenshot !== false) {
    await hideCanvas(page);
    await expect.soft(page).toHaveScreenshot(`${name}.png`, {
      mask: options.mask ?? [],
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.01,
    });
  }
  await expectSoundLayout(page, {
    touch: device.touch,
    ...(options.scope ? { scope: options.scope } : {}),
  });
  // the HUD panels share the screen: the top row (banner, toolbar) and drawer vs action bar never overlap
  await expectTopRowClear(page);
  await expectDrawerClearOfActionBar(page);
}
