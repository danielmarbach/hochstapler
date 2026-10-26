import { describe, expect, it } from "vitest";
import { CARDS } from "../src/cards.ts";
import { ENGINE_MESSAGES, LANGS } from "../src/i18n/index.ts";
import { themeText } from "../src/theme-text.ts";
import { THEMES } from "../src/themes/index.ts";
import {
  BANNED_DECK_LABELS,
  BANNED_EVERYWHERE,
  BANNED_TILE_NAMES,
  bannedHits,
} from "./banned-terms.ts";
import { defined } from "../src/guards.ts";

describe("trade dress: no names or card formulas of the classic property-trading game (docs/DESIGN.md #87)", () => {
  it("the guard itself catches the known offenders", () => {
    for (const bad of [
      "Gehe direkt ins Gefängnis. Gehe nicht über Los.",
      "Frei Parken",
      "Parc Gratuit",
      "Caisse de Communauté",
      "Do not pass Go",
      "Free Parking",
      "Non passare dal Via!",
      "Behalte diese Karte, bis du sie brauchst.",
    ]) {
      expect(bannedHits(bad, BANNED_EVERYWHERE), bad).not.toEqual([]);
    }
    for (const bad of [
      "Chance",
      "Imprevisti",
      "Probabilità",
      "Community",
      "Ereignis",
      "Gemeinschaft",
    ]) {
      expect(bannedHits(bad, BANNED_DECK_LABELS), bad).not.toEqual([]);
    }
    expect(bannedHits("Quelle chance !", BANNED_EVERYWHERE)).toEqual([]);
  });

  for (const theme of Object.values(THEMES)) {
    describe(`theme ${theme.id}`, () => {
      it("uses no banned corner names or other tile names", () => {
        for (const name of theme.tileNames) {
          expect(bannedHits(name, BANNED_TILE_NAMES), name).toEqual([]);
          expect(bannedHits(name, BANNED_EVERYWHERE), name).toEqual([]);
          expect(bannedHits(name, BANNED_DECK_LABELS), name).toEqual([]);
        }
      });

      for (const lang of LANGS) {
        it(`has no banned term in any ${lang} text`, () => {
          const text = themeText(theme, lang);
          const all: [string, string][] = [
            ["name", text.name],
            ["deck.chance", text.deckNames.chance],
            ["deck.community", text.deckNames.community],
            ...text.groupNames.map((n, i): [string, string] => [`group${i}`, n]),
            ...text.tokens.map((t): [string, string] => [`token.${t.id}`, t.name]),
            ...Object.entries(text.cardTexts),
          ];
          for (const [key, value] of all) {
            expect(
              bannedHits(value, BANNED_EVERYWHERE),
              `${theme.id}/${lang}/${key}: ${value}`,
            ).toEqual([]);
          }
          for (const key of ["deck.chance", "deck.community"]) {
            const value = defined(
              all.find(([k]) => k === key),
              key,
            )[1];
            expect(bannedHits(value, BANNED_DECK_LABELS), `${theme.id}/${lang}/${key}`).toEqual([]);
          }
        });
      }

      it("covers every card id in the French and Italian texts", () => {
        for (const lang of ["fr", "it"] as const) {
          expect(Object.keys(themeText(theme, lang).cardTexts).sort()).toEqual(
            CARDS.map((c) => c.id).sort(),
          );
        }
      });

      it("keeps German words out of the French and Italian card texts", () => {
        const german =
          /\b(Gehe|Rücke|Zahle|Ziehe|Kommst|Behalte|Du|Dir|Dein|Deine|Deinen|Dich|Erhältst|Mitspieler|jedem|jemandem|und|nicht|oder|Felder)\b/;
        for (const lang of ["fr", "it"] as const) {
          for (const [id, value] of Object.entries(themeText(theme, lang).cardTexts)) {
            expect(german.test(value), `${theme.id}/${lang}/${id}: ${value}`).toBe(false);
          }
        }
      });
    });
  }

  for (const lang of LANGS) {
    it(`has no banned term in the ${lang} engine messages`, () => {
      for (const [key, value] of Object.entries(ENGINE_MESSAGES[lang])) {
        expect(bannedHits(value, BANNED_EVERYWHERE), `${lang}:${key}: ${value}`).toEqual([]);
      }
    });
  }
});
