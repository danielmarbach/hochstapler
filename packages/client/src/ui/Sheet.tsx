import { useEffect, useRef, useState } from "preact/hooks";
import { t, type UiKey } from "../i18n/index.ts";
import { useApp } from "../net/store.ts";
import { sendAction } from "../net/ws.ts";
import { ActionBar } from "./Actions.tsx";
import { PlayerPanels, useTurn } from "./Hud.tsx";
import { PropertyList } from "./Property.tsx";
import { TradeInbox } from "./Trade.tsx";
import { BoardList } from "./Board.tsx";
import { LogBody, useUnreadChat } from "./Log.tsx";
import { panelProps, tabKeys, tabProps } from "./tabs.ts";
import { SecuritiesPanel } from "./Securities.tsx";
import { Cash, fmtTime, useGameState, useTheme } from "./util.tsx";

type Tab = "players" | "props" | "board" | "securities" | "trades" | "log";
const TABS = [
  { id: "players", label: "sheet.tab.players" },
  { id: "props", label: "sheet.tab.props" },
  { id: "board", label: "sheet.tab.board" },
  { id: "securities", label: "sheet.tab.securities" },
  { id: "trades", label: "sheet.tab.trades" },
  { id: "log", label: "sheet.tab.log" },
] as const satisfies readonly { id: Tab; label: UiKey }[];
/** pointer travel (px) that turns a tap into a drag, and the travel needed to flip the sheet */
const DRAG_START_PX = 6;
const DRAG_FLIP_PX = 40;

/**
 * Phone-portrait HUD: collapsed it shows the current player, cash, countdown and the primary action buttons;
 * dragging or tapping the handle expands it to tabs (players, own properties, trades, log/chat).
 */
export function BottomSheet() {
  const theme = useTheme();
  const you = useApp((s) => s.you);
  const state = useGameState();
  const pending = useApp((s) =>
    s.you
      ? (s.state?.trades.filter((t) => t.status === "pending" && t.to === s.you).length ?? 0)
      : 0,
  );
  const { who, mover, left, round } = useTurn();
  const unread = useUnreadChat();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("players");
  const tabs = TABS.filter((item) => item.id !== "securities" || state.market !== undefined);
  const [drag, setDrag] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const peek = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ y: number; moved: boolean } | null>(null);

  // the collapsed height drives both the sheet offset and the room left for the 3D canvas
  useEffect(() => {
    const el = peek.current;
    const game = root.current?.closest<HTMLElement>(".game");
    if (!el || !game) {
      return undefined;
    }
    const apply = () => {
      game.style.setProperty("--peek", `${el.offsetHeight}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      game.style.removeProperty("--peek");
    };
  }, []);

  const me = state.players.find((p) => p.id === you) ?? who;
  const openLabel = [
    t("sheet.open"),
    ...(pending > 0 ? [t("sheet.pendingTrades", { n: pending })] : []),
    ...(unread > 0 ? [t("sheet.unreadChat", { n: unread })] : []),
  ].join(", ");
  const toggle = () => setOpen((o) => !o);
  const turnText = who
    ? mover
      ? t("turn.bidding", { name: who.name })
      : t("turn.onShort", { name: who.name })
    : t("turn.running");

  return (
    <div
      ref={root}
      class={`sheet panel ${open ? "open" : ""} ${drag !== null ? "dragging" : ""}`}
      style={drag !== null ? { "--drag": `${drag}px` } : {}}
      role="region"
      aria-label={t("sheet.title")}
      data-testid="sheet"
      data-open={open}
    >
      <div class="sheet-peek" ref={peek}>
        <div
          class="grabzone"
          onPointerDown={(e) => {
            if (e.button !== 0) {
              return;
            }
            gesture.current = { y: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(0);
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g) {
              return;
            }
            const dy = e.clientY - g.y;
            if (Math.abs(dy) > DRAG_START_PX) {
              g.moved = true;
            }
            setDrag(dy);
          }}
          onPointerUp={(e) => {
            const g = gesture.current;
            gesture.current = null;
            setDrag(null);
            if (!g) {
              return;
            }
            const dy = e.clientY - g.y;
            if (!g.moved) {
              toggle();
            } else if (dy < -DRAG_FLIP_PX) {
              setOpen(true);
            } else if (dy > DRAG_FLIP_PX) {
              setOpen(false);
            }
          }}
          onPointerCancel={() => {
            gesture.current = null;
            setDrag(null);
          }}
        >
          <button
            class="grab"
            data-testid="sheet-handle"
            type="button"
            aria-expanded={open}
            aria-label={open ? t("sheet.collapse") : t("sheet.expand")}
            onClick={(e) => {
              if (e.detail === 0) {
                toggle();
              }
            }}
          >
            <i />
          </button>
          <div class="sum">
            <div class="sum-who">
              {who && <span class="tdot" style={{ background: who.color }} />}
              <div>
                <div class="tname" title={turnText}>
                  {turnText}
                </div>
                <div class="tsub">{round}</div>
              </div>
            </div>
            {left !== null && (
              <div class={`count ${left < 10 ? "hot" : ""}`} role="timer">
                {fmtTime(left)}
              </div>
            )}
            {me && (
              <div class="sum-cash" data-testid="sheet-cash">
                <small>{me.id === you ? t("sheet.you") : me.name}</small>
                <b>
                  <Cash value={me.cash} theme={theme} />
                </b>
              </div>
            )}
            <button
              type="button"
              class="sheet-open"
              data-testid="sheet-open"
              aria-expanded={open}
              aria-label={openLabel}
              onClick={(e) => {
                if (e.detail === 0) {
                  toggle();
                }
              }}
            >
              <span class="so-ico" aria-hidden="true">
                {open ? "▾" : "☰"}
              </span>
              {t("sheet.open")}
              {pending + unread > 0 && <i class="pip">{pending + unread}</i>}
            </button>
          </div>
        </div>
        {you && <ActionBar compact />}
      </div>
      <div class="sheet-body">
        <div
          class={`stabs ${tabs.length > 4 ? "many" : ""}`}
          role="tablist"
          aria-label={t("sheet.title")}
          onKeyDown={tabKeys(
            "sheet",
            tabs.map((item) => item.id),
            tab,
            (id) => {
              const next = tabs.find((item) => item.id === id);
              if (next) {
                setTab(next.id);
              }
            },
          )}
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              {...tabProps("sheet", item.id, tab)}
              data-testid={`sheet-tab-${item.id}`}
              class={tab === item.id ? "on" : ""}
              onClick={() => setTab(item.id)}
            >
              {t(item.label)}
              {item.id === "trades" && pending > 0 && <i class="pip">{pending}</i>}
              {item.id === "log" && unread > 0 && <i class="pip">{unread}</i>}
            </button>
          ))}
        </div>
        <div
          class="sheet-pane"
          {...panelProps("sheet", tab)}
          data-testid="sheet-pane"
          data-tab={tab}
        >
          {tab === "players" && (
            <>
              <PlayerPanels inline />
              {you && !state.players.find((p) => p.id === you)?.bankrupt && (
                <button
                  class="danger"
                  data-testid="sheet-give-up"
                  onClick={() => {
                    if (confirm(t("confirm.giveUp"))) {
                      sendAction({ type: "declare-bankruptcy" });
                    }
                  }}
                >
                  {t("sheet.giveUp")}
                </button>
              )}
            </>
          )}
          {tab === "props" &&
            (you ? <PropertyList /> : <p class="note">{t("sheet.spectatorNoProps")}</p>)}
          {tab === "board" && <BoardList />}
          {tab === "securities" && <SecuritiesPanel />}
          {tab === "trades" && <TradeInbox />}
          {tab === "log" && (
            <div class="logpane">
              <LogBody />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
