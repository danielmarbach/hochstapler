import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { MAX_CHAT_LENGTH } from "@poly/engine";
import { set, useApp } from "../net/store.ts";
import { sendChat } from "../net/ws.ts";
import { t } from "../i18n/index.ts";
import { logText, useTheme } from "./util.tsx";
import { ChatHostControls, QuickBar, quickText, refusedText } from "./ChatControls.tsx";
import { panelProps, tabKeys, tabProps } from "./tabs.ts";

/** the list counts as "at the bottom" within this distance; only then new lines scroll into view */
export const NEAR_BOTTOM_PX = 24;

/** true when a scroll container shows its end (or is too short to scroll) */
export function nearBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

/** chat messages the player has not seen yet */
export function useUnreadChat(): number {
  return useApp((s) => Math.max(0, s.chatSeq - s.chatReadSeq));
}

const LOG_TABS = ["log", "chat"] as const;
type LogTab = (typeof LOG_TABS)[number];

/** protocol + chat with tabs; used in the desktop panel and in the phone sheet */
export function LogBody({ onClose }: { onClose?: () => void }) {
  const theme = useTheme();
  const open = useApp((s) => s.logOpen);
  const log = useApp((s) => s.state?.log ?? []);
  const chat = useApp((s) => s.chat);
  const chatSeq = useApp((s) => s.chatSeq);
  const unread = useUnreadChat();
  const connected = useApp((s) => s.connected);
  const you = useApp((s) => s.you);
  const players = useApp((s) => s.state?.players ?? []);
  const mode = useApp((s) => s.lobby?.chat.mode ?? "free");
  const muted = useApp((s) => (s.you !== null && s.lobby?.chat.muted.includes(s.you)) ?? false);
  const refused = useApp((s) => s.chatRefused);
  // chat belongs to the seated players: spectators neither see the tab nor receive any line
  const seated = you !== null;
  const [tab, setTab] = useState<LogTab>("log");
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  /** the reader is at the end of the list: new lines follow, otherwise the "New messages" pill appears */
  const stick = useRef(true);
  const seen = useRef<{ tab: LogTab; total: number } | null>(null);
  const [fresh, setFresh] = useState(0);
  const total = tab === "log" ? log.length : chatSeq;

  const toBottom = () => {
    const el = box.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    stick.current = true;
    setFresh(0);
  };
  useLayoutEffect(() => {
    const prev = seen.current;
    seen.current = { tab, total };
    if (prev === null || prev.tab !== tab || stick.current) {
      toBottom();
    } else if (total > prev.total) {
      setFresh((n) => n + (total - prev.total));
    }
  }, [total, tab, open]);
  // the chat tab being open means the messages are seen (a scrolled-up reader still gets the pill)
  useEffect(() => {
    if (tab === "chat" && seated) {
      set({ chatReadSeq: chatSeq });
    }
  }, [tab, seated, chatSeq]);

  const tabs = seated ? LOG_TABS : (["log"] as const);
  const prefix = "log";
  const canSend = connected && !muted;
  return (
    <>
      <div class="ltabs">
        <div
          class="ltablist"
          role="tablist"
          aria-label={t("log.toggle")}
          onKeyDown={tabKeys(prefix, tabs, tab, (id) => setTab(id === "chat" ? "chat" : "log"))}
        >
          <button
            {...tabProps(prefix, "log", tab)}
            class={tab === "log" ? "on" : ""}
            onClick={() => setTab("log")}
          >
            {t("log.tab")}
          </button>
          {seated && (
            <button
              {...tabProps(prefix, "chat", tab)}
              class={tab === "chat" ? "on" : ""}
              data-testid="chat-tab"
              onClick={() => setTab("chat")}
            >
              {unread > 0 && tab !== "chat"
                ? t("log.chatTabUnread", { n: unread })
                : t("log.chatTab")}
            </button>
          )}
        </div>
        {onClose && (
          <button class="x" aria-label={t("common.close")} onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <div class="lwrap">
        <div
          class="lbody"
          ref={box}
          {...panelProps(prefix, tab)}
          tabIndex={0}
          onScroll={() => {
            const el = box.current;
            if (el && nearBottom(el)) {
              stick.current = true;
              setFresh(0);
            } else {
              stick.current = false;
            }
          }}
        >
          {tab === "log" && (
            <div class="lines" role="log" aria-live="off" aria-label={t("log.logLabel")}>
              {log.slice(-80).map((l, i) => (
                <div class="ll" key={`${i}:${l.text}`} data-testid="log-entry">
                  {logText(l, theme)}
                </div>
              ))}
            </div>
          )}
          {tab === "chat" && seated && <ChatHostControls compact />}
          {tab === "chat" && seated && (
            <div class="lines" role="log" aria-live="polite" aria-label={t("log.chatLabel")}>
              {mode === "off" ? (
                <div class="ll dim" data-testid="chat-off">
                  {t("chat.off")}
                </div>
              ) : chat.length === 0 ? (
                <div class="ll dim">{t("log.noChat")}</div>
              ) : (
                chat.map((c, i) => {
                  const p = players.find((x) => x.id === c.from);
                  return (
                    <div class="ll" key={`${c.at}:${i}`} data-testid="chat-line">
                      <b class="chat-name" data-testid="chat-name">
                        {p && (
                          <i
                            class="swatch chat-swatch"
                            data-testid="chat-swatch"
                            aria-hidden="true"
                            style={{ background: p.color }}
                          />
                        )}
                        {c.name}
                      </b>{" "}
                      {c.quick !== undefined ? quickText(c.quick) : c.text}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        {fresh > 0 && (
          <button type="button" class="newpill" data-testid="new-messages" onClick={toBottom}>
            {t("log.newMessages")}
          </button>
        )}
      </div>
      {tab === "chat" && seated && mode !== "off" && (
        <div class="lsend">
          {muted && (
            <p class="chathint" data-testid="chat-muted">
              {t("chat.mutedYou")}
            </p>
          )}
          {!connected && (
            <p class="chathint" role="status" data-testid="chat-offline">
              {t("chat.offline")}
            </p>
          )}
          {refused !== null && (
            <p class="chathint" role="alert" data-testid="chat-hint">
              {refusedText(refused)}
            </p>
          )}
          {mode === "quick" ? (
            <>
              <p class="chathint dim">{t("chat.quickOnly")}</p>
              <QuickBar disabled={!canSend} />
            </>
          ) : (
            <form
              class="chatform"
              onSubmit={(e) => {
                e.preventDefault();
                // offline: the text stays in the field
                if (text.trim() && canSend && sendChat(text.trim())) {
                  setText("");
                }
              }}
            >
              <input
                class="field"
                data-testid="chat-input"
                aria-label={t("log.message")}
                placeholder={t("log.messagePlaceholder")}
                value={text}
                maxLength={MAX_CHAT_LENGTH}
                disabled={muted}
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
              />
              <button
                type="submit"
                class="cta slim chatsend"
                data-testid="chat-send"
                disabled={!canSend || !text.trim()}
              >
                {t("log.send")}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

export function LogPanel() {
  const open = useApp((s) => s.logOpen);
  const unread = useUnreadChat();
  if (!open)
    return (
      <button
        class="logtoggle pill"
        data-testid="log-toggle"
        onClick={() => set({ logOpen: true })}
      >
        {unread > 0 ? t("log.toggleUnread", { n: unread }) : t("log.toggle")}
      </button>
    );
  return (
    <div class="logpanel panel">
      <LogBody onClose={() => set({ logOpen: false })} />
    </div>
  );
}
