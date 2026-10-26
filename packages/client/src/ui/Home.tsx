import { useEffect, useRef, useState } from "preact/hooks";
import {
  attempt,
  DEFAULT_SETTINGS,
  getTheme,
  MAX_LOCK_ROUNDS,
  MIN_LOCK_ROUNDS,
  themeText,
  THEMES,
  type BotLevel,
  type GameSettings,
} from "@poly/engine";
import { t, type UiKey } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";
import { api } from "../net/api.ts";
import { startPow, withPow } from "../net/pow.ts";
import type { PowTicket } from "../net/pow.ts";
import { saveJoin } from "../net/store.ts";
import { BOT_LEVELS, errMsg, nav } from "./util.tsx";
import { Backdrop } from "./Backdrop.tsx";
import { LangPills } from "./LangPicker.tsx";
import { Poster } from "./Poster.tsx";
import { TokenIcon } from "./TokenIcon.tsx";
import { TokenPicker } from "./TokenPicker.tsx";
import { effectiveToken } from "./tokens.ts";

const NOBODY: ReadonlyMap<string, string> = new Map();

/** a challenge is valid for 5 minutes (server default); a ticket older than 4 is replaced by a fresh one */
const POW_TICKET_MAX_AGE_MS = 4 * 60_000;

const LIMITS = [
  { label: "home.limit.live", sec: 60, hint: "home.limit.live.hint" },
  { label: "home.limit.cosy", sec: 300, hint: "home.limit.cosy.hint" },
  { label: "home.limit.long", sec: 86400, hint: "home.limit.long.hint" },
  { label: "home.limit.none", sec: 0, hint: "home.limit.none.hint" },
] as const satisfies readonly { label: UiKey; sec: number; hint: UiKey }[];

export function Home() {
  const [name, setName] = useState(localStorage.getItem("poly:name") ?? "");
  const [themeId, setThemeId] = useState("ch");
  const [tokenWish, setTokenWish] = useState<string | null>(null);
  const [bots, setBots] = useState<BotLevel[]>(["normal", "normal"]);
  const [maxPlayers, setMax] = useState(4);
  const [limit, setLimit] = useState(60);
  const [auctions, setAuctions] = useState(DEFAULT_SETTINGS.auctions);
  const [jackpot, setJackpot] = useState(DEFAULT_SETTINGS.freeParkingJackpot);
  const [doubleGo, setDoubleGo] = useState(DEFAULT_SETTINGS.doubleOnGoLanding);
  const [maxRounds, setRounds] = useState(0);
  const [securities, setSecurities] = useState(DEFAULT_SETTINGS.securities);
  const [lockRounds, setLockRounds] = useState(DEFAULT_SETTINGS.securitiesLockRounds);
  const [dividends, setDividends] = useState(DEFAULT_SETTINGS.securitiesDividends);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // the house rules start folded away (UI review T08): the summary names the active ones
  const [rulesOpen, setRulesOpen] = useState(false);
  // proof of work (docs/DESIGN.md #70): starts when the form is first used, so it is usually done by the time of the click
  const [checking, setChecking] = useState(false);
  const powTicket = useRef<{ ticket: PowTicket; at: number } | null>(null);
  const ticket = (): PowTicket => {
    const current = powTicket.current;
    if (current && Date.now() - current.at < POW_TICKET_MAX_AGE_MS) return current.ticket;
    current?.ticket.cancel();
    const fresh = { ticket: startPow(), at: Date.now() };
    powTicket.current = fresh;
    return fresh.ticket;
  };
  const resetPow = (): void => {
    powTicket.current?.ticket.cancel();
    powTicket.current = null;
  };
  useEffect(() => resetPow, []);

  const themes = Object.values(THEMES);
  // a wish from another country's set is void: the picker then shows (and the server gets) the first piece
  const tokenId = effectiveToken(
    getTheme(themeId).tokens.map((x) => x.id),
    NOBODY,
    tokenWish,
  );
  const tokenName = themeText(getTheme(themeId), getLang()).tokens.find(
    (x) => x.id === tokenId,
  )?.name;
  const activeRules = [
    ...(auctions ? [t("home.rule.auctions")] : []),
    ...(jackpot ? [t("home.rule.jackpot")] : []),
    ...(doubleGo ? [t("home.rule.doubleGo")] : []),
    ...(securities ? [t("home.rule.securities")] : []),
    ...(securities && dividends ? [t("home.rule.dividends")] : []),
    ...(maxRounds > 0 ? [t("home.rules.rounds", { n: maxRounds })] : []),
  ];
  const setMaxSafe = (n: number) => {
    const v = Math.max(2, Math.min(8, n));
    setMax(v);
    setBots((b) => b.slice(0, v - 1));
  };
  const addBot = () => {
    if (bots.length + 1 < maxPlayers) setBots([...bots, "normal"]);
    else if (maxPlayers < 8) {
      setMax(maxPlayers + 1);
      setBots([...bots, "normal"]);
    }
  };

  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim()) {
      setErr(t("home.nameRequired"));
      return;
    }
    setBusy(true);
    setErr("");
    setChecking(true);
    const created = await attempt("home:create", async () => {
      localStorage.setItem("poly:name", name.trim());
      const settings: Partial<GameSettings> = {
        themeId,
        turnTimeoutSec: limit,
        auctions,
        freeParkingJackpot: jackpot,
        doubleOnGoLanding: doubleGo,
        maxRounds,
        securities,
        securitiesLockRounds: lockRounds,
        securitiesDividends: dividends,
      };
      const request = {
        hostName: name.trim(),
        settings,
        bots,
        maxPlayers,
        ...(tokenId === null ? {} : { tokenId }),
      };
      return withPow(ticket, resetPow, async (header) => {
        setChecking(false);
        return api.createGame(request, header);
      });
    });
    setChecking(false);
    if (!created.ok) {
      setErr(errMsg(created.error));
      setBusy(false);
      return;
    }
    resetPow();
    const res = created.value;
    saveJoin(res.gameId, res.playerToken, res.inviteCode);
    nav(`#/game/${res.gameId}`);
  }

  return (
    <div class="stage">
      <Backdrop themeId={themeId} offsetX={0.14} offsetY={-0.13} />
      <div class="page home">
        <div class="langrow">
          <LangPills />
        </div>
        <Poster themeId={themeId} />
        <form class="panel setup" onSubmit={create} onFocusIn={ticket} onInput={ticket}>
          <section>
            <h2>
              <b>1</b> {t("home.step1")}
            </h2>
            <input
              class="field big"
              aria-label={t("home.name")}
              placeholder={t("home.name")}
              autoComplete="nickname"
              value={name}
              maxLength={20}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <TokenPicker themeId={themeId} value={tokenId} taken={NOBODY} onPick={setTokenWish} />
            {tokenId !== null && tokenName !== undefined && (
              <p class="tok-summary" data-testid="token-summary" role="status">
                <span aria-hidden="true">
                  <TokenIcon id={tokenId} size={28} name={tokenName} />
                </span>{" "}
                {t("tokens.chosen", { token: tokenName })}
              </p>
            )}
          </section>
          <section>
            <h2>
              <b>2</b> {t("home.step2")}
            </h2>
            <div class="countries">
              {themes.map((th) => (
                <button
                  type="button"
                  key={th.id}
                  data-testid="country"
                  data-theme={th.id}
                  aria-pressed={th.id === themeId}
                  class={`country ${th.id === themeId ? "on" : ""}`}
                  onClick={() => setThemeId(th.id)}
                >
                  <span class="flag" aria-hidden="true">
                    {th.flag}
                  </span>
                  <span class="cname">{themeText(th, getLang()).name}</span>
                  <span class="csub">{th.currency.code}</span>
                  <span class="strip">
                    {th.groupColors.map((c) => (
                      <i style={{ background: c }} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>
              <b>3</b> {t("home.step3")}
            </h2>
            <div class="row">
              <label class="stepper">
                {t("home.maxPlayers")}
                <span>
                  <button
                    type="button"
                    aria-label={t("home.fewerPlayers")}
                    onClick={() => setMaxSafe(maxPlayers - 1)}
                  >
                    −
                  </button>
                  <output>{maxPlayers}</output>
                  <button
                    type="button"
                    aria-label={t("home.morePlayers")}
                    onClick={() => setMaxSafe(maxPlayers + 1)}
                  >
                    +
                  </button>
                </span>
              </label>
            </div>
            <div class="botlist">
              {bots.map((b, i) => (
                <div class="botrow" key={i} data-testid="bot-row">
                  <span class="botico" aria-hidden="true">
                    🤖
                  </span>
                  <span>{t("home.botN", { n: i + 1 })}</span>
                  <div class="seg">
                    {BOT_LEVELS.map((l) => (
                      <button
                        type="button"
                        class={b === l.id ? "on" : ""}
                        aria-pressed={b === l.id}
                        onClick={() => setBots(bots.map((x, j) => (j === i ? l.id : x)))}
                      >
                        {t(l.label)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    class="x"
                    title={t("home.remove")}
                    aria-label={t("home.removeBot")}
                    onClick={() => setBots(bots.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" class="ghost" onClick={addBot}>
                {t("home.addBot")}
              </button>
            </div>
            <p class="note">{t("home.freeSeats", { free: maxPlayers - 1 - bots.length })}</p>
          </section>
          <section>
            <h2>
              <b>4</b> {t("home.step4")}
            </h2>
            <div class="limits">
              {LIMITS.map((l) => (
                <button
                  type="button"
                  class={`limit ${limit === l.sec ? "on" : ""}`}
                  aria-pressed={limit === l.sec}
                  onClick={() => setLimit(l.sec)}
                >
                  <strong>{t(l.label)}</strong>
                  <small>{t(l.hint)}</small>
                </button>
              ))}
            </div>
            <p class="note">{t("home.limitNote")}</p>
          </section>
          <section>
            <h2>
              <b>5</b> {t("home.step5")}
            </h2>
            <button
              type="button"
              class="rules-summary"
              data-testid="rules-toggle"
              aria-expanded={rulesOpen}
              aria-controls="rules-panel"
              onClick={() => setRulesOpen(!rulesOpen)}
            >
              <span class="rs-text" data-testid="rules-summary">
                {activeRules.length > 0 ? activeRules.join(" · ") : t("home.rules.none")}
              </span>
              <span class="rs-act">{rulesOpen ? t("home.rules.hide") : t("home.rules.edit")}</span>
            </button>
            {rulesOpen && (
              <div id="rules-panel">
                <div class="toggles">
                  <Toggle
                    label={t("home.rule.auctions")}
                    sub={t("home.rule.auctions.sub")}
                    on={auctions}
                    set={setAuctions}
                  />
                  <Toggle
                    label={t("home.rule.jackpot")}
                    sub={t("home.rule.jackpot.sub")}
                    on={jackpot}
                    set={setJackpot}
                  />
                  <Toggle
                    label={t("home.rule.doubleGo")}
                    sub={t("home.rule.doubleGo.sub")}
                    on={doubleGo}
                    set={setDoubleGo}
                  />
                  <Toggle
                    label={t("home.rule.securities")}
                    sub={t("home.rule.securities.sub")}
                    on={securities}
                    set={setSecurities}
                    testid="toggle-securities"
                  />
                  {securities && (
                    <label class="stepper" data-testid="securities-lock">
                      {t("home.securitiesLock")} <small>{t("home.securitiesLock.hint")}</small>
                      <span>
                        <button
                          type="button"
                          aria-label={t("home.fewerLock")}
                          data-testid="lock-minus"
                          onClick={() => setLockRounds(Math.max(MIN_LOCK_ROUNDS, lockRounds - 1))}
                        >
                          −
                        </button>
                        <output data-testid="lock-rounds">{lockRounds}</output>
                        <button
                          type="button"
                          aria-label={t("home.moreLock")}
                          data-testid="lock-plus"
                          onClick={() => setLockRounds(Math.min(MAX_LOCK_ROUNDS, lockRounds + 1))}
                        >
                          +
                        </button>
                      </span>
                    </label>
                  )}
                  {securities && (
                    <Toggle
                      label={t("home.rule.dividends")}
                      sub={t("home.rule.dividends.sub")}
                      on={dividends}
                      set={setDividends}
                      testid="toggle-dividends"
                    />
                  )}
                  <label class="stepper">
                    {t("home.roundLimit")} <small>{t("home.roundLimit.hint")}</small>
                    <span>
                      <button
                        type="button"
                        aria-label={t("home.fewerRounds")}
                        onClick={() => setRounds(Math.max(0, maxRounds - 10))}
                      >
                        −
                      </button>
                      <output>{maxRounds}</output>
                      <button
                        type="button"
                        aria-label={t("home.moreRounds")}
                        onClick={() => setRounds(maxRounds + 10)}
                      >
                        +
                      </button>
                    </span>
                  </label>
                </div>
              </div>
            )}
          </section>
          {err && <div class="err">{err}</div>}
          <div class="setup-foot">
            <button class="cta" data-testid="create-game" disabled={busy}>
              {busy ? (checking ? t("pow.checking") : t("home.creating")) : t("home.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Toggle({
  label,
  sub,
  on,
  set,
  testid,
}: {
  label: string;
  sub: string;
  on: boolean;
  set: (v: boolean) => void;
  testid?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      class={`toggle ${on ? "on" : ""}`}
      onClick={() => set(!on)}
      role="switch"
      aria-checked={on}
    >
      <span class="knob" />
      <span class="tl">
        <strong>{label}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );
}
