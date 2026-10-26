import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_REJECT_REASONS,
  LANGS,
  QUICK_CHAT_IDS,
  QUICK_EMOJI_IDS,
  isQuickEmoji,
  quickEmoji,
} from "@poly/engine";
import { setLang } from "../src/i18n/lang.ts";
import { UI_MESSAGES } from "../src/i18n/index.ts";
import { CHAT_MODE_LABEL, quickText, refusedText } from "../src/ui/ChatControls.tsx";

afterEach(() => setLang("de"));

describe("chat texts (docs/DESIGN.md #69)", () => {
  it("every quick message reads in every language; emojis are the same everywhere", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const id of QUICK_CHAT_IDS) {
        const text = quickText(id);
        expect(text.trim(), `${lang}:${id}`).not.toBe("");
        if (isQuickEmoji(id)) expect(text).toBe(quickEmoji(id));
        else expect(text).not.toMatch(/^chat\./);
      }
    }
  });

  it("the Luzernerdeutsch phrases differ from standard German where the words differ", () => {
    expect(UI_MESSAGES.gsw["chat.quick.lucky"]).toBe("Glück gha!");
    expect(UI_MESSAGES.gsw["chat.quick.gg"]).not.toBe(UI_MESSAGES.de["chat.quick.gg"]);
    expect(UI_MESSAGES.de["chat.quick.lucky"]).toBe("Glück gehabt!");
    expect(UI_MESSAGES.en["chat.quick.gg"]).toBe("Well played!");
  });

  it("every refusal has a hint in every language and a mode label exists for every mode", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const reason of CHAT_REJECT_REASONS) {
        expect(refusedText(reason).trim(), `${lang}:${reason}`).not.toBe("");
      }
    }
    expect(Object.keys(CHAT_MODE_LABEL).sort()).toEqual(["free", "off", "quick"]);
    expect(QUICK_EMOJI_IDS.length).toBeGreaterThanOrEqual(5);
    expect(QUICK_CHAT_IDS.length).toBe(10 + QUICK_EMOJI_IDS.length);
  });

  it("states the length limit in the hint", () => {
    setLang("en");
    expect(refusedText("length")).toContain("200");
  });
});
