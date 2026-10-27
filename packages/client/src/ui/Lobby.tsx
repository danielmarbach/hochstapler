import { useState } from "preact/hooks";
import { attempt, getTheme, themeText, type BotLevel } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";
import { api } from "../net/api.ts";
import { getInvite, toast, useApp } from "../net/store.ts";
import { BOT_LEVELS, errMsg, Swatch } from "./util.tsx";
import { DeviceLinkButton } from "./DeviceLink.tsx";
import { CHAT_MODE_LABEL, ChatHostControls } from "./ChatControls.tsx";
import { Backdrop } from "./Backdrop.tsx";
import { PosterBand } from "./Poster.tsx";
import { Toasts } from "./Toasts.tsx";
import { TokenPicker } from "./TokenPicker.tsx";
import { takenTokens } from "./tokens.ts";

/** "90 s" / "5 min" / "24 h" */
function limitLabel(sec: number): string {
  if (sec >= 3600) {
    return t("unit.hours", { n: sec / 3600 });
  }
  return sec >= 60 ? t("unit.minutes", { n: sec / 60 }) : t("unit.seconds", { n: sec });
}

/** The host's chat controls, folded away: the lobby stays compact on small screens. */
function ChatSettings() {
  const [open, setOpen] = useState(false);
  return (
    <details
      class="chatdet"
      data-testid="chat-settings"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{t("chat.hostControls")}</summary>
      {open && <ChatHostControls />}
    </details>
  );
}

export function Lobby() {
  const lobby = useApp((s) => s.lobby);
  const you = useApp((s) => s.you);
  const presence = useApp((s) => s.presence);
  const [level, setLevel] = useState<BotLevel>("normal");
  const [busy, setBusy] = useState(false);
  if (!lobby)
    return (
      <div class="page center">
        <div class="panel loading">{t("lobby.connecting")}</div>
      </div>
    );
  const theme = getTheme(lobby.settings.themeId);
  const me = lobby.seats.find((s) => s.playerId === you);
  const host = !!me?.isHost;
  const invite = getInvite(lobby.gameId);
  const link = invite
    ? `${location.origin}${location.pathname}#/join/${lobby.gameId}/${invite}`
    : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    const r = await attempt("lobby:run", fn);
    if (!r.ok) toast(errMsg(r.error), "bad");
    setBusy(false);
  };
  const copy = async () => {
    if (!link) return;
    const r = await attempt("lobby:copy", () => navigator.clipboard.writeText(link));
    if (r.ok) toast(t("lobby.linkCopied"), "good");
    else window.prompt(t("lobby.linkPrompt"), link);
  };
  const free = lobby.maxPlayers - lobby.seats.length;
  return (
    <div class="stage">
      <Backdrop themeId={lobby.settings.themeId} offsetX={0.14} offsetY={-0.13} />
      <Toasts />
      <div class="page center right">
        <div class="panel lobby">
          <PosterBand themeId={lobby.settings.themeId} label={t("band.lobby")} />
          <div class="eyebrow">{t("lobby.eyebrow")}</div>
          <h1 class="small">
            {theme.flag} {themeText(theme, getLang()).name}
          </h1>
          <p class="lead">
            {t("lobby.seats", { taken: lobby.seats.length, max: lobby.maxPlayers })} ·{" "}
            {lobby.settings.turnTimeoutSec
              ? t("lobby.limit", { value: limitLabel(lobby.settings.turnTimeoutSec) })
              : t("lobby.noLimit")}
            <span data-testid="lobby-chat">
              {" · "}
              {t("chat.summary", { mode: t(CHAT_MODE_LABEL[lobby.chat.mode]) })}
            </span>
            {lobby.settings.securities && (
              <span data-testid="lobby-securities">
                {" · "}
                {t("lobby.securities", { rounds: lobby.settings.securitiesLockRounds })}
                <span data-testid="lobby-dividends">
                  {" · "}
                  {t(
                    lobby.settings.securitiesDividends
                      ? "lobby.dividends.on"
                      : "lobby.dividends.off",
                  )}
                </span>
              </span>
            )}
            {lobby.settings.loans && (
              <span data-testid="lobby-loans">
                {" · "}
                {t("lobby.loans")}
              </span>
            )}
          </p>
          {!me && <div class="err">{t("lobby.notSeated")}</div>}
          <ul class="seats">
            {lobby.seats.map((s, i) => (
              <li
                key={s.playerId}
                data-testid="seat"
                data-player-name={s.name}
                style={{ "--d": i }}
              >
                <Swatch color={s.color} size={22} />
                <span class="sname">
                  {s.name}
                  {s.playerId === you && <em> {t("common.you")}</em>}
                </span>
                {s.isHost && <span class="badge host">{t("lobby.host")}</span>}
                {lobby.chat.muted.includes(s.playerId) && (
                  <span class="badge" data-testid="muted-badge">
                    {t("chat.mutedBadge")}
                  </span>
                )}
                {s.kind === "bot" ? (
                  <span class="badge">
                    {t("lobby.botBadge", {
                      level: t(BOT_LEVELS.find((l) => l.id === s.botLevel)?.label ?? "bot.normal"),
                    })}
                  </span>
                ) : (
                  <span
                    class={`dot ${s.connected || presence.includes(s.playerId) ? "on" : ""}`}
                    title={t("common.online")}
                  />
                )}
                {host && s.playerId !== you && (
                  <button
                    class="x"
                    aria-label={t("lobby.removeSeat", { name: s.name })}
                    disabled={busy}
                    onClick={() => run(() => api.removeSeat(lobby.gameId, s.playerId))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: Math.max(0, free) }).map(() => (
              <li class="empty">
                <span>{t("lobby.freeSeat")}</span>
              </li>
            ))}
          </ul>
          {me && me.kind === "human" && (
            <TokenPicker
              themeId={lobby.settings.themeId}
              value={me.tokenId}
              taken={takenTokens(lobby.seats, me.playerId)}
              busy={busy}
              onPick={(id) => run(() => api.pickToken(lobby.gameId, id))}
            />
          )}
          {link && (
            <div class="invite">
              <input
                readOnly
                data-testid="invite-link"
                aria-label={t("lobby.inviteLink")}
                value={link}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
          )}
          {host && <ChatSettings />}
          {host && (
            <div class="hostbar">
              <div class="seg">
                {BOT_LEVELS.map((l) => (
                  <button
                    type="button"
                    class={level === l.id ? "on" : ""}
                    aria-pressed={level === l.id}
                    onClick={() => setLevel(l.id)}
                  >
                    {t(l.label)}
                  </button>
                ))}
              </div>
              <button
                class="ghost"
                disabled={busy || free <= 0}
                onClick={() => run(() => api.addBot(lobby.gameId, level))}
              >
                {t("lobby.addBot")}
              </button>
            </div>
          )}
          {!host && me && <p class="note">{t("lobby.waitForHost")}</p>}
          {me && me.kind === "human" && <DeviceLinkButton variant="ghost" />}
          <a class="ghost" href="#/">
            {t("common.toStart")}
          </a>
          {(link || host) && (
            // sticky footer (UI review T08): invite and start stay reachable however long the lobby gets
            <div class="lobby-foot" data-testid="lobby-foot">
              {link && (
                <button class="ghost" data-testid="copy-invite" onClick={copy}>
                  {t("lobby.copyLink")}
                </button>
              )}
              {host && (
                <button
                  class="cta"
                  data-testid="start-game"
                  disabled={busy || lobby.seats.length < 2}
                  onClick={() => run(() => api.start(lobby.gameId))}
                >
                  {t("lobby.start")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
