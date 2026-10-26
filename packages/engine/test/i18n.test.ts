import { describe, expect, it } from "vitest";
import { CARDS } from "../src/cards.ts";
import type { CardDef } from "../src/cards.ts";
import { createGame, applyAction } from "../src/game.ts";
import {
  ENGINE_MESSAGES,
  ENGINE_MSG_KEYS,
  LANGS,
  PARAM_KINDS,
  formatMessage,
  makeMsg,
} from "../src/i18n/index.ts";
import { buildBlocker, buildBlockerMsg, sellBlockerMsg } from "../src/helpers.ts";
import { themeText } from "../src/theme-text.ts";
import { THEMES } from "../src/themes/index.ts";
import { DEFAULT_SETTINGS, GameError } from "../src/types.ts";
import type { NewPlayer } from "../src/types.ts";
import { defined } from "../src/guards.ts";

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => defined(m[1], "group")).sort();

describe("message catalogue", () => {
  it("has an entry in every language for for every key", () => {
    expect(ENGINE_MSG_KEYS.length).toBeGreaterThan(80);
    for (const lang of LANGS) {
      expect(Object.keys(ENGINE_MESSAGES[lang]).sort()).toEqual([...ENGINE_MSG_KEYS].sort());
      for (const key of ENGINE_MSG_KEYS) {
        expect(ENGINE_MESSAGES[lang][key].trim(), `${lang}:${key}`).not.toBe("");
      }
    }
  });

  it("uses the same placeholders in every language", () => {
    for (const key of ENGINE_MSG_KEYS) {
      const base = placeholders(ENGINE_MESSAGES.de[key]);
      for (const lang of LANGS) {
        expect(placeholders(ENGINE_MESSAGES[lang][key]), `${lang}:${key}`).toEqual(base);
      }
    }
  });

  it("knows the kind of every placeholder", () => {
    for (const key of ENGINE_MSG_KEYS) {
      for (const name of placeholders(ENGINE_MESSAGES.de[key])) {
        expect(Object.keys(PARAM_KINDS), `${key}:${name}`).toContain(name);
      }
    }
  });

  it("English, French and Italian are translated (gsw may still be a copy of German)", () => {
    for (const lang of ["en", "fr", "it"] as const) {
      const same = ENGINE_MSG_KEYS.filter(
        (k) => ENGINE_MESSAGES[lang][k] === ENGINE_MESSAGES.de[k],
      );
      expect(same, lang).toEqual(["err.generic"]);
    }
  });

  it("supports exactly de, en, gsw, fr, it", () => {
    expect([...LANGS].sort()).toEqual(["de", "en", "fr", "gsw", "it"]);
  });
});

describe("formatMessage", () => {
  const names = (id: string) => ({ p1: "Anna", p2: "Ben" })[id] ?? id;

  it("renders French and Italian", () => {
    const msg = makeMsg("log.bid", { player: "p1", amount: 30 });
    const money = (n: number) => `CHF ${n}`;
    expect(formatMessage("fr", msg, { player: names, money })).toBe("Anna enchérit à CHF 30.");
    expect(formatMessage("it", msg, { player: names, money })).toBe("Anna offre CHF 30.");
  });

  it("resolves players, tiles and money", () => {
    const msg = makeMsg("log.rentPaid", { player: "p1", amount: 1250, owner: "p2", tile: 7 });
    const resolve = { player: names, tile: (i: number) => `Bahnhofstrasse #${i}` };
    expect(formatMessage("de", msg, resolve)).toBe(
      "Anna zahlt 1'250 Miete an Ben (Bahnhofstrasse #7).",
    );
    expect(formatMessage("en", msg, resolve)).toBe(
      "Anna pays 1'250 rent to Ben (Bahnhofstrasse #7).",
    );
  });

  it("uses a custom money formatter and plain numbers", () => {
    const money = (n: number) => `CHF ${n}`;
    const bid = makeMsg("log.bid", { player: "p1", amount: 30 });
    expect(formatMessage("en", bid, { player: names, money })).toBe("Anna bids CHF 30.");
    const rolled = makeMsg("log.rolled", { player: "p2", a: 3, b: 4 });
    expect(formatMessage("de", rolled, { player: names })).toBe("Ben würfelt 3+4.");
  });

  it("leaves messages without params untouched and unknown params visible", () => {
    expect(formatMessage("de", makeMsg("log.gameOver"))).toBe("Spiel beendet.");
    expect(formatMessage("de", { key: "log.bid", params: {} })).toBe("{player} bietet {amount}.");
  });
});

describe("structured errors and blockers", () => {
  const players: NewPlayer[] = ["a", "b"].map((id) => ({
    id,
    name: id.toUpperCase(),
    color: "#fff",
    tokenId: "cow",
    controller: "human",
    botLevel: "normal",
  }));
  const game = () =>
    createGame("g", players, { ...DEFAULT_SETTINGS, turnTimeoutSec: 0 }, 1, 0).state;

  it("GameError carries code and params next to the German message", () => {
    const s = game();
    let error: unknown;
    try {
      applyAction(s, "b", { type: "roll" }, 1);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GameError);
    const err = error as GameError;
    expect(err.code).toBe("err.notYourTurn");
    expect(err.message).toBe("Du bist nicht dran");
    expect(formatMessage("en", { key: err.code, params: err.params })).toBe("It is not your turn");
  });

  it("legacy GameError(string) keeps working", () => {
    const err = new GameError("Irgendwas");
    expect(err.code).toBe("err.generic");
    expect(formatMessage("en", { key: err.code, params: err.params })).toBe("Irgendwas");
  });

  it("GameError.of renders the German message", () => {
    const err = GameError.of("err.playerCount", { min: 2, max: 8 });
    expect(err.message).toBe("2 bis 8 Spieler erforderlich");
    expect(err.params).toEqual({ min: 2, max: 8 });
  });

  it("blocker string variants equal the formatted structured variants", () => {
    const s = game();
    for (let tile = 0; tile < 52; tile++) {
      const m = buildBlockerMsg(s, "a", tile);
      expect(buildBlocker(s, "a", tile)).toBe(m ? formatMessage("de", m) : null);
    }
    expect(buildBlockerMsg(s, "a", 0)?.key).toBe("block.noStreet");
    expect(sellBlockerMsg(s, "a", 0)?.key).toBe("block.noStreet");
  });
});

describe("theme texts", () => {
  const nums = (text: string, tileNames: string[]): number[] => {
    let t = text;
    for (const n of tileNames) {
      t = t.split(n).join(" ");
    }
    return (t.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
  };
  const effectNumbers = (card: CardDef): number[] => {
    const e = card.effect;
    switch (e.kind) {
      case "cash":
        return [Math.abs(e.amount)];
      case "cash-from-each":
      case "cash-to-each":
        return [e.amount];
      case "repairs":
        return [e.perHouse, e.perHotel, e.perSkyscraper];
      case "move-by":
        return [Math.abs(e.steps)];
      case "move-to":
      case "nearest":
      case "go-to-jail":
      case "jail-card":
        return [];
    }
  };

  for (const theme of Object.values(THEMES)) {
    describe(theme.id, () => {
      const en = themeText(theme, "en");

      for (const lang of ["en", "gsw", "fr", "it"] as const) {
        it(`has ${lang} texts for all card ids, groups, decks, tokens and the country`, () => {
          const texts = defined(theme.i18n?.[lang]?.cardTexts, `${lang} cardTexts`);
          expect(Object.keys(texts).sort()).toEqual(CARDS.map((c) => c.id).sort());
          expect(defined(theme.i18n?.[lang]?.groupNames, "groupNames")).toHaveLength(
            theme.groupNames.length,
          );
          expect(Object.keys(defined(theme.i18n?.[lang]?.tokenNames, "tokenNames")).sort()).toEqual(
            theme.tokens.map((t) => t.id).sort(),
          );
          expect(themeText(theme, lang).deckNames.chance).not.toBe("");
        });

        it(`keeps ${lang} amounts identical to the German text and the card effect`, () => {
          const translated = themeText(theme, lang);
          for (const card of CARDS) {
            const de = defined(theme.cardTexts[card.id], card.id);
            const text = defined(translated.cardTexts[card.id], card.id);
            expect(nums(text, theme.tileNames), card.id).toEqual(nums(de, theme.tileNames));
            const found = nums(text, theme.tileNames);
            for (const n of effectNumbers(card)) {
              expect(found, `${card.id} mentions ${n}`).toContain(n);
            }
            expect(text, card.id).not.toBe(de);
          }
        });
      }

      it("uses an English country name", () => {
        expect(en.name).not.toBe(theme.name);
      });

      it("translates the country name into French and Italian (unless it is spelled the same)", () => {
        const fr = themeText(theme, "fr");
        const it_ = themeText(theme, "it");
        expect(fr.name).not.toBe("");
        expect(it_.name).not.toBe("");
        expect(new Set([fr.name, it_.name, en.name, theme.name]).size).toBeGreaterThan(2);
      });

      it("translates all deck and token names for fr and it", () => {
        for (const lang of ["fr", "it"] as const) {
          const text = themeText(theme, lang);
          expect(text.deckNames.chance, lang).not.toBe("");
          expect(text.deckNames.community, lang).not.toBe("");
          expect(
            text.tokens.map((t) => t.name),
            lang,
          ).not.toEqual(theme.tokens.map((t) => t.name));
        }
      });

      it("formats currency like the German text", () => {
        const money = defined(theme.cardTexts["ch-dividend"], "de").match(/(CHF 50|50 €)/)?.[0];
        for (const lang of ["en", "fr", "it"] as const) {
          const sample = defined(themeText(theme, lang).cardTexts["ch-dividend"], "ch-dividend");
          expect(sample, lang).toContain(defined(money, "money"));
        }
      });
    });
  }

  it("falls back to German for languages without texts", () => {
    const full = defined(THEMES["ch"], "ch");
    const theme = { ...full, i18n: { en: full.i18n?.en } };
    const gsw = themeText(theme, "gsw");
    expect(gsw.cardTexts).toEqual(theme.cardTexts);
    expect(gsw.groupNames).toEqual(theme.groupNames);
    expect(gsw.name).toBe(theme.name);
    expect(themeText(theme, "de").tokens).toEqual(theme.tokens);
    expect(themeText(theme, "en").tokens.map((t) => t.id)).toEqual(theme.tokens.map((t) => t.id));
  });
});
