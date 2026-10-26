import { at } from "../safe.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  attemptSync,
  AUTO_BID_STEP,
  BOARD,
  JAIL_FINE,
  holdingsOf,
  legalActions,
  maxBid as maxBidOf,
  type GameAction,
  type PublicGameState,
} from "@poly/engine";
import { t } from "../i18n/index.ts";
import { sendAction } from "../net/ws.ts";
import { set, useApp } from "../net/store.ts";
import { asGame, money, useTheme } from "./util.tsx";
import { useGate } from "./gate.ts";

/** pre-filled auto-bid maximum: this far above the current highest bid (bounded by what the player can raise) */
const AUTO_BID_DEFAULT_ROOM = 100;
/** quick raises next to the bid slider */
const BID_STEPS = [10, 50] as const;

/** `compact`: only the primary action buttons (phone bottom sheet, which carries the secondary buttons as tabs) */
export function ActionBar({ compact = false }: { compact?: boolean }) {
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  if (!state || !you) return null;
  return <ActionBarFor state={state} you={you} compact={compact} />;
}

function ActionBarFor({
  state,
  you,
  compact,
}: {
  state: PublicGameState;
  you: string;
  compact: boolean;
}) {
  const theme = useTheme();
  const busy = useApp((s) => s.busy);
  const gate = useGate();
  const pendingIn = state.trades.filter((t) => t.status === "pending" && t.to === you).length;
  const legal = useMemo(() => {
    const r = attemptSync("actions:legal", () => legalActions(asGame(state), you));
    return r.ok ? r.value : [];
  }, [state, you]);
  const me = state.players.find((p) => p.id === you);
  const phase = state.phase;
  const can = (t: GameAction["type"]) => !busy && !gate.blocked && legal.includes(t);
  const act = (a: GameAction) => sendAction(a);

  const [bid, setBid] = useState(0);
  const hb = phase.type === "auction" ? phase.auction.highestBid : 0;
  useEffect(() => {
    setBid(hb + Math.max(10, Math.round(hb * 0.1)));
  }, [hb, phase.type]);

  // auto-bid input: null = not touched yet (a sensible default is derived from the highest bid)
  const [autoMax, setAutoMax] = useState<number | null>(null);
  useEffect(() => {
    setAutoMax(null);
  }, [phase.type]);

  if (!me) return null;
  const canRoll = can("roll");
  const again = phase.type === "await-end-turn" && phase.canRollAgain;
  const isMyTurn = state.players[state.current]?.id === you;

  let main: preact.ComponentChildren;
  let plain = false;
  if (phase.type === "auction") {
    const a = phase.auction;
    const myTurn = a.turn === you;
    const maxBid = maxBidOf(asGame(state), you);
    const bidder = state.players.find((p) => p.id === a.highestBidder);
    const myAuto = a.autoBids?.[you];
    const autoValue = autoMax ?? Math.min(maxBid, hb + AUTO_BID_DEFAULT_ROOM);
    const autoValid = Number.isInteger(autoValue) && autoValue > hb && autoValue <= maxBid;
    const bidValid = Number.isInteger(bid) && bid > hb && bid <= maxBid;
    const listed = at(BOARD, a.tile).price;
    main = (
      <div class="auction" data-testid="auction">
        <div class="atitle">
          {t("auction.title")} · <b>{theme.tileNames[a.tile]}</b>
          {listed !== undefined && (
            <small data-testid="auction-listed">
              {t("auction.listed", { price: money(theme, listed) })}
            </small>
          )}
        </div>
        <div class="asub" data-testid="auction-highest">
          {t("auction.highest")} {a.highestBid > 0 ? <b>{money(theme, a.highestBid)}</b> : "–"}
          {bidder ? ` ${t("auction.by", { name: bidder.name })}` : ""}
        </div>
        {myTurn && !busy ? (
          <div class="bidrow">
            <input
              type="range"
              data-testid="bid-slider"
              aria-label={t("auction.bidLabel")}
              min={hb + 1}
              max={Math.max(hb + 1, maxBid)}
              value={bid}
              onInput={(e) => setBid(Number((e.target as HTMLInputElement).value))}
            />
            {/* UI review F09: exact amounts without fiddling with the slider */}
            <div class="bidstep">
              <input
                type="number"
                inputMode="numeric"
                class="bidnum"
                data-testid="bid-amount"
                aria-label={t("auction.amountLabel")}
                min={hb + 1}
                max={maxBid}
                step={AUTO_BID_STEP}
                value={bid}
                onInput={(e) => setBid(Number((e.target as HTMLInputElement).value))}
              />
              {BID_STEPS.map((step) => (
                <button
                  type="button"
                  key={step}
                  class="ghost slim"
                  data-testid={`bid-plus-${step}`}
                  aria-label={t("auction.raise", { n: step })}
                  onClick={() => setBid(Math.min(maxBid, Math.max(hb + 1, bid + step)))}
                >
                  +{step}
                </button>
              ))}
            </div>
            <button
              class="cta slim"
              data-testid="action-bid"
              disabled={!can("bid") || !bidValid}
              onClick={() => act({ type: "bid", amount: bid })}
            >
              {t("auction.bid", { amount: money(theme, bid) })}
            </button>
            <button
              class="ghost"
              data-testid="action-pass"
              disabled={!can("pass-auction")}
              onClick={() => act({ type: "pass-auction" })}
            >
              {t("auction.pass")}
            </button>
            {!bidValid && (
              <p class="asub bidhint" role="status">
                {t("auction.range", { min: money(theme, hb + 1), max: money(theme, maxBid) })}
              </p>
            )}
          </div>
        ) : (
          <div class="asub">
            {t("auction.waitFor", {
              name: state.players.find((p) => p.id === a.turn)?.name ?? "?",
            })}
          </div>
        )}
        {can("set-auto-bid") && myAuto !== undefined && (
          <div class="autobid" data-testid="autobid">
            <span class="asub" data-testid="autobid-active">
              {t("auction.autoActive", { amount: money(theme, myAuto) })}
            </span>
            <button
              class="ghost"
              data-testid="autobid-cancel"
              onClick={() => act({ type: "set-auto-bid", max: null })}
            >
              {t("auction.autoCancel")}
            </button>
          </div>
        )}
        {can("set-auto-bid") && myAuto === undefined && maxBid > hb && (
          <div class="autobid" data-testid="autobid">
            <label class="autolabel">
              {t("auction.autoLabel")}
              <input
                type="number"
                inputMode="numeric"
                data-testid="autobid-input"
                min={hb + 1}
                max={maxBid}
                step={AUTO_BID_STEP}
                value={autoValue}
                onInput={(e) => setAutoMax(Number((e.target as HTMLInputElement).value))}
              />
            </label>
            <button
              class="ghost"
              data-testid="autobid-set"
              disabled={!autoValid}
              onClick={() => act({ type: "set-auto-bid", max: autoValue })}
            >
              {t("auction.autoSet")}
            </button>
            <p class="asub autohint" data-testid="autobid-hint">
              {t("auction.autoHint", { step: AUTO_BID_STEP })}
            </p>
          </div>
        )}
      </div>
    );
  } else if (phase.type === "await-buy" && isMyTurn) {
    const def = at(BOARD, phase.tile);
    main = (
      <div class="buy" data-testid="buy-offer">
        <div class="atitle">
          {theme.tileNames[phase.tile]} <small>{money(theme, def.price ?? 0)}</small>
        </div>
        <div class="btns">
          <button
            class="cta slim"
            data-testid="action-buy"
            disabled={!can("buy")}
            onClick={() => act({ type: "buy" })}
          >
            {t("action.buy")}
          </button>
          <button
            class="ghost"
            data-testid="action-decline"
            disabled={!can("decline-buy")}
            onClick={() => act({ type: "decline-buy" })}
          >
            {state.settings.auctions ? t("action.declineAuction") : t("action.decline")}
          </button>
        </div>
      </div>
    );
  } else if (phase.type === "debt" && phase.debtor === you) {
    main = (
      <div class="buy">
        <div class="atitle debt" data-testid="debt-notice">
          {t("action.debt", { amount: money(theme, phase.amount) })}{" "}
          <small>
            {t(
              state.settings.securities && holdingsOf(me).length > 0
                ? "action.debtHintSecurities"
                : "action.debtHint",
            )}
          </small>
        </div>
        <div class="btns">
          <button
            class="ghost bankrupt"
            data-testid="action-bankrupt"
            disabled={!can("declare-bankruptcy")}
            onClick={() => {
              if (confirm(t("confirm.bankrupt"))) act({ type: "declare-bankruptcy" });
            }}
          >
            {t("action.bankrupt")}
          </button>
        </div>
      </div>
    );
  } else {
    plain = true;
    main = (
      <div class="btns">
        {canRoll && (
          <button class="cta" data-testid="action-roll" onClick={() => act({ type: "roll" })}>
            {again ? t("action.rollAgain") : t("action.roll")}
          </button>
        )}
        {can("pay-jail-fine") && (
          <button
            class="ghost"
            data-testid="action-pay-jail"
            onClick={() => act({ type: "pay-jail-fine" })}
          >
            {t("action.payJail", { amount: money(theme, JAIL_FINE) })}
          </button>
        )}
        {can("use-jail-card") && (
          <button
            class="ghost"
            data-testid="action-jail-card"
            onClick={() => act({ type: "use-jail-card" })}
          >
            {t("action.jailCard")}
          </button>
        )}
        {can("end-turn") && (
          <button
            class="cta"
            data-testid="action-end-turn"
            onClick={() => act({ type: "end-turn" })}
          >
            {t("action.endTurn")}
          </button>
        )}
        {gate.reason ? (
          <span class="wait" role="status" data-testid="action-gate">
            {gate.reason}
          </span>
        ) : busy ? (
          <span class="wait">{t("action.busy")}</span>
        ) : (
          !canRoll &&
          !can("end-turn") && (
            <span class="wait">{isMyTurn ? t("action.busy") : t("action.waitOthers")}</span>
          )
        )}
        {me.inJail && phase.type === "await-roll" && isMyTurn && (
          <span class="hint" data-testid="jail-hint">
            {t("action.jailHint")}
          </span>
        )}
      </div>
    );
  }

  const gateNote =
    !plain && gate.reason ? (
      <p class="asub gate" role="status" data-testid="action-gate">
        {gate.reason}
      </p>
    ) : null;
  if (compact) {
    return (
      <div class="actionbar compact">
        {main}
        {gateNote}
      </div>
    );
  }
  return (
    <div class="actionbar panel" data-testid="action-bar">
      <div class="amain">
        {main}
        {gateNote}
      </div>
      <div class="asec">
        <button
          class="pill"
          data-testid="open-properties"
          onClick={() => set({ drawerOpen: true, drawerTab: "props" })}
        >
          {t("action.properties")}
        </button>
        {state.market && (
          <button
            class="pill"
            data-testid="open-securities"
            onClick={() => set({ drawerOpen: true, drawerTab: "securities" })}
          >
            {t("action.securities")}
          </button>
        )}
        <button
          class="pill"
          data-testid="open-trade"
          disabled={!legal.includes("propose-trade") && pendingIn === 0}
          onClick={() => set({ tradeOpen: true })}
        >
          {t("action.trade")}
          {pendingIn > 0 && <i class="pip">{pendingIn}</i>}
        </button>
        {legal.includes("declare-bankruptcy") ? null : (
          <button
            class="x"
            title={t("action.bankruptTitle")}
            aria-label={t("action.bankruptTitle")}
            disabled={busy || me.bankrupt}
            onClick={() => {
              if (confirm(t("confirm.giveUp"))) act({ type: "declare-bankruptcy" });
            }}
          >
            ⚑
          </button>
        )}
      </div>
    </div>
  );
}
