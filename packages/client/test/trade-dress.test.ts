import { describe, expect, it } from "vitest";
import { LANGS } from "@poly/engine";
import { UI_MESSAGES } from "../src/i18n/index.ts";
import {
  BANNED_DECK_LABELS,
  BANNED_EVERYWHERE,
  bannedHits,
} from "../../engine/test/banned-terms.ts";

describe("trade dress: UI texts (docs/DESIGN.md #87)", () => {
  for (const lang of LANGS) {
    it(`has no banned trade-dress term in the ${lang} dictionary`, () => {
      for (const [key, value] of Object.entries(UI_MESSAGES[lang])) {
        expect(bannedHits(value, BANNED_EVERYWHERE), `${lang}:${key}: ${value}`).toEqual([]);
      }
    });

    it(`labels the ${lang} deck spaces without the edition names`, () => {
      for (const key of ["kind.chance", "kind.community"] as const) {
        const value = UI_MESSAGES[lang][key];
        expect(bannedHits(value, BANNED_DECK_LABELS), `${lang}:${key}: ${value}`).toEqual([]);
      }
    });
  }
});
