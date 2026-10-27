// Show-off mode (Protzmodus, docs/DESIGN.md #93): loan dialog texts, numbers and the toast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LANGS, createGame } from "@poly/engine";
import type { GameEvent, GameState, PublicGameState } from "@poly/engine";
import type { GameScene } from "../src/three/scene.ts";
import { UI_MESSAGES } from "../src/i18n/index.ts";
import { setLang } from "../src/i18n/lang.ts";
import { breakdownLines } from "../src/game/results.ts";
import {
  clampAmount,
  lenderText,
  loanBadge,
  loanView,
  rateNote,
  rateText,
} from "../src/ui/loans.ts";

afterEach(() => setLang("de"));

function game(themeId = "ch"): GameState {
  return createGame(
    "g",
    ["Anna", "Ben", "Cla"].map((name, i) => ({
      id: `p${i}`,
      name,
      color: "#fff",
      tokenId: `t${i}`,
      controller: "human" as const,
      botLevel: "normal" as const,
    })),
    { ...DEFAULT_SETTINGS, themeId, loans: true },
    1,
    1000,
  ).state;
}

function player(s: GameState, id: string) {
  const p = s.players.find((x) => x.id === id);
  if (!p) {
    throw new Error(id);
  }
  return p;
}

describe("loan dialog: numbers from the engine", () => {
  it("shows the room, the rate the bank would lock and the interest due", () => {
    const s = game();
    player(s, "p0").cash = 500;
    player(s, "p2").cash = 6000;
    player(s, "p0").loans = [{ amount: 300, ratePct: 8 }];
    const v = loanView(s, player(s, "p0"));
    expect(v).toMatchObject({
      debt: 300,
      due: 24,
      limit: 1000,
      room: 700,
      ratePct: 4,
      averagePct: 8,
      turnOk: true,
      maxRepay: 300,
      step: 100,
    });
    expect(loanView(s, player(s, "p2")).ratePct).toBe(25);
    expect(loanView(s, player(s, "p1")).turnOk).toBe(false);
  });

  it("repayment is bounded by the cash on the step grid", () => {
    const s = game();
    player(s, "p0").loans = [{ amount: 800, ratePct: 8 }];
    player(s, "p0").cash = 450;
    expect(loanView(s, player(s, "p0")).maxRepay).toBe(400);
  });

  it("keeps stepper values on the step grid inside the range", () => {
    expect(clampAmount(0, 700)).toBe(100);
    expect(clampAmount(750, 700)).toBe(700);
    expect(clampAmount(260, 700)).toBe(300);
    expect(clampAmount(300, 50)).toBe(0);
  });
});

describe("loan dialog: texts", () => {
  it("names the theme's lender and the rate before confirming", () => {
    const s = game();
    expect(lenderText(s, 1000, "de")).toBe(
      "Der Privatbankier am Paradeplatz leiht dir bis zu CHF 1'000. Hauptsache, du siehst reich aus.",
    );
    expect(rateText(18, "de")).toBe("Die Bank verlangt von dir 18 % pro Runde.");
    expect(rateText(8, "en")).toBe("The bank charges you 8 % per round.");
    expect(lenderText(game("de"), 500, "en")).toContain("Frankfurt");
    expect(lenderText(game("fr"), 500, "fr")).toContain("place Vendôme");
    expect(lenderText(game("it"), 500, "it")).toContain("Piazza Affari");
    expect(rateNote("de")).toContain("4 %");
    expect(rateNote("de")).toContain("25 %");
  });

  it("has every loan text in all five languages, with the same placeholders", () => {
    const keys = Object.keys(UI_MESSAGES.de).filter(
      (k) => k.startsWith("loan.") || k.includes("Loan") || k.includes(".loan"),
    );
    expect(keys.length).toBeGreaterThan(15);
    for (const lang of LANGS) {
      for (const key of keys) {
        const text = (UI_MESSAGES[lang] as Record<string, string>)[key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        const holes = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(holes(text ?? ""), `${lang} ${key}`).toEqual(
          holes((UI_MESSAGES.de as Record<string, string>)[key] ?? ""),
        );
      }
    }
  });

  it("shows the debt and the average rate on the player card", () => {
    const s = game();
    expect(loanBadge(s, player(s, "p0"), "de")).toBeNull();
    player(s, "p0").loans = [
      { amount: 100, ratePct: 25 },
      { amount: 300, ratePct: 5 },
    ];
    expect(loanBadge(s, player(s, "p0"), "de")).toBe("Kredit CHF 400 · 10 %");
    expect(loanBadge(s, player(s, "p0"), "en")).toBe("Loan CHF 400 · 10 %");
  });

  it("adds the loans line to the results breakdown only in show-off games", () => {
    const base = {
      playerId: "p0",
      rank: 1,
      bankrupt: false,
      cash: 100,
      properties: 0,
      buildings: 0,
      mortgages: 0,
      total: 100,
    };
    expect(breakdownLines(base).map(([k]) => k)).not.toContain("results.loans");
    expect(breakdownLines({ ...base, loans: -300, total: -200 })).toContainEqual([
      "results.loans",
      -300,
    ]);
  });
});

describe("loan toast", () => {
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

  it("announces loans and repayments to everybody", async () => {
    const { director } = await import("../src/game/director.ts");
    const store = await import("../src/net/store.ts");
    store.set({ state, you: "p2" });
    director.attach(scene);
    const events: GameEvent[] = [
      { type: "loan", playerId: "p1", amount: 300, ratePct: 8 },
      { type: "loan", playerId: "p1", amount: -100, ratePct: 8 },
    ];
    director.enqueue(state, events);
    await vi.advanceTimersByTimeAsync(200);
    const texts = store.app.toasts.map((x) => x.text);
    expect(texts).toEqual([
      "Anna pumpt sich CHF 300 bei der Bank (8 % pro Runde)",
      "Anna zahlt CHF 100 Kredit zurück",
    ]);
    director.detach();
  });
});
