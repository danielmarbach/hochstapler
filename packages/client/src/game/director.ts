import { attempt } from "@poly/engine";
import { errorOnError } from "../safe.ts";
import {
  getTheme,
  headlineMsg,
  themeText,
  type GameEvent,
  type PublicGameState,
  type Theme,
} from "@poly/engine";
import type { GameScene } from "../three/scene.ts";
import { clock, flushTweens, sleep } from "../three/tween.ts";
import { formatMoney } from "../i18n/format.ts";
import { engineText } from "../i18n/engine.ts";
import { t } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";
import { tradeStatusText } from "../i18n/labels.ts";
import { app, set, toast } from "../net/store.ts";
import { CardHold, readingTime } from "./card-hold.ts";

interface Update {
  state: PublicGameState;
  events: GameEvent[];
}

/** pause after a card appears, so the next animation does not run over it */
const CARD_BEAT_S = 0.6;

/** Plays server updates one after another: animations first, then the new state becomes visible. */
class Director {
  scene: GameScene | null = null;
  private queue: Update[] = [];
  private running = false;
  /**
   * Reading time of a drawn card. The card is an overlay with its own clock (T04): the queue goes on while it is
   * open, so a long read never delays the state of this client.
   */
  private readonly card = new CardHold(() => this.dismissCard());

  attach(scene: GameScene): void {
    this.scene = scene;
    if (app.state) scene.sync(app.state);
  }
  detach(): void {
    this.scene = null;
    this.dismissCard();
  }

  /** Keep the drawn card open while the player hovers/focuses it (reading time, capped by CARD_MAX_HOLD_MS). */
  holdCard(): void {
    this.card.hold();
  }

  /** Resume auto-dismiss after hovering, with a short grace period. */
  releaseCard(): void {
    this.card.release();
  }

  dismissCard(): void {
    this.card.clear();
    if (app.cardPopup !== null) {
      set({ cardPopup: null });
    }
  }

  hardSync(state: PublicGameState): void {
    this.queue = [];
    this.dismissCard();
    flushTweens();
    set({ state, backlog: 0 });
    this.scene?.sync(state);
  }

  enqueue(state: PublicGameState, events: GameEvent[]): void {
    this.queue.push({ state, events });
    set({ backlog: this.queue.length });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    set({ busy: true });
    await attempt("director:pump", () => this.drain(), errorOnError);
    clock.speed = 1;
    this.running = false;
    set({ busy: false, backlog: 0 });
  }

  private async drain(): Promise<void> {
    for (let u = this.queue.shift(); u !== undefined; u = this.queue.shift()) {
      const backlog = this.queue.length;
      set({ backlog });
      const scene = this.scene;
      if (!scene || backlog > 8) {
        // no canvas or hopelessly behind: apply instantly
        const prev = clock.instant;
        clock.instant = true;
        if (scene) await this.play(u, scene, true);
        clock.instant = prev;
        set({ state: u.state });
        scene?.sync(u.state);
        continue;
      }
      clock.speed = backlog > 3 ? 3 : backlog > 1 ? 1.8 : 1;
      await attempt("director:play", () => this.play(u, scene, false), errorOnError);
      set({ state: u.state });
      scene.sync(u.state);
      if (!this.queue.length) await sleep(0.05);
    }
  }

  private async play(u: Update, scene: GameScene, quiet: boolean): Promise<void> {
    const theme = getTheme(u.state.settings.themeId);
    scene.setTheme(theme);
    // make sure tokens exist before events refer to them (keeps current positions of known tokens)
    const prev = app.state;
    scene.sync(
      prev
        ? {
            ...u.state,
            players: u.state.players.map((p) => ({
              ...p,
              position: prev.players.find((q) => q.id === p.id)?.position ?? p.position,
              inJail: prev.players.find((q) => q.id === p.id)?.inJail ?? p.inJail,
            })),
            properties: prev.properties,
            dice: prev.dice,
          }
        : u.state,
    );
    for (const ev of u.events) await this.playEvent(ev, u.state, theme, scene, quiet);
  }

  private async playEvent(
    ev: GameEvent,
    st: PublicGameState,
    theme: Theme,
    scene: GameScene,
    quiet: boolean,
  ): Promise<void> {
    const P = (id: string | null) => st.players.find((p) => p.id === id);
    const name = (id: string | null) => P(id)?.name ?? t("common.bank");
    const color = (id: string | null) => P(id)?.color;
    const money = (n: number) => formatMoney(theme, n);
    const say = (
      t: string,
      kind: "info" | "good" | "bad" | "warn" = "info",
      who?: string | null,
    ) => {
      if (!quiet) toast(t, kind, who ? color(who) : undefined);
    };
    const tileName = (i: number) => theme.tileNames[i] ?? t("tile.fallback", { n: i });
    const you = app.you;
    switch (ev.type) {
      case "turn-start":
        scene.follow(ev.playerId);
        if (ev.playerId === you) say(t("toast.yourTurn"), "good", you);
        await sleep(0.15);
        break;
      case "dice":
        await scene.rollDice(ev.dice);
        await sleep(0.25);
        break;
      case "move":
        await scene.moveToken(ev.playerId, ev.from, ev.to, ev.mode);
        if (ev.passedGo) say(t("toast.passedGo", { name: name(ev.playerId) }), "good", ev.playerId);
        break;
      case "card":
        if (!quiet) {
          const text = themeText(theme, getLang()).cardTexts[ev.cardId] ?? ev.cardId;
          set({ cardPopup: { playerId: ev.playerId, deck: ev.deck, cardId: ev.cardId } });
          this.card.show(readingTime(text.length, clock.speed));
          await sleep(CARD_BEAT_S);
        }
        break;
      case "cash":
        if (["go", "tax", "card", "free-parking", "jail-fine", "bankruptcy"].includes(ev.reason)) {
          const label =
            ev.reason === "go"
              ? t("toast.cash.go")
              : ev.reason === "tax"
                ? t("toast.cash.tax")
                : ev.reason === "jail-fine"
                  ? t("toast.cash.jailFine")
                  : ev.reason === "free-parking"
                    ? t("toast.cash.freeParking")
                    : "";
          const text = t("toast.cash", {
            name: name(ev.playerId),
            sign: ev.delta >= 0 ? "+" : "−",
            amount: money(Math.abs(ev.delta)),
          });
          say(
            label ? t("toast.cashLabel", { text, label }) : text,
            ev.delta >= 0 ? "good" : "bad",
            ev.playerId,
          );
        }
        break;
      case "property-bought":
        scene.setOwner(ev.tile, ev.playerId, color(ev.playerId));
        say(
          t("toast.bought", {
            name: name(ev.playerId),
            tile: tileName(ev.tile),
            amount: money(ev.price),
          }),
          "info",
          ev.playerId,
        );
        await scene.popMarker(ev.tile);
        break;
      case "rent":
        say(
          t("toast.rent", {
            payer: name(ev.payer),
            amount: money(ev.amount),
            owner: name(ev.owner),
          }),
          ev.payer === you ? "bad" : ev.owner === you ? "good" : "info",
          ev.payer,
        );
        await sleep(0.3);
        break;
      case "building":
        scene.focusTile(ev.tile);
        await scene.setBuilding(ev.tile, ev.level, true);
        break;
      case "mortgage":
        scene.setMortgaged(ev.tile, ev.mortgaged);
        say(
          t(ev.mortgaged ? "toast.mortgaged" : "toast.unmortgaged", { tile: tileName(ev.tile) }),
          "warn",
        );
        break;
      case "jail":
        scene.setJail(ev.playerId, ev.inJail);
        say(
          t(ev.inJail ? "toast.jailIn" : "toast.jailOut", { name: name(ev.playerId) }),
          ev.inJail ? "bad" : "good",
          ev.playerId,
        );
        break;
      case "auction-start":
        say(t("toast.auctionStart", { tile: tileName(ev.tile) }), "warn");
        break;
      case "auction-bid":
        say(
          t("toast.bid", { name: name(ev.playerId), amount: money(ev.amount) }),
          "info",
          ev.playerId,
        );
        break;
      case "auction-end":
        say(
          ev.winner
            ? t("toast.auctionWon", {
                name: name(ev.winner),
                tile: tileName(ev.tile),
                amount: money(ev.amount),
              })
            : t("toast.auctionUnsold", { tile: tileName(ev.tile) }),
          "info",
          ev.winner,
        );
        break;
      case "securities-trade": {
        const security = themeText(theme, getLang()).securityNames[ev.secId] ?? ev.secId;
        const key =
          ev.side === "buy"
            ? "toast.secBuy"
            : ev.side === "sell"
              ? "toast.secSell"
              : "toast.secEmergency";
        if (ev.side !== "bankruptcy-sale") {
          say(
            t(key, { name: name(ev.playerId), shares: ev.shares, security }),
            ev.side === "emergency-sell" ? "warn" : "info",
            ev.playerId,
          );
        }
        break;
      }
      case "dividend":
        // everybody sees the log line; the toast is for the receiving player only
        if (ev.playerId === you) {
          say(t("toast.dividend", { amount: money(ev.amount) }), "good", ev.playerId);
        }
        break;
      case "market":
        if (ev.headline) {
          say(
            engineText(headlineMsg(ev.headline), theme, (id) => P(id)?.name),
            ev.headline.kind === "boom" ? "good" : "bad",
          );
        }
        break;
      case "trade":
        if (ev.trade.to === you && ev.trade.status === "pending")
          say(t("toast.tradeNew", { name: name(ev.trade.from) }), "warn", ev.trade.from);
        else if (ev.trade.from === you && ev.trade.status !== "pending")
          say(
            t("toast.tradeAnswer", {
              name: name(ev.trade.to),
              status: tradeStatusText(ev.trade.status),
            }),
            ev.trade.status === "accepted" ? "good" : "warn",
          );
        break;
      case "controller":
        say(
          t(
            ev.controller === "away"
              ? "toast.away"
              : ev.controller === "human"
                ? "toast.back"
                : "toast.bot",
            { name: name(ev.playerId) },
          ),
          "info",
          ev.playerId,
        );
        break;
      case "bankrupt":
        say(t("toast.bankrupt", { name: name(ev.playerId) }), "bad", ev.playerId);
        await sleep(0.6);
        break;
      case "game-over":
        say(
          ev.winner ? t("toast.winner", { name: name(ev.winner) }) : t("toast.gameOver"),
          "good",
          ev.winner,
        );
        break;
      default: {
        const unhandled: never = ev;
        console.warn("[director] unbekanntes Event", unhandled);
      }
    }
  }
}

export const director = new Director();
