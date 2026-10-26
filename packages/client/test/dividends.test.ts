// Dividends in the securities panel (docs/DESIGN.md #83): display formatting, texts, toast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIVIDEND_DECAY_START_ROUND,
  DEFAULT_SETTINGS,
  LANGS,
  createGame,
  currentYieldPermille,
  dividendFloorRound,
} from "@poly/engine";
import type { GameEvent, PublicGameState } from "@poly/engine";
import type { GameScene } from "../src/three/scene.ts";
import { UI_MESSAGES } from "../src/i18n/index.ts";
import { setLang } from "../src/i18n/lang.ts";
import { decayHint, dividendSummary, yieldPermilleText } from "../src/ui/dividends.ts";

afterEach(() => setLang("de"));

function game(over: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const s = createGame(
    "g",
    [
      {
        id: "p0",
        name: "Anna",
        color: "#fff",
        tokenId: "a",
        controller: "human",
        botLevel: "normal",
      },
      {
        id: "p1",
        name: "Ben",
        color: "#000",
        tokenId: "b",
        controller: "human",
        botLevel: "normal",
      },
    ],
    { ...DEFAULT_SETTINGS, securities: true, ...over },
    1,
    1000,
  ).state;
  const p = s.players[0];
  if (p) {
    p.holdings = [{ secId: "ch-gotthard", shares: 10, buyPrice: 70, boughtRound: 1 }];
  }
  return s;
}

describe("Dividenden: Anzeige", () => {
  it("formats the yield per language with one decimal, or says there is none", () => {
    setLang("de");
    expect(yieldPermilleText(22, "de")).toBe("Dividende 2.2 % pro Runde");
    expect(yieldPermilleText(22, "en")).toBe("Dividend 2.2 % per round");
    expect(yieldPermilleText(30, "fr")).toBe("Dividende 3,0 % par tour");
    expect(yieldPermilleText(0, "de")).toBe("keine Dividende");
    expect(yieldPermilleText(0, "en")).toBe("no dividend");
    expect(yieldPermilleText(0, "it")).toBe("nessun dividendo");
  });

  it("summarises the expected dividend and the total for a player", () => {
    const s = game();
    const p = s.players[0];
    if (!p) {
      throw new Error("setup");
    }
    p.dividends = 44;
    expect(dividendSummary(s, p)).toEqual({ on: true, next: 21, total: 44 });
  });

  it("is off without the setting or without the mode", () => {
    const off = game({ securitiesDividends: false });
    expect(dividendSummary(off, off.players[0]!)).toEqual({ on: false, next: 0, total: 0 });
    const plain = game({ securities: false });
    expect(dividendSummary(plain, plain.players[0]!).on).toBe(false);
  });
});

describe("Dividenden: Rückgang über die Runden", () => {
  const withRound = (round: number) => {
    const s = game();
    s.round = round;
    return s;
  };

  it("announces the decay from the start round on, in every language", () => {
    const s = withRound(3);
    expect(decayHint(s, "de")).toBe(
      `Die Dividende sinkt ab Runde ${DIVIDEND_DECAY_START_ROUND} schrittweise; letzte Zahlung in Runde ${dividendFloorRound() - 1}.`,
    );
    for (const lang of LANGS) {
      const hint = decayHint(s, lang);
      expect(hint, lang).toContain(String(DIVIDEND_DECAY_START_ROUND));
      expect(hint, lang).toContain(String(dividendFloorRound() - 1));
    }
  });

  it("shows the remaining share while the dividend decays, and that it has ended", () => {
    const decaying = decayHint(withRound(DIVIDEND_DECAY_START_ROUND + 1), "en");
    expect(decaying).toMatch(/shrinking/);
    expect(decaying).toMatch(/\d+ %/);
    expect(decayHint(withRound(dividendFloorRound()), "en")).toBe("Dividends have run out.");
    expect(decayHint(withRound(dividendFloorRound() + 40), "de")).toBe(
      "Die Dividenden sind ausgelaufen.",
    );
  });

  it("is empty when dividends are off", () => {
    expect(decayHint(game({ securitiesDividends: false }), "de")).toBe("");
  });

  it("the yield text of the price list follows the round (round-aware)", () => {
    const early = withRound(1);
    const late = withRound(dividendFloorRound());
    expect(currentYieldPermille(early, "ch-gotthard")).toBeGreaterThan(0);
    expect(currentYieldPermille(late, "ch-gotthard")).toBe(0);
    expect(yieldPermilleText(currentYieldPermille(late, "ch-gotthard"), "de")).toBe(
      "keine Dividende",
    );
  });
});

describe("Dividenden: Texte", () => {
  const KEYS = [
    "sec.yield",
    "sec.yield.none",
    "sec.div.next",
    "sec.div.total",
    "sec.div.off",
    "sec.div.rules",
    "sec.div.decay",
    "sec.div.decaying",
    "sec.div.ended",
    "toast.dividend",
    "home.rule.dividends",
    "home.rule.dividends.sub",
    "lobby.dividends.on",
    "lobby.dividends.off",
  ] as const;

  it("exist in all five languages and keep the placeholders", () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(UI_MESSAGES[lang][key].trim(), `${lang}:${key}`).not.toBe("");
      }
      expect(UI_MESSAGES[lang]["sec.yield"]).toContain("{pct}");
      expect(UI_MESSAGES[lang]["sec.div.rules"]).toContain("{pct}");
      expect(UI_MESSAGES[lang]["toast.dividend"]).toContain("{amount}");
      expect(UI_MESSAGES[lang]["sec.div.decay"]).toContain("{round}");
      expect(UI_MESSAGES[lang]["sec.div.decay"]).toContain("{last}");
      expect(UI_MESSAGES[lang]["sec.div.decaying"]).toContain("{pct}");
      expect(UI_MESSAGES[lang]["sec.div.decaying"]).toContain("{last}");
    }
  });

  it("never says Aktien or Börse", () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(UI_MESSAGES[lang][key], `${lang}:${key}`).not.toMatch(
          /aktie|börse|boerse|stock market|\bstocks?\b/i,
        );
      }
    }
  });

  it("writes Lozärnerdütsch without English loanwords", () => {
    expect(UI_MESSAGES.gsw["sec.yield.none"]).toBe("kei Dividände");
    expect(UI_MESSAGES.gsw["sec.div.rules"]).toContain("Wärtpapier");
  });
});

describe("Dividenden: Toast nur für den Empfänger", () => {
  const scene = new Proxy({}, { get: () => () => Promise.resolve() }) as unknown as GameScene;
  const state = {
    settings: { themeId: "ch" },
    players: [
      { id: "p1", name: "Anna", color: "#c8281e", cash: 2000, position: 0, inJail: false },
      { id: "p2", name: "Ben", color: "#2a6fdb", cash: 2000, position: 0, inJail: false },
    ],
    properties: {},
    dice: null,
  } as unknown as PublicGameState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubGlobal("window", {
      setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
      clearTimeout: (id?: number) => globalThis.clearTimeout(id),
      matchMedia: () => ({ matches: true, addEventListener: () => undefined }),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("toasts the receiving player only", async () => {
    const { director } = await import("../src/game/director.ts");
    const store = await import("../src/net/store.ts");
    store.set({ state, you: "p1" });
    director.attach(scene);
    const own: GameEvent = { type: "dividend", playerId: "p1", amount: 18, round: 3 };
    const other: GameEvent = { type: "dividend", playerId: "p2", amount: 30, round: 3 };
    director.enqueue(state, [own, other]);
    await vi.advanceTimersByTimeAsync(200);
    const texts = store.app.toasts.map((x) => x.text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/^Dividende: \+.*18/);
    director.detach();
  });
});
