import { describe, expect, it } from "vitest";
import { ENGINE_MESSAGES, getTheme, LANGS, makeMsg } from "@poly/engine";
import { engineText, parseEngineError, serverMessageText } from "../src/i18n/engine.ts";
import { formatMoney, formatNumber, formatShortDate } from "../src/i18n/format.ts";
import { translate, UI_KEYS, UI_MESSAGES } from "../src/i18n/index.ts";
import { getLang, langFromBrowser, resolveInitialLang, setLang } from "../src/i18n/lang.ts";

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("UI dictionaries", () => {
  it("has a few hundred keys", () => {
    expect(UI_KEYS.length).toBeGreaterThan(250);
  });

  it("provides every key in every language, never empty", () => {
    for (const lang of LANGS) {
      expect(Object.keys(UI_MESSAGES[lang]).sort(), lang).toEqual([...UI_KEYS].sort());
      for (const key of UI_KEYS) {
        expect(UI_MESSAGES[lang][key].trim(), `${lang}:${key}`).not.toBe("");
      }
    }
  });

  it("uses the same placeholders in every language", () => {
    for (const key of UI_KEYS) {
      const base = placeholders(UI_MESSAGES.de[key]);
      for (const lang of LANGS) {
        expect(placeholders(UI_MESSAGES[lang][key]), `${lang}:${key}`).toEqual(base);
      }
    }
  });

  it('keeps English loanwords out of Luzernerdeutsch ("free verchaufe" must be "frei")', () => {
    for (const key of UI_KEYS) {
      const text = UI_MESSAGES.gsw[key].replace(/\{[^}]*\}/g, "");
      expect(text, `gsw:${key}`).not.toMatch(/\bfree\b/i);
    }
  });

  it("fills placeholders", () => {
    expect(translate("en", "home.botN", { n: 2 })).toBe("Bot 2");
    expect(translate("de", "turn.isOn", { name: "Anna" })).toBe("Anna ist am Zug");
    expect(translate("en", "turn.isOn", { name: "Anna" })).toBe("Anna's turn");
    expect(translate("fr", "turn.isOn", { name: "Anna" })).toContain("Anna");
    expect(translate("it", "turn.isOn", { name: "Anna" })).toContain("Anna");
  });
});

describe("initial language", () => {
  it("maps de*/gsw* to German, fr* to French, it* to Italian, everything else to English, never to gsw", () => {
    expect(langFromBrowser("de-CH")).toBe("de");
    expect(langFromBrowser("de")).toBe("de");
    expect(langFromBrowser("gsw-CH")).toBe("de");
    expect(langFromBrowser("en-US")).toBe("en");
    expect(langFromBrowser("fr-FR")).toBe("fr");
    expect(langFromBrowser("fr")).toBe("fr");
    expect(langFromBrowser("FR-CH")).toBe("fr");
    expect(langFromBrowser("it-IT")).toBe("it");
    expect(langFromBrowser("it-CH")).toBe("it");
    expect(langFromBrowser("es-ES")).toBe("en");
    expect(langFromBrowser(undefined)).toBe("de");
  });

  it("prefers the stored choice, including gsw", () => {
    expect(resolveInitialLang("gsw", "en-US")).toBe("gsw");
    expect(resolveInitialLang("en", "de-CH")).toBe("en");
    expect(resolveInitialLang("fr", "de-CH")).toBe("fr");
    expect(resolveInitialLang("it", "en-US")).toBe("it");
    expect(resolveInitialLang(null, "fr-CH")).toBe("fr");
    expect(resolveInitialLang("klingon", "en-US")).toBe("en");
    expect(resolveInitialLang(null, "de-CH")).toBe("de");
  });
});

describe("persisting the language", () => {
  it("writes the choice to localStorage even when it equals the current language", () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    try {
      setLang("de");
      store.clear();
      setLang("de");
      expect(store.get("poly:lang")).toBe("de");
      setLang("gsw");
      expect(store.get("poly:lang")).toBe("gsw");
    } finally {
      setLang("de");
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("number, money and date formatting", () => {
  const ch = getTheme("ch");
  const fr = getTheme("fr");

  it("groups thousands per locale and keeps the theme currency", () => {
    expect(formatNumber(1250, "de")).toBe("1'250");
    expect(formatNumber(1250, "gsw")).toBe("1'250");
    expect(formatNumber(1250, "en")).toBe("1,250");
    expect(formatNumber(1250, "fr")).toBe("1\u00a0250");
    expect(formatNumber(1250, "it")).toBe("1'250");
    expect(formatNumber(999, "it")).toBe("999");
    expect(formatMoney(fr, 1250, "fr")).toBe(`1\u00a0250 ${fr.currency.symbol}`);
    expect(formatMoney(ch, -1250, "it")).toBe(`-${ch.currency.symbol} 1'250`);
    expect(formatMoney(ch, 1250, "de")).toBe(`${ch.currency.symbol} 1'250`);
    expect(formatMoney(fr, -1250, "en")).toBe(`-1,250 ${fr.currency.symbol}`);
  });

  it("formats dates per locale", () => {
    const at = new Date(Date.UTC(2026, 9, 24, 12));
    expect(formatShortDate(at, "de")).toBe("24.10.26");
    expect(formatShortDate(at, "en")).toBe("24/10/26");
    expect(formatShortDate(at, "fr")).toBe("24.10.26");
    expect(formatShortDate(at, "it")).toBe("24.10.26");
  });
});

describe("engine messages", () => {
  const ch = getTheme("ch");

  it("renders log messages with names, themed tiles and money in the current language", () => {
    const msg = makeMsg("log.bought", { player: "p1", tile: 1, amount: 1250 });
    const names = (id: string) => (id === "p1" ? "Anna" : undefined);
    setLang("en");
    const en = engineText(msg, ch, names);
    expect(en).toContain("Anna");
    expect(en).toContain(ch.tileNames[1]);
    expect(en).toContain("1,250");
    setLang("de");
    expect(engineText(msg, ch, names)).toContain("1'250");
    expect(getLang()).toBe("de");
  });

  it("maps German error texts back to their catalogue entry", () => {
    expect(parseEngineError("Zu wenig Geld")).toEqual({ key: "err.notEnoughCash", params: {} });
    expect(parseEngineError("2 bis 8 Spieler erforderlich")).toEqual({
      key: "err.playerCount",
      params: { min: "2", max: "8" },
    });
    expect(parseEngineError("etwas ganz anderes")).toBeNull();
  });

  it("translates engine and server messages, falls back to the received text", () => {
    setLang("en");
    expect(serverMessageText("Zu wenig Geld")).toBe(ENGINE_MESSAGES.en["err.notEnoughCash"]);
    expect(serverMessageText("Das Spiel ist voll.")).toBe("The game is full.");
    expect(serverMessageText("Something unexpected")).toBe("Something unexpected");
    setLang("de");
    expect(serverMessageText("Zu wenig Geld")).toBe("Zu wenig Geld");
  });
});

describe("language names", () => {
  it("shows every language in its own language, in every dictionary", () => {
    for (const lang of LANGS) {
      expect(UI_MESSAGES[lang]["lang.fr"]).toBe("Français");
      expect(UI_MESSAGES[lang]["lang.it"]).toBe("Italiano");
      expect(UI_MESSAGES[lang]["lang.short.fr"]).toBe("FR");
      expect(UI_MESSAGES[lang]["lang.short.it"]).toBe("IT");
    }
  });

  it("offers de, en, gsw, fr, it", () => {
    expect([...LANGS].sort()).toEqual(["de", "en", "fr", "gsw", "it"]);
  });

  it("does not leave French or Italian as a copy of English or German", () => {
    for (const lang of ["fr", "it"] as const) {
      const same = UI_KEYS.filter(
        (k) =>
          UI_MESSAGES[lang][k] === UI_MESSAGES.en[k] || UI_MESSAGES[lang][k] === UI_MESSAGES.de[k],
      );
      // short words that are identical across languages (names, "Bank", "Chat", ...) are fine
      expect(same.length, `${lang}: ${same.join(", ")}`).toBeLessThan(40);
    }
  });
});
