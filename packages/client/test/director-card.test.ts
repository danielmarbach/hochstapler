// T04: reading a card must not stall the client's own event processing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEvent, PublicGameState } from "@poly/engine";
import type { GameScene } from "../src/three/scene.ts";

/** a scene that accepts everything and animates nothing */
const scene = new Proxy(
  {},
  {
    get: () => () => Promise.resolve(),
  },
) as unknown as GameScene;

function stateWith(cash: number): PublicGameState {
  return {
    settings: { themeId: "ch" },
    players: [{ id: "p1", name: "Anna", color: "#c8281e", cash, position: 0, inJail: false }],
    properties: {},
    dice: null,
  } as unknown as PublicGameState;
}

const cardEvent: GameEvent = {
  type: "card",
  playerId: "p1",
  deck: "chance",
  cardId: "ch-dividend",
};

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

describe("director and the card popup", () => {
  it("shows the card and applies the new state while the card is still open", async () => {
    const { director } = await import("../src/game/director.ts");
    const store = await import("../src/net/store.ts");
    const { set } = store;
    set({ state: stateWith(2000), you: "p1" });
    director.attach(scene);
    director.enqueue(stateWith(2050), [cardEvent]);
    await vi.advanceTimersByTimeAsync(50);
    // the money arrived although nobody dismissed the card
    expect(store.app.state?.players[0]?.cash).toBe(2050);
    expect(store.app.busy).toBe(false);
    expect(store.app.cardPopup).toMatchObject({ cardId: "ch-dividend", deck: "chance" });
    director.detach();
  });

  it("closes the card by itself after the reading time, or at once on Continue", async () => {
    const { director } = await import("../src/game/director.ts");
    const store = await import("../src/net/store.ts");
    const { set } = store;
    const { CARD_READING_MS, CARD_MAX_READING_MS } = await import("../src/game/card-hold.ts");
    set({ state: stateWith(2000), you: "p1" });
    director.attach(scene);
    director.enqueue(stateWith(2050), [cardEvent]);
    await vi.advanceTimersByTimeAsync(50);
    expect(store.app.cardPopup).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CARD_READING_MS - 100);
    expect(store.app.cardPopup).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CARD_MAX_READING_MS);
    expect(store.app.cardPopup).toBeNull();

    director.enqueue(stateWith(2100), [cardEvent]);
    await vi.advanceTimersByTimeAsync(50);
    expect(store.app.cardPopup).not.toBeNull();
    director.dismissCard();
    expect(store.app.cardPopup).toBeNull();
    director.detach();
  });

  it("hovering holds the card, but never beyond the maximum hold time", async () => {
    const { director } = await import("../src/game/director.ts");
    const store = await import("../src/net/store.ts");
    const { set } = store;
    const { CARD_MAX_HOLD_MS } = await import("../src/game/card-hold.ts");
    set({ state: stateWith(2000), you: "p1" });
    director.attach(scene);
    director.enqueue(stateWith(2050), [cardEvent]);
    await vi.advanceTimersByTimeAsync(50);
    director.holdCard();
    await vi.advanceTimersByTimeAsync(CARD_MAX_HOLD_MS - 1);
    expect(store.app.cardPopup).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.app.cardPopup).toBeNull();
    director.detach();
  });
});
