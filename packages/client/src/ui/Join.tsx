import { useEffect, useRef, useState } from "preact/hooks";
import { attempt, getTheme, themeText, type LobbyInfo } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";
import { api } from "../net/api.ts";
import { getToken, saveJoin } from "../net/store.ts";
import { errMsg, nav, Swatch } from "./util.tsx";
import { Backdrop } from "./Backdrop.tsx";
import { PosterBand } from "./Poster.tsx";
import { GameGone } from "./GameGone.tsx";
import { TokenPicker } from "./TokenPicker.tsx";
import { effectiveToken, takenTokens } from "./tokens.ts";
import { isGameNotFoundMessage } from "../net/gone.ts";
import { IS_TOUCH } from "../platform.ts";

export function Join({ gameId, code }: { gameId: string; code: string }) {
  const [lobby, setLobby] = useState<LobbyInfo | null>(null);
  const [name, setName] = useState(localStorage.getItem("poly:name") ?? "");
  const [err, setErr] = useState("");
  /** the lobby could not be loaded: Retry reloads it */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  /** submitted without a name: the field is marked invalid and linked to the message */
  const [nameMissing, setNameMissing] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [tokenWish, setTokenWish] = useState<string | null>(null);

  useEffect(() => {
    if (getToken(gameId)) {
      nav(`#/game/${gameId}`);
      return undefined;
    }
    let cancelled = false;
    setLoadFailed(false);
    setErr("");
    api
      .getLobby(gameId)
      .then((l) => {
        if (!cancelled) {
          setLobby(l);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) {
          return;
        }
        // deleted for inactivity (docs/DESIGN.md #57) or never existed
        if (e instanceof Error && isGameNotFoundMessage(e.message)) {
          setGone(true);
        } else {
          setErr(errMsg(e));
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, reload]);

  async function join(e: Event) {
    e.preventDefault();
    if (!name.trim()) {
      setErr(t("join.nameRequired"));
      setNameMissing(true);
      nameField.current?.focus();
      return;
    }
    setBusy(true);
    setErr("");
    setNameMissing(false);
    const joined = await attempt("join:submit", async () => {
      localStorage.setItem("poly:name", name.trim());
      return api.join(gameId, {
        name: name.trim(),
        inviteCode: code,
        ...(tokenId === null ? {} : { tokenId }),
      });
    });
    if (!joined.ok) {
      setErr(errMsg(joined.error));
      setBusy(false);
      return;
    }
    const r = joined.value;
    saveJoin(r.gameId, r.playerToken, r.inviteCode);
    nav(`#/game/${r.gameId}`);
  }
  const theme = lobby ? getTheme(lobby.settings.themeId) : null;
  const taken = takenTokens(lobby?.seats ?? []);
  const tokenId = theme
    ? effectiveToken(
        theme.tokens.map((x) => x.id),
        taken,
        tokenWish,
      )
    : null;
  // a full or already started game cannot be joined: say so before the player fills in anything
  const blocked = lobby
    ? lobby.status !== "lobby"
      ? t("join.started")
      : lobby.seats.length >= lobby.maxPlayers
        ? t("join.full", { max: lobby.maxPlayers })
        : null
    : null;
  if (gone) {
    return <GameGone />;
  }
  return (
    <div class="stage">
      <Backdrop themeId={lobby?.settings.themeId ?? "ch"} offsetX={0.14} offsetY={-0.13} />
      <div class="page center right">
        <form class="panel join" onSubmit={join}>
          <PosterBand themeId={lobby?.settings.themeId ?? "ch"} label={t("band.invite")} />
          <div class="eyebrow">{t("join.eyebrow")}</div>
          <h1 class="small">
            Hoch<span>stapler</span>
          </h1>
          {theme && lobby && (
            <p class="lead">
              {t("join.lead", {
                flag: theme.flag,
                country: themeText(theme, getLang()).name,
                taken: lobby.seats.length,
                max: lobby.maxPlayers,
              })}
            </p>
          )}
          {lobby && (
            <div class="seatchips">
              {lobby.seats.map((s) => (
                <span class="chip">
                  <Swatch color={s.color} /> {s.name}
                </span>
              ))}
            </div>
          )}
          <input
            ref={nameField}
            class="field big"
            data-testid="join-name"
            aria-label={t("home.name")}
            placeholder={t("home.name")}
            value={name}
            maxLength={20}
            // a phone keyboard that pops up by itself hides the invitation
            autoFocus={!IS_TOUCH}
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? "join-error" : undefined}
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value);
              setNameMissing(false);
            }}
          />
          {lobby && (
            <TokenPicker
              themeId={lobby.settings.themeId}
              value={tokenId}
              taken={taken}
              onPick={setTokenWish}
            />
          )}
          {blocked && (
            <div class="err" role="status" id="join-blocked" data-testid="join-blocked">
              {blocked}
            </div>
          )}
          {err && (
            <div class="err" role="alert" id="join-error" data-testid="join-error">
              {err}
            </div>
          )}
          {loadFailed && (
            <button
              type="button"
              class="ghost"
              data-testid="join-retry"
              onClick={() => setReload((n) => n + 1)}
            >
              {t("join.retry")}
            </button>
          )}
          <button
            class="cta"
            data-testid="join-game"
            disabled={busy || !lobby || blocked !== null}
            aria-describedby={blocked ? "join-blocked" : undefined}
          >
            {busy ? t("join.joining") : lobby || loadFailed ? t("join.submit") : t("join.loading")}
          </button>
          <a class="ghost" href="#/">
            {t("common.toStart")}
          </a>
        </form>
      </div>
    </div>
  );
}
