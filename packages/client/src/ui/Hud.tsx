import { useEffect, useRef } from "preact/hooks";
import {
  groupTiles,
  whoMustAct,
  playerProperties,
  type PlayerState,
  type PublicGameState,
} from "@poly/engine";
import { director } from "../game/director.ts";
import { t } from "../i18n/index.ts";
import { formatNumber } from "../i18n/format.ts";
import { set, useApp } from "../net/store.ts";
import { ActionBar } from "./Actions.tsx";
import { EndGameDialog, EndVoteBanner, GameMenu } from "./EndGame.tsx";
import { LangSelect } from "./LangPicker.tsx";
import { PropertyCard, Drawer } from "./Property.tsx";
import { TradeDialog } from "./Trade.tsx";
import { LogPanel } from "./Log.tsx";
import { Results } from "./Results.tsx";
import {
  Cash,
  asGame,
  fmtTime,
  nav,
  Postmark,
  Swatch,
  useLayout,
  useGameState,
  useNow,
  usePalette,
  useTheme,
  useThemeText,
} from "./util.tsx";
import { BottomSheet } from "./Sheet.tsx";
import { Toasts } from "./Toasts.tsx";
import { TokenIcon } from "./TokenIcon.tsx";
import { inkOn } from "./palette.ts";

export function Hud() {
  const theme = useTheme();
  usePalette(theme.id);
  const layout = useLayout();
  const phone = layout === "phone-portrait";
  const state = useApp((s) => s.state);
  const selected = useApp((s) => s.selectedTile);
  const drawer = useApp((s) => s.drawerOpen);
  const trade = useApp((s) => s.tradeOpen);
  const connected = useApp((s) => s.connected);
  const follow = useApp((s) => s.followCam);
  const bloom = useApp((s) => s.bloom);
  const card = useApp((s) => s.cardPopup);
  const busy = useApp((s) => s.busy);
  const you = useApp((s) => s.you);
  const backlog = useApp((s) => s.backlog);
  const endGameDialog = useApp((s) => s.endGameDialog);
  if (!state) return null;

  return (
    <div class={`hud layout-${layout}`} data-testid="hud" data-layout={layout}>
      {!phone && <PlayerPanels compact={drawer && (layout === "desktop" || layout === "tablet")} />}
      {!phone && <TurnBanner />}
      <div class="topright">
        <LangSelect />
        {!phone && (
          <>
            <button
              class={`pill round ${follow ? "on" : ""}`}
              title={t("hud.followCam")}
              aria-label={t("hud.followCam")}
              aria-pressed={follow}
              onClick={() => set({ followCam: !follow })}
            >
              🎥
            </button>
            <button
              class={`pill round ${bloom ? "on" : ""}`}
              title={t("hud.glowTitle")}
              aria-label={t("hud.glow")}
              aria-pressed={bloom}
              onClick={() => set({ bloom: !bloom })}
            >
              ✨
            </button>
          </>
        )}
        <GameMenu>
          {phone && (
            // phones: the camera and effect switches are rarely needed, they live in "more" (UI review T07)
            <>
              <button
                class={`ghost ${follow ? "on" : ""}`}
                role="menuitemcheckbox"
                aria-checked={follow}
                onClick={() => set({ followCam: !follow })}
              >
                🎥 {t("hud.followCam")}
              </button>
              <button
                class={`ghost ${bloom ? "on" : ""}`}
                role="menuitemcheckbox"
                aria-checked={bloom}
                onClick={() => set({ bloom: !bloom })}
              >
                ✨ {t("hud.glowTitle")}
              </button>
            </>
          )}
        </GameMenu>
        <button
          class="pill round"
          title={t("hud.home")}
          aria-label={t("hud.home")}
          onClick={() => nav("#/")}
        >
          ⌂
        </button>
      </div>
      {!connected && (
        <div class="conn" role="status" data-testid="connection-lost">
          {t("net.reconnecting")}
        </div>
      )}
      {backlog > 2 && (
        <div class="conn soft" role="status">
          {t("net.catchingUp", { n: backlog })}
        </div>
      )}
      <Toasts />
      {selected !== null && (
        <PropertyCard tile={selected} onClose={() => set({ selectedTile: null })} />
      )}
      {!phone && drawer && <Drawer />}
      {trade && <TradeDialog />}
      {phone ? <BottomSheet /> : <LogPanel />}
      {!phone && you && <ActionBar />}
      {!phone && !you && (
        <div class="spectator panel mini" data-testid="spectator">
          {t("hud.spectator")}
          <button
            class="pill"
            data-testid="open-board"
            title={t("board.openTitle")}
            onClick={() => set({ drawerOpen: true, drawerTab: "board" })}
          >
            {t("board.open")}
          </button>
        </div>
      )}
      {card && <CardView />}
      {state.endVote && state.status === "running" && <EndVoteBanner />}
      {endGameDialog && state.status === "running" && <EndGameDialog />}
      {state.phase.type === "game-over" && !busy && <Results />}
    </div>
  );
}

/**
 * The drawn card (UI review T04): a visible 44px "Continue" button closes it, the heading takes the focus when the
 * card is mine (so screen readers read it; other players' cards never steal focus), and hover/focus hold it open
 * for a while. The text also stays in the log.
 */
function CardView() {
  const theme = useTheme();
  const texts = useThemeText();
  const card = useApp((s) => s.cardPopup);
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  const heading = useRef<HTMLHeadingElement>(null);
  /** our own focus() call must not count as the player holding the card */
  const programmatic = useRef(false);
  const key = card ? `${card.playerId}:${card.cardId}` : "";
  const mine = card !== null && card.playerId === you;
  useEffect(() => {
    if (!key || !mine) {
      return undefined;
    }
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    programmatic.current = true;
    heading.current?.focus();
    programmatic.current = false;
    return () => {
      // the card (and the focus inside it) is gone: give the focus back to where it was
      if (before?.isConnected && document.activeElement === document.body) {
        before.focus();
      }
    };
  }, [key, mine]);
  if (!card || !state) return null;
  const p = state.players.find((x) => x.id === card.playerId);
  const deckName = texts.deckNames[card.deck];
  return (
    <div
      class="cardpop"
      data-testid="card-popup"
      onClick={() => director.dismissCard()}
      onMouseEnter={() => director.holdCard()}
      onMouseLeave={() => director.releaseCard()}
      onFocusIn={() => {
        if (!programmatic.current) {
          director.holdCard();
        }
      }}
      onFocusOut={() => director.releaseCard()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          director.dismissCard();
        }
      }}
      role="dialog"
      aria-labelledby="card-heading"
    >
      <div class={`playing-card ${card.deck}`}>
        <div class="deck">
          <h2 id="card-heading" tabIndex={-1} ref={heading} data-testid="card-heading">
            {deckName}
          </h2>
        </div>
        <Postmark theme={theme} class="on-playing" />
        <p data-testid="card-text">{texts.cardTexts[card.cardId] ?? card.cardId}</p>
        {p && (
          <div class="who">
            <Swatch color={p.color} /> {p.name}
          </div>
        )}
        <button
          type="button"
          class="cta slim card-continue"
          data-testid="card-continue"
          onClick={(e) => {
            e.stopPropagation();
            director.dismissCard();
          }}
        >
          {t("card.continue")}
        </button>
      </div>
    </div>
  );
}

function Badge({ p, online }: { p: PlayerState; online: boolean }) {
  if (p.bankrupt)
    return (
      <span class="badge dead" data-testid="player-badge" title={t("badge.bankrupt")}>
        {t("badge.bankrupt")}
      </span>
    );
  if (p.controller === "bot")
    return (
      <span class="badge" data-testid="player-badge" title={t("badge.bot")}>
        {t("badge.bot")}
      </span>
    );
  if (p.controller === "away")
    return (
      <span class="badge away" data-testid="player-badge" title={t("badge.away")}>
        {t("badge.away")}
      </span>
    );
  return (
    <span
      class={`dot ${online ? "on" : ""}`}
      data-testid="player-online"
      data-online={online}
      title={online ? t("common.online") : t("common.offline")}
    />
  );
}

/** colour-group stamps for the passport: outlined = some streets, filled with star = full colour set */
function stampsFor(
  state: PublicGameState,
  playerId: string,
  colors: readonly string[],
): { group: number; owned: number; total: number; color: string }[] {
  const out: { group: number; owned: number; total: number; color: string }[] = [];
  for (let g = 0; g < colors.length; g++) {
    const tiles = groupTiles(g);
    if (tiles.length === 0) {
      continue;
    }
    const owned = tiles.filter((t) => state.properties[t]?.owner === playerId).length;
    if (owned > 0) {
      out.push({ group: g, owned, total: tiles.length, color: colors[g] ?? "#999999" });
    }
  }
  return out;
}

export function PlayerPanels({
  inline = false,
  compact = false,
}: {
  inline?: boolean;
  /** one line per player (name, cash, state) while a drawer is open and would cover the full cards */
  compact?: boolean;
}) {
  const theme = useTheme();
  const texts = useThemeText();
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  const presence = useApp((s) => s.presence);
  if (!state) return null;
  const cur = state.players[state.current]?.id;
  if (compact) {
    return (
      <div class="players compact" data-testid="players-compact">
        {state.players.map((p) => (
          <div
            key={p.id}
            data-testid="player-panel"
            data-player-name={p.name}
            data-position={p.position}
            data-token={p.tokenId}
            class={`pp line ${cur === p.id ? "active" : ""} ${p.bankrupt ? "out" : ""}`}
            style={{ "--pc": p.color }}
            aria-current={cur === p.id ? "true" : undefined}
          >
            <span class="ticon" aria-hidden="true">
              <TokenIcon id={p.tokenId} size={22} />
            </span>
            <span class="pwho-name" title={p.name}>
              {p.name}
              {p.id === you && <em> {t("common.you")}</em>}
            </span>
            <Badge p={p} online={presence.includes(p.id)} />
            <span class="pmoney" data-testid="player-cash">
              <Cash value={p.cash} theme={theme} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  // an auction hands the floor to the bidders while the player on the move keeps "your move"
  const bidding = state.phase.type === "auction" ? state.phase.auction.turn : null;
  return (
    <div class={inline ? "players inline" : "players"}>
      {state.players.map((p) => {
        const tok = texts.tokens.find((k) => k.id === p.tokenId)?.name ?? p.tokenId;
        const props = playerProperties(asGame(state), p.id).length;
        const stamps = stampsFor(state, p.id, theme.groupColors);
        const active = cur === p.id;
        return (
          <div
            key={p.id}
            data-testid="player-panel"
            data-player-name={p.name}
            data-position={p.position}
            data-token={p.tokenId}
            class={`pp passport ${active ? "active" : ""} ${p.bankrupt ? "out" : ""}`}
            style={{ "--pc": p.color, "--pt": inkOn(p.color) }}
            aria-current={active ? "true" : undefined}
          >
            <div class="photo" title={tok}>
              <span class="ticon" aria-hidden="true">
                <TokenIcon id={p.tokenId} size={40} name={tok} />
              </span>
            </div>
            <div class="pbody">
              <div class="pname">
                <span class="pwho">
                  <span class="pwho-name" title={p.name}>
                    {p.name}
                  </span>
                  {p.id === you && <em> {t("common.you")}</em>}
                </span>
                <Badge p={p} online={presence.includes(p.id)} />
              </div>
              <div class="pmoney" data-testid="player-cash">
                <Cash value={p.cash} theme={theme} />
              </div>
              <div class="pmeta" data-testid="player-meta">
                {t("player.meta", { token: tok, n: props })}
                {p.inJail ? ` · ${t("player.inJail")}` : ""}
                {p.jailCards.length ? ` · 🎟 ${p.jailCards.length}` : ""}
              </div>
              {stamps.length > 0 && (
                <ul class="stamps" aria-label={t("hud.stamps")}>
                  {stamps.map((st) => {
                    const full = st.owned === st.total;
                    return (
                      <li
                        key={st.group}
                        class={`mini-stamp ${full ? "full" : ""}`}
                        style={{ "--sc": st.color, "--st": inkOn(st.color) }}
                        title={t(full ? "hud.stampFull" : "hud.stamp", {
                          group: texts.groupNames[st.group] ?? "",
                          owned: st.owned,
                          total: st.total,
                        })}
                      >
                        {full ? "★" : st.owned}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {active && <span class="turn-tag">{t("turn.tag")}</span>}
            {bidding === p.id && !active && (
              <span class="turn-tag bidding" data-testid="bidding-tag">
                {t("turn.biddingTag")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** who is on the move and the countdown for human players */
export function useTurn(): {
  who: PlayerState | undefined;
  /** during an auction: whose turn it really is (the bidder `who` is not the player on the move) */
  mover: PlayerState | undefined;
  left: number | null;
  round: string;
  jackpot: string;
} {
  const state = useGameState();
  const now = useNow();
  const actors = whoMustAct(asGame(state));
  const who = state.players.find((p) => p.id === (actors[0] ?? state.players[state.current]?.id));
  const mover = state.phase.type === "auction" ? state.players[state.current] : undefined;
  const left = state.deadline && who?.controller === "human" ? (state.deadline - now) / 1000 : null;
  const round = state.settings.maxRounds
    ? t("turn.roundOf", { round: state.round, max: state.settings.maxRounds })
    : t("turn.round", { round: state.round });
  const jackpot =
    state.settings.freeParkingJackpot && state.freeParkingPot
      ? ` · ${t("turn.jackpot", { amount: formatNumber(state.freeParkingPot) })}`
      : "";
  return { who, mover: mover && mover.id !== who?.id ? mover : undefined, left, round, jackpot };
}

function TurnBanner() {
  const { who, mover, left, round, jackpot } = useTurn();
  return (
    <div class="turn panel" role="status" data-testid="turn-banner">
      {who && <span class="tdot" style={{ background: who.color }} />}
      <div>
        <div class="tname" data-testid="turn-name">
          {who
            ? mover
              ? t("turn.bidding", { name: who.name })
              : t("turn.isOn", { name: who.name })
            : t("turn.running")}
        </div>
        <div class="tsub">
          {mover ? `${t("turn.isOn", { name: mover.name })} · ` : ""}
          {round}
          {jackpot}
        </div>
      </div>
      {left !== null && <div class={`count ${left < 10 ? "hot" : ""}`}>{fmtTime(left)}</div>}
    </div>
  );
}
