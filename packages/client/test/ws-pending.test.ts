// T02: nothing is silently dropped, nothing is queued for later, and the UI knows what is in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameAction } from "@poly/engine";

class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const roll: GameAction = { type: "roll" };

async function load() {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", {
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (id?: number) => globalThis.clearTimeout(id),
    setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a),
    clearInterval: (id?: number) => globalThis.clearInterval(id),
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
  });
  vi.stubGlobal("location", { protocol: "http:", host: "localhost", hash: "" });
  const ws = await import("../src/net/ws.ts");
  const store = await import("../src/net/store.ts");
  return { ws, store };
}

function actions(sock: FakeSocket): unknown[] {
  return sock.sent.filter((m) => (m as { t: string }).t === "action");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sending actions", () => {
  it("refuses visibly while there is no connection and queues nothing", async () => {
    const { ws, store } = await load();
    expect(ws.sendAction(roll)).toBe(false);
    expect(store.app.pending).toBeNull();
    expect(store.app.actionError).not.toBeNull();
    expect(store.app.toasts.at(-1)?.kind).toBe("bad");
    // the socket comes up later: the refused action must not appear
    ws.connect("g1");
    const sock = FakeSocket.all[0];
    sock?.open();
    expect(sock && actions(sock)).toEqual([]);
    ws.disconnect();
  });

  it("marks the action as pending until the server answers with an update", async () => {
    const { ws, store } = await load();
    ws.connect("g1");
    const sock = FakeSocket.all[0];
    sock?.open();
    expect(ws.sendAction(roll)).toBe(true);
    expect(store.app.pending).toBe("roll");
    expect(store.app.actionError).toBeNull();
    expect(sock && actions(sock)).toEqual([{ t: "action", action: roll }]);
    sock?.receive({ t: "update", state: { settings: { themeId: "ch" }, players: [] }, events: [] });
    expect(store.app.pending).toBeNull();
    ws.disconnect();
  });

  it("a refusal clears the pending mark and keeps the reason for the form that sent it", async () => {
    const { ws, store } = await load();
    ws.connect("g1");
    const sock = FakeSocket.all[0];
    sock?.open();
    ws.sendAction({ type: "end-turn" });
    sock?.receive({ t: "error", message: "Du bist nicht am Zug." });
    expect(store.app.pending).toBeNull();
    expect(store.app.actionError).toBe(store.app.lastError);
    expect(store.app.actionError).toBeTruthy();
    // the next send starts clean
    ws.sendAction({ type: "end-turn" });
    expect(store.app.actionError).toBeNull();
    ws.disconnect();
  });

  it("stops waiting when the server never answers", async () => {
    const { ws, store } = await load();
    ws.connect("g1");
    FakeSocket.all[0]?.open();
    ws.sendAction(roll);
    vi.advanceTimersByTime(ws.PENDING_TIMEOUT_MS - 1);
    expect(store.app.pending).toBe("roll");
    vi.advanceTimersByTime(1);
    expect(store.app.pending).toBeNull();
    expect(store.app.actionError).not.toBeNull();
    ws.disconnect();
  });

  it("never replays an action in flight after a reconnect (no double apply)", async () => {
    const { ws, store } = await load();
    ws.connect("g1");
    const first = FakeSocket.all[0];
    first?.open();
    ws.sendAction(roll);
    first?.drop();
    expect(store.app.connected).toBe(false);
    expect(store.app.pending).toBeNull();
    vi.advanceTimersByTime(600);
    const second = FakeSocket.all[1];
    expect(second).toBeDefined();
    second?.open();
    expect(second?.sent.map((m) => (m as { t: string }).t)).toEqual(["hello"]);
    ws.disconnect();
  });

  it("chat is refused offline too, so the text can stay in the input", async () => {
    const { ws } = await load();
    expect(ws.sendChat("hi")).toBe(false);
    expect(ws.sendQuickChat("e-smile")).toBe(false);
    ws.connect("g1");
    FakeSocket.all[0]?.open();
    expect(ws.sendChat("hi")).toBe(true);
    ws.disconnect();
  });
});

describe("unread chat", () => {
  it("counts the messages received on this connection against the ones seen", async () => {
    const { ws, store } = await load();
    ws.connect("g1");
    const sock = FakeSocket.all[0];
    sock?.open();
    sock?.receive({ t: "chat", from: "p1", name: "Anna", text: "hi", at: 1 });
    sock?.receive({ t: "quick-chat", from: "p1", name: "Anna", id: "gg", at: 2 });
    expect(store.app.chatSeq).toBe(2);
    store.set({ chatReadSeq: 2 });
    sock?.receive({ t: "chat", from: "p1", name: "Anna", text: "again", at: 3 });
    expect(store.app.chatSeq - store.app.chatReadSeq).toBe(1);
    ws.disconnect();
  });
});
