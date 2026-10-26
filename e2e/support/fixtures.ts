import type { Browser } from "@playwright/test";
import { createBdd, defineParameterType, test as base } from "playwright-bdd";
import { getTheme } from "@poly/engine";
import type { BuildingLevel, Holding, Theme } from "@poly/engine";
import type { StatePatch } from "../../packages/server/src/test-mode.ts";
import { Actor } from "./actor.ts";
import type { Layout } from "./actor.ts";
import { Api } from "./api.ts";
import { Balancer, DeployableServer } from "./deploy.ts";
import type { Seat } from "./api.ts";

export const PLAYER_NAMES = ["Anna", "Ben", "Clara", "Heidi vom Pilatus"] as const;
export type PlayerName = (typeof PLAYER_NAMES)[number];

const COUNTRIES = {
  Switzerland: "ch",
  France: "fr",
  Germany: "de",
  Italy: "it",
} as const;

defineParameterType({
  name: "player",
  regexp: new RegExp(PLAYER_NAMES.join("|")),
  transformer: (s: string): PlayerName => s as PlayerName,
});
defineParameterType({
  name: "country",
  regexp: new RegExp(Object.keys(COUNTRIES).join("|")),
  transformer: (s: string): string => COUNTRIES[s as keyof typeof COUNTRIES],
});
/** "Weggisgasse", "Pilatusstrasse" and "Kapellbrücke" -> ["Weggisgasse", "Pilatusstrasse", "Kapellbrücke"] */
defineParameterType({
  name: "streets",
  regexp: /"[^"]+"(?:(?:, | and )"[^"]+")*/,
  transformer: (s: string): string[] => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ""),
});

/** Building level of a street */
const LEVELS: Record<string, BuildingLevel> = {
  "no house": 0,
  "1 house": 1,
  "2 houses": 2,
  "3 houses": 3,
  "4 houses": 4,
  "a hotel": 5,
  "a skyscraper": 6,
};
defineParameterType({
  name: "building",
  regexp: new RegExp(Object.keys(LEVELS).join("|")),
  transformer: (s: string): BuildingLevel => LEVELS[s] ?? 0,
});

/** 1'940 -> 1940 */
defineParameterType({
  name: "amount",
  regexp: /\d+(?:['’]\d{3})*/,
  transformer: (s: string): number => Number(s.replace(/['’]/g, "")),
});
/** "3+4, 1+1" -> [[3,4],[1,1]] */
defineParameterType({
  name: "rolls",
  regexp: /\d\+\d(?:, \d\+\d)*/,
  transformer: (s: string): [number, number][] =>
    s.split(", ").map((p) => {
      const [a, b] = p.split("+").map(Number);
      return [a ?? 1, b ?? 1];
    }),
});

/** Short card names from the scenarios -> card IDs of the Swiss chance/canton decks */
const CARDS_BY_NAME: Record<string, { deck: "chance" | "community"; id: string }> = {
  Dividende: { deck: "chance", id: "ch-dividend" },
  Radarfalle: { deck: "chance", id: "ch-speeding" },
  Alibi: { deck: "chance", id: "ch-jail-card" },
};

export function cardByName(shortName: string): { deck: "chance" | "community"; id: string } {
  const card = CARDS_BY_NAME[shortName];
  if (!card) {
    throw new Error(`Unknown card "${shortName}".`);
  }
  return card;
}

/** Context options of a second device that is always a phone (Pixel 7 sized, touch). */
const PHONE_DEVICE = {
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
} as const;

/** Everything one scenario owns: the browsers of its players and the game they play. */
export class World {
  readonly layout: Layout;
  api: Api;
  /** a server of this scenario's own (update scenarios); null: the shared server of the suite */
  ownServer: DeployableServer | null = null;
  /** handover scenarios: the balancer the browsers talk to, and the instance that took over */
  balancer: Balancer | null = null;
  successor: DeployableServer | null = null;
  themeId = "ch";
  seats = new Map<string, Seat>();
  game: Seat | null = null;
  /** invite link copied from the lobby (UI flow) */
  inviteLink = "";
  private readonly fixtureProps = new Map<
    number,
    { owner: string | null; level: BuildingLevel; mortgaged: boolean }
  >();
  /** securities lots set by fixtures so far, per player name (the patch replaces the whole portfolio) */
  private readonly fixtureHoldings = new Map<string, Holding[]>();
  private readonly actors = new Map<string, Actor>();
  private readonly browser: Browser;
  private contextOptions: Parameters<Browser["newContext"]>[0];

  constructor(
    browser: Browser,
    contextOptions: Parameters<Browser["newContext"]>[0],
    layout: Layout,
    baseUrl: string,
  ) {
    this.browser = browser;
    this.contextOptions = contextOptions;
    this.layout = layout;
    this.api = new Api(baseUrl);
  }

  /** Switches the scenario to a server of its own that can be "deployed" again (browsers open afterwards). */
  async useOwnServer(): Promise<DeployableServer> {
    const server = await DeployableServer.start(null);
    this.ownServer = server;
    this.api = new Api(server.url);
    this.contextOptions = { ...this.contextOptions, baseURL: server.url };
    return server;
  }

  /** A server of its own behind a balancer, using the file writer lease (handover scenarios). */
  async useBalancedServer(): Promise<void> {
    const server = await DeployableServer.start(null, { E2E_FAST_LEASE: "1" });
    this.ownServer = server;
    this.balancer = await Balancer.start(server.port);
    this.api = new Api(this.balancer.url);
    this.contextOptions = { ...this.contextOptions, baseURL: this.balancer.url };
  }

  /**
   * Blue/green like scripts/azure-deploy.sh: a second instance starts on the same data, takes the writer lease over
   * (the first one drains and sends its players away with 4503), then the traffic moves to it.
   */
  async handOver(): Promise<void> {
    if (!this.ownServer || !this.balancer) {
      throw new Error("handOver needs useBalancedServer first");
    }
    this.successor = await this.ownServer.startSibling();
    this.balancer.switchTo(this.successor.port);
  }

  get theme(): Theme {
    return getTheme(this.themeId);
  }

  get gameId(): string {
    if (!this.game) {
      throw new Error("No game is running yet.");
    }
    return this.game.gameId;
  }

  tileName(index: number): string {
    return this.theme.tileNames[index] ?? `Tile ${index}`;
  }

  tileIndex(name: string): number {
    const i = this.theme.tileNames.indexOf(name);
    if (i < 0) {
      throw new Error(`Tile "${name}" does not exist in ${this.theme.name}.`);
    }
    return i;
  }

  playerId(name: string): string {
    const seat = this.seats.get(name);
    if (!seat) {
      throw new Error(`${name} is not seated at the table.`);
    }
    return seat.playerId;
  }

  /** test mode: patch the running game (properties are merged with what earlier fixtures set) */
  async patch(patch: Omit<StatePatch, "properties">): Promise<void> {
    await this.api.patchState(this.gameId, patch);
  }

  async setProperties(
    tileNames: string[],
    change: { owner?: string | null; level?: BuildingLevel; mortgaged?: boolean },
  ): Promise<void> {
    const properties: NonNullable<StatePatch["properties"]> = {};
    for (const name of tileNames) {
      const tile = this.tileIndex(name);
      const merged = {
        owner: null,
        level: 0 as BuildingLevel,
        mortgaged: false,
        ...this.fixtureProps.get(tile),
        ...change,
      };
      this.fixtureProps.set(tile, merged);
      properties[String(tile)] = merged;
    }
    await this.api.patchState(this.gameId, { properties });
  }

  /** id of a company of the current theme by its German name */
  securityId(name: string): string {
    const company = this.theme.securities.find((c) => c.name === name);
    if (!company) {
      throw new Error(`The security "${name}" does not exist in ${this.theme.name}.`);
    }
    return company.id;
  }

  /** test mode: gives a player one more lot (earlier fixture lots stay) */
  async addHolding(playerName: string, lot: Holding): Promise<void> {
    const lots = [...(this.fixtureHoldings.get(playerName) ?? []), lot];
    this.fixtureHoldings.set(playerName, lots);
    await this.patch({ players: { [this.playerId(playerName)]: { holdings: lots } } });
  }

  /**
   * the player's own browser (created on first use); `phone` forces a phone-sized touch device whatever the
   * project emulates (a second device of the same player, e.g. "Anna's mobile")
   */
  async actor(name: string, device: "project" | "phone" = "project"): Promise<Actor> {
    const existing = this.actors.get(name);
    if (existing) {
      return existing;
    }
    const phone = device === "phone";
    const context = await this.browser.newContext(
      phone ? { ...this.contextOptions, ...PHONE_DEVICE } : this.contextOptions,
    );
    // software WebGL: let the client render the bare minimum (packages/client/src/platform.ts, LITE_RENDER)
    await context.addInitScript(() => localStorage.setItem("poly:lite", "1"));
    // the suite checks German texts (baselines, steps); a language the test picked itself survives reloads
    await context.addInitScript(() => {
      if (!localStorage.getItem("poly:lang")) {
        localStorage.setItem("poly:lang", "de");
      }
    });
    // hermetic: nothing but our own server (the page links Google Fonts, which only delays "load")
    await context.route(
      (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
      (route) => route.abort(),
    );
    // the app denies clipboard-read via Permissions-Policy: record what the copy button writes instead of reading it back
    await context.addInitScript(() => {
      const clip = navigator.clipboard as Clipboard | undefined;
      if (!clip) {
        return;
      }
      const write = clip.writeText.bind(clip);
      clip.writeText = (text: string) => {
        (window as unknown as { __copied?: string }).__copied = text;
        return write(text);
      };
    });
    // every scenario doubles as a CSP check: violations are collected and fail the scenario in dispose()
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        const w = window as unknown as { __csp?: string[] };
        (w.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.accept());
    page.on("pageerror", (e) => console.error(`[${name}] pageerror:`, e.message));
    const actor = new Actor(name, context, page, phone ? "phone" : this.layout);
    await actor.controlConnection();
    this.actors.set(name, actor);
    return actor;
  }

  allActors(): Actor[] {
    return [...this.actors.values()];
  }

  /** text of one of the theme's cards (by the short name used in the scenarios) */
  cardText(shortName: string): string {
    const text = this.theme.cardTexts[cardByName(shortName).id];
    if (!text) {
      throw new Error(`The card "${shortName}" does not exist in ${this.theme.name}.`);
    }
    return text;
  }

  get(name: string): Actor {
    const actor = this.actors.get(name);
    if (!actor) {
      throw new Error(`${name} has not opened a browser yet.`);
    }
    return actor;
  }

  async dispose(): Promise<void> {
    const violations: string[] = [];
    for (const a of this.actors.values()) {
      const found = await a.page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => []);
      violations.push(...found.map((v) => `${a.name}: ${v}`));
      await a.context.close();
    }
    await this.successor?.stop();
    await this.balancer?.close();
    await this.ownServer?.dispose();
    if (violations.length > 0) {
      throw new Error(`Content-Security-Policy violated:\n${violations.join("\n")}`);
    }
  }
}

export const test = base.extend<{ world: World }>({
  world: async (
    {
      browser,
      baseURL,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      reducedMotion,
      locale,
    },
    use,
  ) => {
    const contextOptions = {
      baseURL,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      reducedMotion,
      locale,
      permissions: ["clipboard-write"],
    };
    const world = new World(browser, contextOptions, isMobile ? "phone" : "desktop", baseURL ?? "");
    await use(world);
    await world.dispose();
  },
});

export const { Given, When, Then } = createBdd(test);
