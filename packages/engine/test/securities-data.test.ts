// Wertpapiere: theme data, zod contracts, state migration v1 -> v2 and bot behaviour.
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.ts";
import { applyBotAction, whoMustAct } from "../src/game.ts";
import { CURRENT_STATE_VERSION, migrateState } from "../src/migrations.ts";
import { CreateGameRequestSchema, GameActionSchema, GameSettingsSchema } from "../src/schemas.ts";
import { GameStateSchema } from "../src/state-schema.ts";
import { StoredLobbySchema } from "../src/stored.ts";
import { SECURITY_SECTORS } from "../src/securities.ts";
import { themeText } from "../src/theme-text.ts";
import { THEMES } from "../src/themes/index.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { GameState } from "../src/types.ts";
import { LANGS } from "../src/i18n/index.ts";
import { assertInvariants } from "./invariants.ts";
import { given } from "./scenario.ts";
import { mk } from "./util.ts";

const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("Wertpapiere: Theme-Daten", () => {
  for (const theme of Object.values(THEMES)) {
    it(`${theme.id}: six companies with valid sectors, prices and volatility`, () => {
      expect(theme.securities).toHaveLength(6);
      expect(new Set(theme.securities.map((c) => c.id)).size).toBe(6);
      expect(new Set(theme.securities.map((c) => c.name)).size).toBe(6);
      for (const c of theme.securities) {
        expect(c.id.startsWith(`${theme.id}-`)).toBe(true);
        expect(SECURITY_SECTORS).toContain(c.sector);
        expect(Number.isInteger(c.startPrice) && c.startPrice >= 20 && c.startPrice <= 200).toBe(
          true,
        );
        expect(c.volatility).toBeGreaterThanOrEqual(1);
        expect(c.volatility).toBeLessThanOrEqual(15);
      }
      // the joke companies are the wild ones
      expect(Math.max(...theme.securities.map((c) => c.volatility))).toBeGreaterThanOrEqual(14);
      expect(theme.securities.some((c) => c.sector === "rail")).toBe(true);
      expect(theme.securities.some((c) => c.sector === "tourism")).toBe(true);
      expect(theme.scenicGroups.length).toBeGreaterThan(0);
      for (const g of theme.scenicGroups) {
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThan(10);
      }
    });
  }

  it("resolves company names per language with a fallback to German", () => {
    const ch = THEMES["ch"];
    if (!ch) {
      throw new Error("no ch theme");
    }
    for (const lang of LANGS) {
      const names = themeText(ch, lang).securityNames;
      expect(Object.keys(names).sort()).toEqual(ch.securities.map((c) => c.id).sort());
      expect(Object.values(names).every((n) => n.length > 0)).toBe(true);
    }
    expect(themeText(ch, "en").securityNames["ch-sbb"]).toBe("SBB Punctuality Ltd");
    expect(themeText(ch, "en").securityNames["ch-pilatus"]).toBe("Pilatus Bergbahnen AG");
    expect(themeText(ch, "gsw").securityNames["ch-pilatus"]).toBe("Pilatus Bergbahne AG");
    expect(themeText(ch, "fr").securityNames["ch-sbb"]).toBe("CFF Ponctualité SA");
    expect(themeText(ch, "it").securityNames["ch-sbb"]).toBe("FFS Puntualità SA");
  });
});

describe("Wertpapiere: zod", () => {
  it("accepts the two new actions and rejects malformed ones", () => {
    expect(
      GameActionSchema.safeParse({ type: "buy-securities", secId: "ch-sbb", shares: 3 }).success,
    ).toBe(true);
    expect(
      GameActionSchema.safeParse({ type: "sell-securities", secId: "ch-sbb", lot: "all" }).success,
    ).toBe(true);
    expect(
      GameActionSchema.safeParse({ type: "sell-securities", secId: "ch-sbb", lot: 2 }).success,
    ).toBe(true);
    for (const bad of [
      { type: "buy-securities", secId: "ch-sbb", shares: 0 },
      { type: "buy-securities", secId: "ch-sbb", shares: 1.5 },
      { type: "buy-securities", secId: "", shares: 1 },
      { type: "buy-securities", shares: 1 },
      { type: "sell-securities", secId: "ch-sbb", lot: -1 },
      { type: "sell-securities", secId: "ch-sbb", lot: "some" },
      { type: "sell-securities", secId: "ch-sbb" },
    ]) {
      expect(GameActionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("validates the settings: lock-up 1-10, boolean mode, optional in a create request", () => {
    const ok = { ...DEFAULT_SETTINGS, securities: true, securitiesLockRounds: 10 };
    expect(GameSettingsSchema.safeParse(ok).success).toBe(true);
    expect(GameSettingsSchema.safeParse({ ...ok, securitiesLockRounds: 1 }).success).toBe(true);
    for (const lock of [0, 11, 2.5, -1]) {
      expect(GameSettingsSchema.safeParse({ ...ok, securitiesLockRounds: lock }).success).toBe(
        false,
      );
    }
    expect(GameSettingsSchema.safeParse({ ...ok, securities: "yes" }).success).toBe(false);
    expect(
      CreateGameRequestSchema.safeParse({
        hostName: "Anna",
        settings: {},
        bots: [],
        maxPlayers: 4,
      }).success,
    ).toBe(true);
    expect(
      CreateGameRequestSchema.safeParse({
        hostName: "Anna",
        settings: { securities: true, securitiesLockRounds: 4 },
        bots: [],
        maxPlayers: 4,
      }).success,
    ).toBe(true);
  });

  it("round-trips a state with a market and holdings through the state schema", () => {
    const s = given().securities().player("Anna").holds("ch-sbb", 3, 40, 1).build().state;
    expect(GameStateSchema.parse(asStored(s))).toEqual(s);
  });

  it("rejects broken markets and lots", () => {
    const s = mk(2, { securities: true });
    const bad = (mutate: (j: Record<string, any>) => void): boolean => {
      const j = asStored(s) as Record<string, any>;
      mutate(j);
      return GameStateSchema.safeParse(j).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((j) => (j["market"].prices["ch-sbb"] = 0))).toBe(false);
    expect(bad((j) => (j["market"].prices["ch-sbb"] = 2.5))).toBe(false);
    expect(bad((j) => (j["market"].history["ch-sbb"] = Array(21).fill(40)))).toBe(false);
    expect(
      bad(
        (j) =>
          (j["market"].headline = { secId: "x", sector: "oil", kind: "boom", pct: 20, round: 2 }),
      ),
    ).toBe(false);
    expect(
      bad(
        (j) =>
          (j["players"][0].holdings = [
            { secId: "ch-sbb", shares: 0, buyPrice: 5, boughtRound: 1 },
          ]),
      ),
    ).toBe(false);
    expect(bad((j) => (j["settings"].securitiesLockRounds = 11))).toBe(false);
    expect(bad((j) => delete j["settings"].securities)).toBe(false);
  });
});

describe("Migration v1 -> v2 (Wertpapiere)", () => {
  const v1State = (): Record<string, any> => {
    const j = asStored(mk(3)) as Record<string, any>;
    delete j["settings"].securities;
    delete j["settings"].securitiesLockRounds;
    delete j["settings"].securitiesDividends;
    return j;
  };

  it("is at least the second state version", () => {
    expect(CURRENT_STATE_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("v1 games get the mode off with the default lock-up, no market, and validate", () => {
    expect(GameStateSchema.safeParse(v1State()).success).toBe(false);
    const migrated = migrateState(v1State(), 1);
    expect(migrated.settings.securities).toBe(false);
    expect(migrated.settings.securitiesLockRounds).toBe(3);
    expect(migrated.market).toBeUndefined();
    expect(GameStateSchema.safeParse(asStored(migrated)).success).toBe(true);
    assertInvariants(migrated);
  });

  it("does not mutate its input and leaves a current state alone", () => {
    const input = v1State();
    const frozen = JSON.stringify(input);
    migrateState(input, 1);
    expect(JSON.stringify(input)).toBe(frozen);
    const v2 = mk(2, { securities: true, securitiesLockRounds: 7 });
    expect(migrateState(asStored(v2), CURRENT_STATE_VERSION)).toEqual(v2);
  });

  it("migrated v1 games keep playing (bots)", () => {
    let s: GameState = migrateState(v1State(), 1);
    for (let i = 0; i < 40 && s.status === "running"; i++) {
      const pid = whoMustAct(s)[0];
      const a = pid ? chooseBotAction(s, pid) : null;
      if (!pid || !a) {
        break;
      }
      s = applyBotAction(s, pid, a, 3000 + i).state;
      assertInvariants(s);
    }
    expect(s.version).toBeGreaterThan(0);
  });

  it("lobbies stored before the mode still load, with the mode off", () => {
    const lobby = {
      gameId: "g1",
      inviteCode: "ABC",
      status: "lobby",
      settings: (() => {
        const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
        delete s["securities"];
        delete s["securitiesLockRounds"];
        return s;
      })(),
      seats: [],
      maxPlayers: 4,
      createdAt: 1,
    };
    const parsed = StoredLobbySchema.parse(lobby);
    expect(parsed.settings.securities).toBe(false);
    expect(parsed.settings.securitiesLockRounds).toBe(3);
  });
});

describe("Migration v2 -> v3 (Dividenden)", () => {
  const v2State = (over: Record<string, unknown> = {}): Record<string, any> => {
    const j = asStored(mk(2, { securities: true, ...over })) as Record<string, any>;
    delete j["settings"].securitiesDividends;
    return j;
  };

  it("introduced the third state version", () => {
    expect(CURRENT_STATE_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("needs a step: a v2 state without the setting does not validate", () => {
    expect(GameStateSchema.safeParse(v2State()).success).toBe(false);
  });

  it("games that are already running keep their rules: dividends off, nothing else changes", () => {
    const input = v2State({ securitiesLockRounds: 6 });
    const frozen = JSON.stringify(input);
    const migrated = migrateState(input, 2);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(migrated.settings.securitiesDividends).toBe(false);
    expect(migrated.settings.securitiesLockRounds).toBe(6);
    expect(migrated.settings.securities).toBe(true);
    expect(migrated.market).toBeDefined();
    expect(GameStateSchema.safeParse(asStored(migrated)).success).toBe(true);
    assertInvariants(migrated);
  });

  it("lobbies stored before the dividends load with them on", () => {
    const settings = { ...DEFAULT_SETTINGS, securities: true } as Record<string, unknown>;
    delete settings["securitiesDividends"];
    const parsed = StoredLobbySchema.parse({
      gameId: "g1",
      inviteCode: "ABC",
      status: "lobby",
      settings,
      seats: [],
      maxPlayers: 4,
      createdAt: 1,
    });
    expect(parsed.settings.securitiesDividends).toBe(true);
  });

  it("validates the dividend total of a player (non-negative integer)", () => {
    const base = asStored(mk(2, { securities: true })) as Record<string, any>;
    base["players"][0].dividends = 12;
    expect(GameStateSchema.safeParse(base).success).toBe(true);
    base["players"][0].dividends = -1;
    expect(GameStateSchema.safeParse(base).success).toBe(false);
  });
});

describe("Wertpapiere: Bots", () => {
  const botTurn = (g: ReturnType<typeof given>) =>
    g.tweak((s) => {
      s.phase = { type: "await-end-turn", canRollAgain: false };
      s.dice = [1, 2];
    });

  it("invests part of its surplus (never more than a quarter) when rich", () => {
    const s = botTurn(
      given().players("Bot Heidi", "Ben").securities().player("Bot Heidi").cash(3000),
    ).build().state;
    const a = chooseBotAction(s, "p0");
    expect(a?.type).toBe("buy-securities");
    if (a?.type === "buy-securities") {
      const price = s.market?.prices[a.secId] ?? Infinity;
      // surplus = cash - (build reserve 250 + 400)
      expect(a.shares * price).toBeLessThanOrEqual(Math.floor(((3000 - 650) * 25) / 100));
      expect(a.shares).toBeGreaterThan(0);
    }
  });

  it("does not invest while the cash is below its reserve", () => {
    const s = botTurn(
      given().players("Bot Heidi", "Ben").securities().player("Bot Heidi").cash(600),
    ).build().state;
    expect(chooseBotAction(s, "p0")?.type).not.toBe("buy-securities");
  });

  it("does not invest in a game without the mode", () => {
    const s = botTurn(given().players("Bot Heidi", "Ben").player("Bot Heidi").cash(5000)).build()
      .state;
    expect(chooseBotAction(s, "p0")?.type).not.toMatch(/securities/);
  });

  it("buys at most once per round and diversifies", () => {
    let s = botTurn(
      given().players("Bot Heidi", "Ben").securities().player("Bot Heidi").cash(9000),
    ).build().state;
    const first = chooseBotAction(s, "p0");
    expect(first?.type).toBe("buy-securities");
    if (first?.type !== "buy-securities") {
      return;
    }
    s = applyBotAction(s, "p0", first, 2000).state;
    expect(chooseBotAction(s, "p0")?.type).not.toBe("buy-securities");
    // next round: the second purchase goes to another company
    s = { ...s, round: s.round + 1 };
    const second = chooseBotAction(s, "p0");
    expect(second?.type).toBe("buy-securities");
    if (second?.type === "buy-securities") {
      expect(second.secId).not.toBe(first.secId);
    }
  });

  it("takes profit on an unlocked lot but leaves locked and losing lots alone", () => {
    const profitable = botTurn(
      given()
        .players("Bot Heidi", "Ben")
        .securities(3)
        .round(5)
        .player("Bot Heidi")
        .cash(0)
        .holds("ch-pilatus", 5, 60, 1),
    ).build().state;
    expect(chooseBotAction(profitable, "p0")).toEqual({
      type: "sell-securities",
      secId: "ch-pilatus",
      lot: 0,
    });
    const locked = botTurn(
      given()
        .players("Bot Heidi", "Ben")
        .securities(3)
        .round(5)
        .player("Bot Heidi")
        .cash(300)
        .holds("ch-pilatus", 5, 60, 4),
    ).build().state;
    expect(chooseBotAction(locked, "p0")?.type).not.toBe("sell-securities");
    const losing = botTurn(
      given()
        .players("Bot Heidi", "Ben")
        .securities(3)
        .round(5)
        .player("Bot Heidi")
        .cash(900)
        .holds("ch-pilatus", 5, 120, 1),
    ).build().state;
    expect(chooseBotAction(losing, "p0")?.type).not.toBe("sell-securities");
  });

  it("sells an unlocked lot when cash runs low", () => {
    const s = botTurn(
      given()
        .players("Bot Heidi", "Ben")
        .securities(3)
        .round(5)
        .player("Bot Heidi")
        .cash(40)
        .holds("ch-pilatus", 5, 120, 1),
    ).build().state;
    expect(chooseBotAction(s, "p0")?.type).toBe("sell-securities");
  });

  it("bot-only games with securities play to the end of the limit and trade", () => {
    let s = mk(
      4,
      { securities: true, securitiesLockRounds: 2, turnTimeoutSec: 0, maxRounds: 25 },
      "bot",
    );
    let trades = 0;
    for (let i = 0; i < 6000 && s.status === "running"; i++) {
      const pid = whoMustAct(s)[0];
      const a = pid ? chooseBotAction(s, pid) : null;
      if (!pid || !a) {
        break;
      }
      const r = applyBotAction(s, pid, a, 3000 + i);
      trades += r.events.filter((e) => e.type === "securities-trade").length;
      s = r.state;
      assertInvariants(s);
    }
    expect(s.status).toBe("finished");
    expect(trades).toBeGreaterThan(0);
  });
});
