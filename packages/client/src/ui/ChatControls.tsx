// Chat pieces shared by lobby and game: the host's mode switch and mute buttons, the quick-message bar and the
// translated texts of messages and refusals (docs/DESIGN.md #69). Everything is rendered as text (no DOM sinks).
import { useState } from "preact/hooks";
import {
  CHAT_MODES,
  MAX_CHAT_LENGTH,
  QUICK_EMOJI_IDS,
  QUICK_EMOJIS,
  QUICK_PHRASE_IDS,
  attempt,
  isQuickEmoji,
  quickEmoji,
} from "@poly/engine";
import type {
  ChatMode,
  ChatRejectReason,
  QuickChatId,
  QuickEmojiChatId,
  QuickPhraseId,
} from "@poly/engine";
import { t } from "../i18n/index.ts";
import type { UiKey } from "../i18n/index.ts";
import { api } from "../net/api.ts";
import { toast, useApp } from "../net/store.ts";
import { sendQuickChat } from "../net/ws.ts";
import { errMsg } from "./util.tsx";

export const CHAT_MODE_LABEL = {
  free: "chat.mode.free",
  quick: "chat.mode.quick",
  off: "chat.mode.off",
} as const satisfies Record<ChatMode, UiKey>;

const QUICK_LABEL = {
  hello: "chat.quick.hello",
  gg: "chat.quick.gg",
  nice: "chat.quick.nice",
  lucky: "chat.quick.lucky",
  ohno: "chat.quick.ohno",
  thanks: "chat.quick.thanks",
  sorry: "chat.quick.sorry",
  trade: "chat.quick.trade",
  stillthere: "chat.quick.stillthere",
  bye: "chat.quick.bye",
} as const satisfies Record<QuickPhraseId, UiKey>;

const EMOJI_LABEL = {
  smile: "chat.emoji.smile",
  laugh: "chat.emoji.laugh",
  wow: "chat.emoji.wow",
  sad: "chat.emoji.sad",
  party: "chat.emoji.party",
  thumbsup: "chat.emoji.thumbsup",
} as const satisfies Record<keyof typeof QUICK_EMOJIS, UiKey>;

/** Text shown for a quick message: the emoji itself or the phrase in the reader's language. */
export function quickText(id: QuickChatId): string {
  return isQuickEmoji(id) ? quickEmoji(id) : t(QUICK_LABEL[id]);
}

/** Hint for a message the server did not publish. */
export function refusedText(reason: ChatRejectReason): string {
  switch (reason) {
    case "off":
      return t("chat.reject.off");
    case "quick":
      return t("chat.reject.quick");
    case "muted":
      return t("chat.reject.muted");
    case "link":
      return t("chat.reject.link");
    case "contact":
      return t("chat.reject.contact");
    case "language":
      return t("chat.reject.language");
    case "invalid":
      return t("chat.reject.invalid");
    case "length":
      return t("chat.reject.length", { max: MAX_CHAT_LENGTH });
    case "rate":
      return t("chat.reject.rate");
  }
}

/** Host only: runs a chat update and reports a refusal as a toast. */
function useChatUpdate(): { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    const r = await attempt("chat:update", fn);
    if (!r.ok) toast(errMsg(r.error), "bad");
    setBusy(false);
  };
  return { busy, run };
}

/** The host's chat controls: mode and one mute button per other human player. */
export function ChatHostControls({ compact = false }: { compact?: boolean }) {
  const lobby = useApp((s) => s.lobby);
  const you = useApp((s) => s.you);
  const { busy, run } = useChatUpdate();
  const me = lobby?.seats.find((s) => s.playerId === you);
  if (!lobby || !me?.isHost) return null;
  const { mode, muted } = lobby.chat;
  const others = lobby.seats.filter((s) => s.kind === "human" && !s.isHost);
  return (
    <div class={`chatctl${compact ? " compact" : ""}`} data-testid="chat-host-controls">
      <div class="chatctl-row">
        <span class="chatctl-title">{t("chat.modeTitle")}</span>
        <div class="seg" role="group" aria-label={t("chat.hostControls")}>
          {CHAT_MODES.map((m) => (
            <button
              type="button"
              key={m}
              class={mode === m ? "on" : ""}
              aria-pressed={mode === m}
              data-testid={`chat-mode-${m}`}
              disabled={busy}
              onClick={() => run(() => api.patchChat(lobby.gameId, { mode: m }))}
            >
              {t(CHAT_MODE_LABEL[m])}
            </button>
          ))}
        </div>
      </div>
      {others.map((s) => {
        const isMuted = muted.includes(s.playerId);
        return (
          <div class="chatctl-row" key={s.playerId}>
            <span class="sname">{s.name}</span>
            <button
              type="button"
              class={`ghost slim${isMuted ? " on" : ""}`}
              data-testid="mute-toggle"
              data-player-name={s.name}
              aria-pressed={isMuted}
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.patchChat(lobby.gameId, { mute: { playerId: s.playerId, muted: !isMuted } }),
                )
              }
            >
              {isMuted ? t("chat.unmute", { name: s.name }) : t("chat.mute", { name: s.name })}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The predefined messages as one swipeable row: the short emoji first, then the phrases. */
export function QuickBar({ disabled }: { disabled: boolean }) {
  return (
    <div class="quickbar" role="group" aria-label={t("chat.quickLabel")} data-testid="quick-bar">
      {QUICK_EMOJI_IDS.map((e) => {
        const id: QuickEmojiChatId = `e-${e}`;
        return (
          <button
            type="button"
            key={id}
            class="ghost slim emoji"
            data-testid={`quick-${id}`}
            aria-label={t(EMOJI_LABEL[e])}
            disabled={disabled}
            onClick={() => sendQuickChat(id)}
          >
            {QUICK_EMOJIS[e]}
          </button>
        );
      })}
      {QUICK_PHRASE_IDS.map((id) => (
        <button
          type="button"
          key={id}
          class="ghost slim"
          data-testid={`quick-${id}`}
          disabled={disabled}
          onClick={() => sendQuickChat(id)}
        >
          {t(QUICK_LABEL[id])}
        </button>
      ))}
    </div>
  );
}
