import { at } from "../safe.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  BOARD,
  MAX_COUNTERS,
  type PublicGameState,
  type Theme,
  type Trade,
  type TradeOffer,
} from "@poly/engine";
import { sendAction } from "../net/ws.ts";
import { set, useApp } from "../net/store.ts";
import { t } from "../i18n/index.ts";
import { tradeStatusText } from "../i18n/labels.ts";
import { money, Swatch, useTheme } from "./util.tsx";
import { canCounter, counterDraft, counterNote } from "./trade-counter.ts";
import { Modal } from "./Modal.tsx";
import { useGate } from "./gate.ts";

function describe(theme: Theme, tiles: number[], cash: number, jail: number): string {
  const parts = [...tiles.map((tl) => theme.tileNames[tl] ?? t("tile.fallback", { n: tl }))];
  if (cash > 0) {
    parts.push(money(theme, cash));
  }
  if (jail > 0) {
    parts.push(t("trade.jailCards", { n: jail }));
  }
  return parts.length ? parts.join(", ") : t("trade.nothing");
}

type NameOf = (id: string) => string;

/** "Ben: 260 instead of 200" under a counteroffer; nothing for original offers */
function CounterLine({ tr, trades, nameOf }: { tr: Trade; trades: Trade[]; nameOf: NameOf }) {
  const theme = useTheme();
  const note = counterNote(
    tr,
    trades.find((x) => x.id === tr.counterOf),
  );
  if (!note) return null;
  return (
    <div class="counter-note" data-testid="trade-counter-note">
      {note.kind === "cash"
        ? t("trade.counterCash", {
            name: nameOf(note.by),
            now: money(theme, note.now),
            was: money(theme, note.was),
          })
        : t("trade.counterChanged", { name: nameOf(note.by) })}
      {(tr.counterDepth ?? 0) > 0 && (
        <span class="counter-step">
          {" "}
          ({t("trade.counterStep", { n: tr.counterDepth ?? 0, max: MAX_COUNTERS })})
        </span>
      )}
    </div>
  );
}

/** an offer addressed to the player: accept, decline, or decline with a counteroffer */
function IncomingOffer({
  tr,
  trades,
  nameOf,
  onCounter,
}: {
  tr: Trade;
  trades: Trade[];
  nameOf: NameOf;
  onCounter: (tr: Trade) => void;
}) {
  const theme = useTheme();
  const gate = useGate();
  return (
    <div class="offer" data-testid="trade-offer" data-from={nameOf(tr.from)}>
      <div>
        <b>{nameOf(tr.from)}</b> {t("trade.offers")}{" "}
        <em>{describe(theme, tr.giveTiles, tr.giveCash, tr.giveJailCards)}</em> {t("trade.for")}{" "}
        <em>{describe(theme, tr.wantTiles, tr.wantCash, tr.wantJailCards)}</em>
      </div>
      <CounterLine tr={tr} trades={trades} nameOf={nameOf} />
      {!canCounter(tr) && (
        <div class="counter-note" data-testid="trade-counter-last">
          {t("trade.counterLast")}
        </div>
      )}
      <div class="btns">
        <button
          class="cta slim"
          data-testid="trade-accept"
          disabled={gate.blocked}
          onClick={() => sendAction({ type: "respond-trade", tradeId: tr.id, accept: true })}
        >
          {t("trade.accept")}
        </button>
        <button
          class="ghost"
          data-testid="trade-reject"
          disabled={gate.blocked}
          onClick={() => sendAction({ type: "respond-trade", tradeId: tr.id, accept: false })}
        >
          {t("trade.reject")}
        </button>
        {canCounter(tr) && (
          <button class="ghost" data-testid="trade-counter" onClick={() => onCounter(tr)}>
            {t("trade.counter")}
          </button>
        )}
      </div>
    </div>
  );
}

/** a closed or outgoing offer with its status and, for counteroffers, the price note */
function HistoryRow({
  tr,
  you,
  trades,
  nameOf,
  withdraw,
}: {
  tr: Trade;
  you: string;
  trades: Trade[];
  nameOf: NameOf;
  withdraw: boolean;
}) {
  const theme = useTheme();
  const gate = useGate();
  return (
    <div class="offer small" data-testid="trade-history">
      <span>
        {tr.from === you
          ? t("trade.to", { name: nameOf(tr.to) })
          : t("trade.from", { name: nameOf(tr.from) })}
        : {describe(theme, tr.giveTiles, tr.giveCash, tr.giveJailCards)} ⇄{" "}
        {describe(theme, tr.wantTiles, tr.wantCash, tr.wantJailCards)}
      </span>
      <span class={`st ${tr.status}`} data-testid="trade-status">
        {tradeStatusText(tr.status)}
      </span>
      {withdraw && tr.status === "pending" && tr.from === you && (
        <button
          class="ghost"
          disabled={gate.blocked}
          onClick={() => sendAction({ type: "cancel-trade", tradeId: tr.id })}
        >
          {t("trade.withdraw")}
        </button>
      )}
      <CounterLine tr={tr} trades={trades} nameOf={nameOf} />
    </div>
  );
}

export function TradeDialog() {
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  const me = state?.players.find((p) => p.id === you);
  if (!state || !you || !me) return null;
  return <TradeDialogFor state={state} you={you} me={me} />;
}

function TradeDialogFor({
  state,
  you,
  me,
}: {
  state: PublicGameState;
  you: string;
  me: PublicGameState["players"][number];
}) {
  const theme = useTheme();
  const draft = useApp((s) => s.tradeDraft);
  const others = state.players.filter((p) => p.id !== you && !p.bankrupt);
  const [to, setTo] = useState(draft?.to ?? others[0]?.id ?? "");
  const [giveTiles, setGT] = useState<number[]>(draft?.giveTiles ?? []);
  const [wantTiles, setWT] = useState<number[]>(draft?.wantTiles ?? []);
  const [giveCash, setGC] = useState(draft?.giveCash ?? 0);
  const [wantCash, setWC] = useState(draft?.wantCash ?? 0);
  const [giveJail, setGJ] = useState(draft?.giveJailCards ?? 0);
  const [wantJail, setWJ] = useState(draft?.wantJailCards ?? 0);
  const [replace, setReplace] = useState<string | null>(draft?.counterOf ?? null);
  const partner = state.players.find((p) => p.id === to);

  const ownedBy = (id: string) =>
    Object.entries(state.properties)
      .filter(([, p]) => p.owner === id && p.level === 0)
      .map(([i]) => Number(i))
      .sort((a, b) => a - b);
  const toggle = (arr: number[], tr: number) =>
    arr.includes(tr) ? arr.filter((x) => x !== tr) : [...arr, tr];

  const incoming = state.trades.filter((tr) => tr.status === "pending" && tr.to === you);
  const outgoing = state.trades
    .filter((tr) => tr.from === you || tr.to === you)
    .filter((tr) => !(tr.status === "pending" && tr.to === you))
    .slice(-6)
    .reverse();
  /** the incoming offer the form currently answers with a counteroffer (gone once it is no longer open) */
  const countering = replace
    ? incoming.find((tr) => tr.id === replace && canCounter(tr))
    : undefined;

  const close = () => set({ tradeOpen: false, tradeDraft: null });
  const valid =
    !!partner &&
    giveTiles.length + wantTiles.length + giveCash + wantCash + giveJail + wantJail > 0;
  const gate = useGate();
  // an old refusal must not greet the player when the dialog opens
  useEffect(() => {
    set({ actionError: null });
  }, []);
  const pending = useApp((s) => s.pending);
  const actionError = useApp((s) => s.actionError);
  /** the offer was sent and the server has not answered yet: the draft stays until it is accepted */
  const submitted = useRef(false);
  function clearDraft() {
    setReplace(null);
    setGT([]);
    setWT([]);
    setGC(0);
    setWC(0);
    setGJ(0);
    setWJ(0);
  }
  useEffect(() => {
    if (submitted.current && pending === null) {
      submitted.current = false;
      // accepted: start fresh; refused (error shown below): every input stays as the player left it
      if (actionError === null) {
        clearDraft();
      }
    }
  }, [pending, actionError]);
  function propose() {
    const offer: TradeOffer = {
      to,
      giveCash,
      giveTiles,
      giveJailCards: giveJail,
      wantCash,
      wantTiles,
      wantJailCards: wantJail,
    };
    submitted.current = sendAction(
      countering
        ? { type: "counter-trade", tradeId: countering.id, offer }
        : { type: "propose-trade", offer },
    );
  }
  function counter(tr: Trade) {
    // flip perspective: what they gave becomes what I want
    const d = counterDraft(tr);
    setTo(tr.from);
    setWT(d.wantTiles);
    setWC(d.wantCash);
    setWJ(d.wantJailCards);
    setGT(d.giveTiles);
    setGC(d.giveCash);
    setGJ(d.giveJailCards);
    setReplace(tr.id);
  }
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "?";

  return (
    <Modal
      class="modal-bg"
      label={t("trade.title")}
      onClose={close}
      returnFocusTo='[data-testid="open-trade"], [data-testid="sheet-tab-trades"]'
    >
      <div class="panel trade" data-testid="trade-dialog">
        <div class="dhead">
          <h3>{t("trade.title")}</h3>
          <button
            class="x"
            data-testid="trade-close"
            aria-label={t("common.close")}
            onClick={close}
          >
            ×
          </button>
        </div>
        <div class="tbody">
          {incoming.length > 0 && (
            <section class="incoming">
              <h4>{t("trade.incoming")}</h4>
              {incoming.map((tr) => (
                <IncomingOffer
                  key={tr.id}
                  tr={tr}
                  trades={state.trades}
                  nameOf={nameOf}
                  onCounter={counter}
                />
              ))}
            </section>
          )}
          <section>
            <h4 data-testid="trade-form-title">
              {countering
                ? t("trade.counterTitle", { name: nameOf(countering.from) })
                : t("trade.newOffer")}
            </h4>
            {countering && (
              <button
                class="ghost slim"
                data-testid="trade-counter-cancel"
                onClick={() => {
                  setReplace(null);
                  clearDraft();
                }}
              >
                {t("trade.counterCancel")}
              </button>
            )}
            <div class="partners" hidden={!!countering}>
              {others.map((p) => (
                <button
                  key={p.id}
                  data-testid="trade-partner"
                  data-player-name={p.name}
                  aria-pressed={to === p.id}
                  class={`chip ${to === p.id ? "on" : ""}`}
                  onClick={() => {
                    setTo(p.id);
                    setWT([]);
                    setWC(0);
                    setWJ(0);
                  }}
                >
                  <Swatch color={p.color} /> {p.name}
                </button>
              ))}
            </div>
            <div class="sides">
              <Side
                title={t("trade.youGive")}
                tiles={ownedBy(you)}
                sel={giveTiles}
                onTile={(tr) => setGT(toggle(giveTiles, tr))}
                cash={giveCash}
                setCash={setGC}
                maxCash={me.cash}
                jail={giveJail}
                setJail={setGJ}
                maxJail={me.jailCards.length}
                theme={theme}
              />
              <Side
                title={partner ? t("trade.theyGive", { name: partner.name }) : t("trade.otherSide")}
                tiles={partner ? ownedBy(partner.id) : []}
                sel={wantTiles}
                onTile={(tr) => setWT(toggle(wantTiles, tr))}
                cash={wantCash}
                setCash={setWC}
                maxCash={partner?.cash ?? 0}
                jail={wantJail}
                setJail={setWJ}
                maxJail={partner?.jailCards.length ?? 0}
                theme={theme}
              />
            </div>
          </section>
          {outgoing.length > 0 && (
            <section>
              <h4>{t("trade.statusTitle")}</h4>
              {outgoing.map((tr) => (
                <HistoryRow
                  key={tr.id}
                  tr={tr}
                  you={you}
                  trades={state.trades}
                  nameOf={nameOf}
                  withdraw
                />
              ))}
            </section>
          )}
        </div>
        <div class="tfoot">
          <div class="tsummary" data-testid="trade-summary">
            <p data-testid="trade-summary-give">
              <b>{t("trade.youGive")}</b>
              {describe(theme, giveTiles, giveCash, giveJail)}
            </p>
            <p data-testid="trade-summary-get">
              <b>{t("trade.youGet")}</b>
              {describe(theme, wantTiles, wantCash, wantJail)}
            </p>
          </div>
          {(gate.reason ?? actionError) && (
            <p
              class={`tnote ${gate.reason === null ? "bad" : ""}`}
              role={gate.reason === null ? "alert" : "status"}
              data-testid="trade-note"
            >
              {gate.reason ?? actionError}
            </p>
          )}
          <button
            class="cta"
            data-testid="trade-send"
            disabled={!valid || gate.blocked}
            aria-describedby={valid ? undefined : "trade-send-reason"}
            onClick={propose}
          >
            {countering ? t("trade.counterSend") : t("trade.send")}
          </button>
          {!valid && (
            <p class="treason" id="trade-send-reason" data-testid="trade-send-reason">
              {partner ? t("trade.sendBlocked.empty") : t("trade.sendBlocked.noPartner")}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** compact list of incoming offers and recent trade status (phone sheet tab) */
export function TradeInbox() {
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  if (!state) return null;
  if (!you) {
    return <p class="note">{t("trade.spectator")}</p>;
  }
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "?";
  const incoming = state.trades.filter((tr) => tr.status === "pending" && tr.to === you);
  const recent = state.trades
    .filter((tr) => tr.from === you || tr.to === you)
    .filter((tr) => !(tr.status === "pending" && tr.to === you))
    .slice(-6)
    .reverse();
  return (
    <div class="trade-inbox">
      <button class="cta" data-testid="trade-new" onClick={() => set({ tradeOpen: true })}>
        {t("trade.newOffer")}
      </button>
      {incoming.length === 0 && recent.length === 0 && <p class="note">{t("trade.none")}</p>}
      {incoming.map((tr) => (
        <IncomingOffer
          key={tr.id}
          tr={tr}
          trades={state.trades}
          nameOf={nameOf}
          onCounter={(o) =>
            set({ tradeOpen: true, tradeDraft: { ...counterDraft(o), counterOf: o.id } })
          }
        />
      ))}
      {recent.map((tr) => (
        <HistoryRow
          key={tr.id}
          tr={tr}
          you={you}
          trades={state.trades}
          nameOf={nameOf}
          withdraw={false}
        />
      ))}
    </div>
  );
}

function Side(p: {
  title: string;
  tiles: number[];
  sel: number[];
  onTile: (tr: number) => void;
  cash: number;
  setCash: (n: number) => void;
  maxCash: number;
  jail: number;
  setJail: (n: number) => void;
  maxJail: number;
  theme: Theme;
}) {
  return (
    <div class="side">
      <h5>{p.title}</h5>
      <div class="tilelist">
        {p.tiles.length === 0 && <span class="note">{t("trade.noTiles")}</span>}
        {p.tiles.map((tr) => {
          const d = at(BOARD, tr);
          const c = d.kind === "street" ? p.theme.groupColors[d.group ?? 0] : "#b9b2c4";
          return (
            <button
              key={tr}
              data-testid="trade-tile"
              data-tile-name={p.theme.tileNames[tr]}
              data-side={p.title}
              aria-pressed={p.sel.includes(tr)}
              class={`tile-pick ${p.sel.includes(tr) ? "on" : ""}`}
              onClick={() => p.onTile(tr)}
            >
              <i style={{ background: c }} />
              {p.theme.tileNames[tr]}
            </button>
          );
        })}
      </div>
      <label class="amount">
        {t("trade.cash")}
        <input
          type="number"
          data-testid="trade-cash"
          aria-label={t("trade.cashAria", { side: p.title })}
          inputMode="numeric"
          min={0}
          max={p.maxCash}
          step={10}
          value={p.cash}
          onInput={(e) =>
            p.setCash(
              Math.max(0, Math.min(p.maxCash, Number((e.target as HTMLInputElement).value) || 0)),
            )
          }
        />
      </label>
      {p.maxJail > 0 && (
        <label class="amount">
          {t("trade.jailCardsLabel")}
          <input
            type="number"
            min={0}
            max={p.maxJail}
            value={p.jail}
            onInput={(e) =>
              p.setJail(
                Math.max(0, Math.min(p.maxJail, Number((e.target as HTMLInputElement).value) || 0)),
              )
            }
          />
        </label>
      )}
    </div>
  );
}
