import { afterEach, describe, expect, it } from "vitest";
import { LANGS, SECURITY_SECTORS, getTheme, headlineMsg, makeMsg } from "@poly/engine";
import { engineText, serverMessageText } from "../src/i18n/engine.ts";
import { formatPercent } from "../src/i18n/format.ts";
import { UI_KEYS, UI_MESSAGES } from "../src/i18n/index.ts";
import { setLang } from "../src/i18n/lang.ts";

afterEach(() => setLang("de"));

const ch = getTheme("ch");

describe("Wertpapiere: Texte", () => {
  it("never says Aktien or Börse in the German, English or Lozärnerdütsch UI", () => {
    const keys = UI_KEYS.filter((k) => k.startsWith("sec.") || k.includes("securities"));
    expect(keys.length).toBeGreaterThan(30);
    for (const lang of LANGS) {
      for (const key of keys) {
        expect(UI_MESSAGES[lang][key], `${lang}:${key}`).not.toMatch(
          /aktie|börse|boerse|stock market|\bstocks?\b/i,
        );
      }
    }
    expect(UI_MESSAGES.de["sec.title"]).toBe("Wertpapiere");
    expect(UI_MESSAGES.gsw["sec.title"]).toContain("Wärtpapier");
  });

  it("calls the securities Titres in French and Titoli in Italian", () => {
    expect(UI_MESSAGES.fr["sec.title"]).toBe("Titres");
    expect(UI_MESSAGES.it["sec.title"]).toBe("Titoli");
    expect(UI_MESSAGES.fr["sec.lock.many"]).toContain("{rounds}");
    expect(UI_MESSAGES.it["sec.lock.many"]).toContain("{rounds}");
  });

  it("writes Lozärnerdütsch for the buy and sell words", () => {
    expect(UI_MESSAGES.gsw["sec.buy"]).toBe("Chaufe");
    expect(UI_MESSAGES.gsw["sec.sellFor"]).toMatch(/verchaufe/i);
    expect(UI_MESSAGES.gsw["sec.lock.many"]).toContain("gsperrt");
    expect(UI_MESSAGES.gsw["sec.lock.many"]).toContain("{rounds}");
  });

  it("renders a headline with the company name of the current language", () => {
    for (const sector of SECURITY_SECTORS) {
      const company = ch.securities[0];
      if (!company) {
        throw new Error("no securities");
      }
      for (const kind of ["boom", "crash"] as const) {
        setLang("en");
        const text = engineText(
          headlineMsg({ secId: "ch-sbb", sector, kind, pct: 25, round: 2 }),
          ch,
        );
        expect(text).toContain("SBB Punctuality Ltd");
        expect(text).toContain("25");
        setLang("de");
        expect(
          engineText(headlineMsg({ secId: "ch-sbb", sector, kind, pct: 25, round: 2 }), ch),
        ).toContain("SBB Pünktlichkeits-AG");
      }
    }
  });

  it("renders securities log lines with the security name and money", () => {
    setLang("gsw");
    const text = engineText(
      makeMsg("log.secBought", { player: "p1", shares: 3, security: "ch-pilatus", amount: 240 }),
      ch,
      () => "Anna",
    );
    expect(text).toBe("Anna chauft 3 × Pilatus Bergbahne AG für CHF 240.");
  });

  it("translates the German lock-up error the server sends", () => {
    const de = "Noch 2 Runden gesperrt – nur bei Schulden mit Abschlag verkäuflich";
    expect(serverMessageText(de)).toBe(de);
    setLang("en");
    expect(serverMessageText(de)).toBe(
      "Locked for 2 more rounds – only sellable in debt, at a discount",
    );
    expect(serverMessageText("Wertpapiere sind in diesem Spiel nicht aktiv")).toBe(
      "Securities are not active in this game",
    );
  });

  it("formats percentages with one decimal per language", () => {
    expect(formatPercent(3.24, "de")).toBe("3.2");
    expect(formatPercent(0, "en")).toBe("0.0");
    expect(formatPercent(12.96, "gsw")).toBe("13.0");
  });
});
