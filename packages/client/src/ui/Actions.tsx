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
import { tileKindText } from "../i18n/labels.ts";
import { buyInfo } from "./buy-info.ts";
import { defaultBid, exceedsCash, stepBid } from "./bid.ts";
import { inkOn } from "./palette.ts";
import { TokenIcon } from "./TokenIcon.tsx";
import { asGame, money, useTheme, useThemeText } from "./util.tsx";
import { useGate } from "./gate.ts";
import { BankruptcyDialog, type BankruptcyKind } from "./Bankruptcy.tsx";
import { debtCreditorName, debtShortfall, noBreak } from "./debt.ts";
import { Icon } from "./icons.tsx";

/** pre-filled auto-bid maximum: this far above the current highest bid (bounded by what the player can raise) */
const AUTO_BID_DEFAULT_ROOM = 100;
/** the - / + buttons next to the bid amount move it by this much; the extra chip raises it by the larger jump */
const BID_STEP = 10;
const BID_JUMP = 50;

/**
 * "You owe Ben CHF 900 · you are CHF 850 short": whom the debt is owed to (null = bank) and what the cash does not cover.
 * Both parts wrap as units and the amounts keep their currency, so a narrow phone never strands "CHF 380" on its own line.
 */
function DebtLine({
  creditor,
  amount,
  missing,
}: {
  creditor: string | null;
  amount: string;
  missing: string | null;
}) {
  const owed = creditor
    ? t("action.debtTo", { name: creditor, amount: noBreak(amount) })
    : t("action.debtToBank", { amount: noBreak(amount) });
  return (
    <span class="debt-line">
      <span class="debt-part">{missing ? `${owed}\u00a0·` : owed}</span>
      {missing && (
        <>
          {" "}
          <span class="debt-part">{t("action.debtMissing", { amount: noBreak(missing) })}</span>
        </>
      )}
    </span>
  );
}

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
  const texts = useThemeText();
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

  const [confirming, setConfirming] = useState<BankruptcyKind | null>(null);
  const [bid, setBid] = useState(0);
  const hb = phase.type === "auction" ? phase.auction.highestBid : 0;
  useEffect(() => {
    setBid(defaultBid(hb));
  }, [hb, phase.type]);

  // auto-bid input: null = not touched yet (a sensible default is derived from the highest bid)
  const [autoMax, setAutoMax] = useState<number | null>(null);
  // the auto-bid controls take the place of the manual bid while they are open: one bidding model at a time
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    setAutoMax(null);
    setAutoOpen(false);
  }, [phase.type]);

  if (!me) return null;
  const canRoll = can("roll");
  /** show-off mode: the loan dialog (borrow before buying or building, repay any time on the own turn) */
  const loanButton = (cls: string) =>
    state.settings.loans && !me.bankrupt ? (
      <button
        class={cls}
        data-testid="open-loan"
        disabled={!legal.includes("take-loan") && !legal.includes("repay-loan")}
        onClick={() => set({ loanOpen: true })}
      >
        {t("action.loan")}
      </button>
    ) : null;
  const again = phase.type === "await-end-turn" && phase.canRollAgain;
  const isMyTurn = state.players[state.current]?.id === you;
  /** the own bid is the only decision: properties, trading, securities, loans and giving up would only compete with it */
  const biddingNow = phase.type === "auction" && phase.auction.turn === you;
  const propertiesButton = (
    <button
      class="pill"
      data-testid="open-properties"
      onClick={() => set({ drawerOpen: true, drawerTab: "props" })}
    >
      {t("action.properties")}
    </button>
  );

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
    const turnName = state.players.find((p) => p.id === a.turn)?.name ?? "?";
    main = (
      <div class={`auction${myTurn ? " mine" : ""}`} data-testid="auction">
        <div class="atitle">
          {t("auction.title")} · <b>{theme.tileNames[a.tile]}</b>
        </div>
        <div class="ameta">
          {listed !== undefined && (
            <small data-testid="auction-listed">
              {t("auction.listed", { price: money(theme, listed) })}
            </small>
          )}
          <p class="aturn" data-testid="auction-turn" role="status">
            {myTurn ? t("auction.yourTurn") : t("auction.waitFor", { name: turnName })}
          </p>
        </div>
        <div class="alot">
          <div
            class={`aleader${bidder ? "" : " none"}`}
            data-testid="auction-leader"
            style={bidder ? { "--pc": bidder.color, "--pt": inkOn(bidder.color) } : undefined}
          >
            <span class="aseal" aria-hidden="true">
              {bidder ? <TokenIcon id={bidder.tokenId} size={34} /> : "?"}
            </span>
            <div class="atext" data-testid="auction-highest">
              <span class="alabel">{t("auction.highest")}</span>{" "}
              <b class="abid">{a.highestBid > 0 ? money(theme, a.highestBid) : "–"}</b>{" "}
              <span class="aby">
                {bidder ? t("auction.by", { name: bidder.name }) : t("auction.noBid")}
              </span>
            </div>
          </div>
          <div class="acash" data-testid="auction-cash">
            <span class="alabel">{t("auction.yourCash")}</span>{" "}
            <b class="abid">{money(theme, me.cash)}</b>
          </div>
        </div>
        {myTurn && !busy && !autoOpen && (
          <div class="bidrow">
            {/* UI review F09: exact amounts stay possible, the amount itself is the field between - and + */}
            <div class="bidstep" role="group" aria-label={t("auction.amountLabel")}>
              <button
                type="button"
                class="ghost step"
                data-testid={`bid-minus-${BID_STEP}`}
                aria-label={t("auction.lower", { n: BID_STEP })}
                onClick={() => setBid(stepBid(bid, -BID_STEP, hb, maxBid))}
              >
                −
              </button>
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && bidValid && can("bid")) {
                    act({ type: "bid", amount: bid });
                  }
                }}
              />
              <button
                type="button"
                class="ghost step"
                data-testid={`bid-plus-${BID_STEP}`}
                aria-label={t("auction.raise", { n: BID_STEP })}
                onClick={() => setBid(stepBid(bid, BID_STEP, hb, maxBid))}
              >
                +
              </button>
              <button
                type="button"
                class="ghost step jump"
                data-testid={`bid-plus-${BID_JUMP}`}
                aria-label={t("auction.raise", { n: BID_JUMP })}
                onClick={() => setBid(stepBid(bid, BID_JUMP, hb, maxBid))}
              >
                +{BID_JUMP}
              </button>
            </div>
            <div class="bidgo">
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
            </div>
            {!bidValid && (
              <p class="asub bidhint" role="status">
                {t("auction.range", { min: money(theme, hb + 1), max: money(theme, maxBid) })}
              </p>
            )}
            {bidValid && exceedsCash(bid, me.cash) && (
              <p class="asub bidhint" data-testid="bid-over-cash" role="status">
                {t("auction.overCash")}
              </p>
            )}
          </div>
        )}
        <div class="aextra">
          {can("set-auto-bid") && myAuto !== undefined && (
            <div class="autobid active" data-testid="autobid">
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
              <button
                type="button"
                class="autotoggle"
                data-testid="autobid-toggle"
                aria-expanded={autoOpen}
                onClick={() => setAutoOpen(!autoOpen)}
              >
                {t("auction.autoToggle")}
              </button>
              {autoOpen && (
                <div class="autobody">
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
                    onClick={() => {
                      act({ type: "set-auto-bid", max: autoValue });
                      setAutoOpen(false);
                    }}
                  >
                    {t("auction.autoSet")}
                  </button>
                  <p class="asub autohint" data-testid="autobid-hint">
                    {t("auction.autoHint", { step: AUTO_BID_STEP })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  } else if (phase.type === "await-buy" && isMyTurn) {
    const def = at(BOARD, phase.tile);
    const info = buyInfo(asGame(state), you, phase.tile);
    const group = info?.group;
    const groupLabel =
      typeof group === "number" ? (texts.groupNames[group] ?? "") : tileKindText(def.kind);
    main = (
      <div class="buy" data-testid="buy-offer">
        <div class="atitle">
          {theme.tileNames[phase.tile]} <small>{money(theme, def.price ?? 0)}</small>
        </div>
        {info && (
          <ul class="buyinfo">
            <li data-testid="buy-rent">
              {t("buy.rent", {
                rent:
                  info.kind === "utility"
                    ? t("prop.utilityRent", { n: info.rent })
                    : money(theme, info.rent),
              })}
            </li>
            <li data-testid="buy-group" class={info.complete ? "full" : undefined}>
              {t(info.complete ? "buy.groupFull" : "buy.group", {
                group: groupLabel,
                owned: info.owned,
                total: info.total,
              })}
            </li>
            <li data-testid="buy-cash" class={info.cashAfter < 0 ? "short" : undefined}>
              {t("buy.cashAfter", { amount: money(theme, info.cashAfter) })}
            </li>
          </ul>
        )}
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
          {compact && legal.includes("take-loan") && loanButton("ghost")}
        </div>
      </div>
    );
  } else if (phase.type === "debt" && phase.debtor === you) {
    main = (
      <div class="buy">
        <div class="atitle debt" data-testid="debt-notice">
          <DebtLine
            creditor={debtCreditorName(phase.creditor, state.players)}
            amount={money(theme, phase.amount)}
            missing={
              debtShortfall(phase.amount, me.cash) > 0
                ? money(theme, debtShortfall(phase.amount, me.cash))
                : null
            }
          />{" "}
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
            onClick={() => setConfirming("debt")}
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
        {compact &&
          (legal.includes("take-loan") || legal.includes("repay-loan")) &&
          loanButton("ghost")}
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
  const confirmDialog = confirming && (
    <BankruptcyDialog kind={confirming} onClose={() => setConfirming(null)} />
  );
  if (compact) {
    return (
      <div class="actionbar compact">
        {main}
        {gateNote}
        {confirmDialog}
      </div>
    );
  }
  return (
    <div class={`actionbar panel${autoOpen ? " autoing" : ""}`} data-testid="action-bar">
      <div class="amain">
        {main}
        {gateNote}
      </div>
      {confirmDialog}
      {!biddingNow && (
        <div class="asec">
          {propertiesButton}
          {state.market && (
            <button
              class="pill"
              data-testid="open-securities"
              onClick={() => set({ drawerOpen: true, drawerTab: "securities" })}
            >
              {t("action.securities")}
            </button>
          )}
          {loanButton("pill")}
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
              class="x giveup"
              data-testid="action-give-up"
              title={t("action.bankruptTitle")}
              aria-label={t("sheet.giveUp")}
              disabled={busy || me.bankrupt}
              onClick={() => setConfirming("giveUp")}
            >
              <Icon name="flag" />
              <span class="tlabel">{t("action.giveUp")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
