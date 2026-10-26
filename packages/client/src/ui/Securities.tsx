// "Wertpapiere" panel (docs/DESIGN.md #48): price list with sparklines, headline, portfolio with
// lock-up countdown, buy and (emergency) sell. Shown in the desktop drawer and the phone sheet,
// only when the mode is on. All rules come from the engine (securities.ts), so the buttons and the
// explanations never disagree with the server.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  DIVIDEND_MIN_RATIO_PERCENT,
  EMERGENCY_DISCOUNT_PERCENT,
  MAX_SHARES_PER_SECURITY,
  buyBlocker,
  changePercent,
  currentYieldPermille,
  headlineMsg,
  holdingsOf,
  lockRoundsLeft,
  planSale,
  priceOfSecurity,
  saleProceeds,
  securitiesOf,
  type Holding,
  type Market,
  type PlayerState,
  type SecurityDef,
  type SecuritySector,
} from "@poly/engine";
import { engineText } from "../i18n/engine.ts";
import { formatMoney, formatPercent } from "../i18n/format.ts";
import { t, type UiKey } from "../i18n/index.ts";
import { set, useApp } from "../net/store.ts";
import { debtAfterSale, debtShortfall } from "./debt.ts";
import { sendAction } from "../net/ws.ts";
import { asGame, playerName, useGameState, useTheme, useThemeText } from "./util.tsx";
import { useGate } from "./gate.ts";
import { decayHint, dividendSummary, yieldPermilleText } from "./dividends.ts";

const SECTOR_KEYS = {
  tourism: "sec.sector.tourism",
  food: "sec.sector.food",
  rail: "sec.sector.rail",
  bank: "sec.sector.bank",
  energy: "sec.sector.energy",
  tech: "sec.sector.tech",
  realestate: "sec.sector.realestate",
} as const satisfies Record<SecuritySector, UiKey>;

/**
 * Scrolls the nearest scrolling ancestor just far enough to show the bottom of `el`. (`scrollIntoView`
 * would also move the clipped game container, which shifts the whole HUD.)
 */
function revealInScroller(el: HTMLElement): void {
  let parent = el.parentElement;
  while (parent && parent.scrollHeight <= parent.clientHeight) {
    parent = parent.parentElement;
  }
  if (!parent || getComputedStyle(parent).overflowY === "visible") {
    return;
  }
  // idempotent: the bottom of `el` ends up REVEAL_MARGIN_PX above the bottom edge, however often this runs
  const overflow =
    el.getBoundingClientRect().bottom - (parent.getBoundingClientRect().bottom - REVEAL_MARGIN_PX);
  if (overflow > 0) {
    parent.scrollTop += overflow;
  }
}

const REVEAL_MARGIN_PX = 8;
const SPARK_W = 72;
const SPARK_H = 26;

/** Inline-SVG price history of the last rounds; green when the latest price is above the first shown. */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  const step = values.length > 1 ? SPARK_W / (values.length - 1) : 0;
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(SPARK_H - 3 - ((v - lo) / span) * (SPARK_H - 6)).toFixed(1)}`,
    )
    .join(" ");
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  const trend = last > first ? "up" : last < first ? "down" : "flat";
  return (
    <svg
      class={`spark ${trend}`}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width={SPARK_W}
      height={SPARK_H}
      role="img"
      aria-label={label}
      data-testid="security-spark"
    >
      <title>{label}</title>
      {values.length > 1 ? (
        <polyline points={points} fill="none" stroke-width="2" stroke-linejoin="round" />
      ) : (
        <line x1="0" x2={SPARK_W} y1={SPARK_H / 2} y2={SPARK_H / 2} stroke-width="2" />
      )}
    </svg>
  );
}

function Change({ market, secId }: { market: Market; secId: string }) {
  const pct = changePercent(market, secId);
  const dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
  return (
    <span
      class={`sec-change ${dir}`}
      data-testid="security-change"
      data-dir={dir}
      title={t("sec.changeTitle", { pct: formatPercent(Math.abs(pct)) })}
    >
      {arrow} {formatPercent(Math.abs(pct))} %
    </span>
  );
}

function lockText(rounds: number): string {
  if (rounds <= 0) {
    return t("sec.lock.free");
  }
  return rounds === 1 ? t("sec.lock.one") : t("sec.lock.many", { rounds });
}

export function SecuritiesPanel() {
  const state = useGameState();
  const theme = useTheme();
  const texts = useThemeText();
  const you = useApp((s) => s.you);
  const [pick, setPick] = useState<string | null>(null);
  const [shares, setShares] = useState(1);
  const formRef = useRef<HTMLDivElement>(null);
  const gate = useGate();
  const pending = useApp((s) => s.pending);
  const actionError = useApp((s) => s.actionError);
  /** a purchase was sent: the form stays open until the server accepted it (a refusal keeps the shares) */
  const buying = useRef(false);
  useEffect(() => {
    if (buying.current && pending === null) {
      buying.current = false;
      if (actionError === null) {
        setPick(null);
      }
    }
  }, [pending, actionError]);
  // an opened buy form stays fully visible (the list scrolls inside the drawer / sheet); the web
  // fonts may still change the line heights after the first paint
  useEffect(() => {
    const reveal = () => {
      if (formRef.current) {
        revealInScroller(formRef.current);
      }
    };
    if (pick !== null) {
      reveal();
      void document.fonts.ready.then(reveal);
    }
  }, [pick, shares]);
  const market = state.market;
  if (!market) {
    return null;
  }
  const game = asGame(state);
  const me: PlayerState | undefined = state.players.find((p) => p.id === you);
  const money = (n: number) => formatMoney(theme, n);
  const nameOf = (c: SecurityDef): string => texts.securityNames[c.id] ?? c.name;
  const phase = state.phase;
  const isCur = state.players[state.current]?.id === you;
  const canBuyPhase = isCur && (phase.type === "await-roll" || phase.type === "await-end-turn");
  const canSellPhase =
    isCur &&
    (phase.type === "await-roll" || phase.type === "await-end-turn" || phase.type === "await-buy");
  const inDebt = phase.type === "debt" && phase.debtor === you;
  const holdings = me ? holdingsOf(me) : [];
  const headline =
    market.headline && market.headline.round === state.round ? market.headline : null;
  const companies = securitiesOf(game);

  const buyProblem = (secId: string, n: number): string | null => {
    if (!me) {
      return t("sec.spectator");
    }
    if (gate.reason) {
      return gate.reason;
    }
    if (!isCur) {
      return t("sec.blocker.notYourTurn");
    }
    if (!canBuyPhase) {
      return t("sec.blocker.phase");
    }
    const why = buyBlocker(game, me, secId, n);
    return why ? engineText(why, theme, playerName) : null;
  };

  const open = (secId: string) => {
    set({ actionError: null });
    setPick(pick === secId ? null : secId);
    setShares(1);
  };

  const totalValue = holdings.reduce(
    (sum, h) => sum + priceOfSecurity(game, h.secId) * h.shares,
    0,
  );
  const dividends = me
    ? dividendSummary(game, me)
    : { on: game.settings.securitiesDividends, next: 0, total: 0 };
  const totalCost = holdings.reduce((sum, h) => sum + h.buyPrice * h.shares, 0);

  const sellProblem = (h: Holding, index: number): string | null => {
    if (!me) {
      return t("sec.spectator");
    }
    if (gate.reason) {
      return gate.reason;
    }
    const plan = planSale(game, me, h.secId, index, inDebt);
    if (!plan.ok) {
      return engineText(plan.msg, theme, playerName);
    }
    return inDebt || canSellPhase ? null : t("sec.blocker.notYourTurn");
  };

  const debt = phase.type === "debt" && phase.debtor === you ? phase.amount : null;

  const headlineBlock = headline && (
    <div
      class={`sec-headline ${headline.kind}`}
      role="status"
      data-testid="securities-headline"
      data-kind={headline.kind}
    >
      <b>{t("sec.headline.label")}</b>
      <span>{engineText(headlineMsg(headline), theme, playerName)}</span>
    </div>
  );

  const marketBlock = (
    <>
      <h4>{t("sec.market")}</h4>
      <ul class="sec-list" data-testid="security-list">
        {companies.map((c) => {
          const price = market.prices[c.id] ?? c.startPrice;
          const hist = market.history[c.id] ?? [price];
          const held = holdings.filter((h) => h.secId === c.id).reduce((s, h) => s + h.shares, 0);
          const open_ = pick === c.id;
          const maxByCash = me ? Math.floor(me.cash / price) : 0;
          const maxShares = Math.max(1, Math.min(MAX_SHARES_PER_SECURITY - held, maxByCash));
          const n = Math.min(shares, maxShares);
          const problem = open_ ? buyProblem(c.id, n) : null;
          return (
            <li
              key={c.id}
              class={`sec-row ${open_ ? "open" : ""}`}
              data-testid="security-row"
              data-sec-id={c.id}
            >
              <div class="sec-main">
                <div class="sec-name">
                  <strong data-testid="security-name">{nameOf(c)}</strong>
                  <small>
                    {t(SECTOR_KEYS[c.sector])}
                    {held > 0 ? ` · ${t("sec.held", { n: held })}` : ""}
                  </small>
                  {dividends.on && (
                    <small class="sec-yield" data-testid="security-yield">
                      {yieldPermilleText(currentYieldPermille(game, c.id))}
                    </small>
                  )}
                </div>
                <Sparkline values={hist} label={t("sec.sparkTitle", { n: hist.length })} />
                <div class="sec-quote">
                  <b data-testid="security-price">{money(price)}</b>
                  <Change market={market} secId={c.id} />
                </div>
                {me && (
                  <button
                    type="button"
                    class="sq wide sec-open"
                    data-testid="security-buy-open"
                    aria-expanded={open_}
                    aria-label={`${t("sec.buy")}: ${nameOf(c)}`}
                    onClick={() => open(c.id)}
                  >
                    {t("sec.buy")}
                  </button>
                )}
              </div>
              {open_ && me && (
                <div class="sec-buy" data-testid="security-buy-form" ref={formRef}>
                  <div class="sec-stepper">
                    <span class="lbl">{t("sec.shares")}</span>
                    <span class="step">
                      <button
                        type="button"
                        aria-label={t("sec.fewerShares")}
                        data-testid="security-shares-minus"
                        onClick={() => setShares(Math.max(1, n - 1))}
                      >
                        −
                      </button>
                      <output data-testid="security-shares">{n}</output>
                      <button
                        type="button"
                        aria-label={t("sec.moreShares")}
                        data-testid="security-shares-plus"
                        onClick={() => setShares(Math.min(maxShares, n + 1))}
                      >
                        +
                      </button>
                    </span>
                    <button
                      type="button"
                      class="ghost max"
                      data-testid="security-shares-max"
                      onClick={() => setShares(maxShares)}
                    >
                      {t("sec.max")}
                    </button>
                  </div>
                  <div class="sec-cost" data-testid="security-cost">
                    {t("sec.cost")}: <b>{money(price * n)}</b>
                  </div>
                  <button
                    type="button"
                    class="cta slim"
                    data-testid="security-buy-confirm"
                    disabled={problem !== null}
                    onClick={() => {
                      buying.current = sendAction({
                        type: "buy-securities",
                        secId: c.id,
                        shares: n,
                      });
                    }}
                  >
                    {t("sec.buyShares", { shares: n, cost: money(price * n) })}
                  </button>
                  {problem && (
                    <p class="note sec-note" data-testid="securities-blocker">
                      {problem}
                    </p>
                  )}
                  {!problem && actionError && (
                    <p class="note sec-note bad" role="alert" data-testid="securities-error">
                      {actionError}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p class="note">
        {t("sec.rules", { max: MAX_SHARES_PER_SECURITY, pct: EMERGENCY_DISCOUNT_PERCENT })}
      </p>
      <p class="note" data-testid={dividends.on ? "dividend-rules" : "dividends-off"}>
        {dividends.on ? t("sec.div.rules", { pct: DIVIDEND_MIN_RATIO_PERCENT }) : t("sec.div.off")}
      </p>
      {dividends.on && (
        <p class="note" data-testid="dividend-decay">
          {decayHint(game)}
        </p>
      )}
    </>
  );

  const portfolioBlock = (
    <>
      <h4>{t("sec.portfolio")}</h4>
      {!me && <p class="note">{t("sec.spectator")}</p>}
      {me && holdings.length === 0 && (
        <p class="note" data-testid="portfolio-empty">
          {t("sec.emptyPortfolio")}
        </p>
      )}
      {holdings.length > 0 && (
        <>
          <div class="sec-total" data-testid="securities-value">
            <span>{t("sec.total")}</span>
            <b>{money(totalValue)}</b>
            <PL value={totalValue - totalCost} theme={theme} testid="securities-pl" />
          </div>
          {dividends.on && (
            <dl class="sec-dividends" data-testid="dividend-summary">
              <dt>{t("sec.div.next")}</dt>
              <dd data-testid="dividend-expected">+{money(dividends.next)}</dd>
              <dt>{t("sec.div.total")}</dt>
              <dd data-testid="dividend-total">{money(dividends.total)}</dd>
            </dl>
          )}
          <ul class="sec-list lots" data-testid="portfolio">
            {holdings.map((h, i) => {
              const c = companies.find((x) => x.id === h.secId);
              const price = priceOfSecurity(game, h.secId);
              const left = lockRoundsLeft(game, h);
              const plan = me ? planSale(game, me, h.secId, i, inDebt) : null;
              const emergency = plan?.ok === true && (plan.lots[0]?.emergency ?? false);
              const proceeds = saleProceeds(price, h.shares, emergency);
              const problem = sellProblem(h, i);
              return (
                <li
                  key={`${h.secId}-${h.boughtRound}-${h.buyPrice}-${i}`}
                  class="sec-row lot"
                  data-testid="lot-row"
                  data-sec-id={h.secId}
                  data-locked={left > 0}
                >
                  <div class="sec-main">
                    <div class="sec-name">
                      <strong>{c ? nameOf(c) : h.secId}</strong>
                      <small data-testid="lot-detail">
                        {t("sec.lot", { shares: h.shares, price: money(h.buyPrice) })}
                      </small>
                    </div>
                    <div class="sec-quote">
                      <b>{money(price * h.shares)}</b>
                      <PL value={(price - h.buyPrice) * h.shares} theme={theme} testid="lot-pl" />
                    </div>
                  </div>
                  <div class="sec-lotfoot">
                    <span
                      class={`lock ${left > 0 ? "on" : "free"}`}
                      data-testid="lot-lock"
                      data-rounds={left}
                    >
                      {left > 0 ? "🔒 " : ""}
                      {lockText(left)}
                    </span>
                    <button
                      type="button"
                      class={`${debt !== null ? "cta slim" : "ghost"} sec-sell`}
                      data-testid={emergency ? "lot-emergency-sell" : "lot-sell"}
                      disabled={problem !== null}
                      onClick={() =>
                        sendAction({ type: "sell-securities", secId: h.secId, lot: i })
                      }
                    >
                      {emergency
                        ? t("sec.emergencySell", { amount: money(proceeds) })
                        : t("sec.sellFor", { amount: money(proceeds) })}
                    </button>
                  </div>
                  {problem && (
                    <p class="note sec-note" data-testid="lot-blocker">
                      {problem}
                    </p>
                  )}
                  {emergency && (
                    <p class="note sec-note" data-testid="lot-emergency-note">
                      {t("sec.emergencyNote", { pct: EMERGENCY_DISCOUNT_PERCENT })}
                    </p>
                  )}
                  {debt !== null && me && problem === null && (
                    <p class="note sec-note sec-after" data-testid="lot-after-sale">
                      {(() => {
                        const left = debtAfterSale(debt, me.cash, proceeds);
                        return left > 0
                          ? t("sec.afterSale.remaining", { amount: money(left) })
                          : t("sec.afterSale.covered");
                      })()}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );

  // in debt the holdings and what a sale yields come first; the price list only matters again once the debt is paid
  return (
    <div class="secpanel" data-testid="securities-panel">
      {debt !== null && me && (
        <div class="sec-debt" role="status" data-testid="securities-debt">
          <b>{t("action.debt", { amount: money(debt) })}</b>
          <span>
            {t("sec.debt.summary", {
              cash: money(me.cash),
              missing: money(debtShortfall(debt, me.cash)),
            })}
          </span>
        </div>
      )}
      {headlineBlock}
      {debt !== null ? (
        <>
          {portfolioBlock}
          {marketBlock}
        </>
      ) : (
        <>
          {marketBlock}
          {portfolioBlock}
        </>
      )}
    </div>
  );
}

function PL({
  value,
  theme,
  testid,
}: {
  value: number;
  theme: { currency: { symbol: string; position: "before" | "after" } };
  testid: string;
}) {
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return (
    <span class={`sec-pl ${dir}`} data-testid={testid} data-dir={dir} title={t("sec.pl")}>
      {sign}
      {formatMoney(theme, Math.abs(value))}
    </span>
  );
}
