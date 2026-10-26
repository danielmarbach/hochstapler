import { useEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  getTheme,
  themeText,
  type BotLevel,
  type GameState,
  type LogEntry,
  type PublicGameState,
  type ResolvedThemeText,
  type Theme,
} from "@poly/engine";
import { need } from "../safe.ts";
import { app, useApp } from "../net/store.ts";
import {
  currentLayout,
  LAYOUT_QUERIES,
  LITE_RENDER,
  prefersReducedMotion,
  type LayoutKind,
} from "../platform.ts";
import { applyPalette, paletteFor } from "./palette.ts";
import { engineText, serverMessageText } from "../i18n/engine.ts";
import { formatMoney, formatShortDate } from "../i18n/format.ts";
import { t, UiError, type UiKey } from "../i18n/index.ts";
import { useLang } from "../i18n/lang.ts";

/** The running game's state; only call from components that are mounted while a game is in progress. */
export function useGameState(): PublicGameState {
  return need(
    useApp((s) => s.state),
    "game state present while the HUD is mounted",
  );
}

export const asGame = (s: PublicGameState) => s as unknown as GameState;

export function useTheme(): Theme {
  const id = useApp((s) => s.state?.settings.themeId ?? s.lobby?.settings.themeId ?? "ch");
  return getTheme(id);
}

/** Theme texts (country, groups, decks, cards, tokens) in the current language. */
export function useThemeText(): ResolvedThemeText {
  const theme = useTheme();
  const lang = useLang();
  return themeText(theme, lang);
}

export function useNow(ms = 500): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

/** animated count-up number (gsap) */
export function Cash({ value, theme }: { value: number; theme: Theme }) {
  const [shown, setShown] = useState(value);
  const cur = useRef({ v: value });
  useEffect(() => {
    const tw = gsap.to(cur.current, {
      v: value,
      duration: prefersReducedMotion() ? 0 : 0.8,
      ease: "power3.out",
      onUpdate: () => setShown(Math.round(cur.current.v)),
    });
    return () => {
      tw.kill();
    };
  }, [value]);
  return <span class="cash">{formatMoney(theme, shown)}</span>;
}

/** money in the current language (theme currency symbol, locale grouping) */
export const money = (theme: Theme, n: number) => formatMoney(theme, n);

/** display name of a player of the running game; unknown ids stay as they are */
export const playerName = (id: string): string | undefined => playerById(id)?.name;

/** replace "Feld N" in German fallback log lines with themed tile names */
function themedLog(text: string, theme: Theme): string {
  return text.replace(/Feld (\d+)/g, (m, n: string) => theme.tileNames[Number(n)] ?? m);
}

/** log line in the current language; entries without a structured message show their German text */
export function logText(entry: LogEntry, theme: Theme): string {
  return entry.msg ? engineText(entry.msg, theme, playerName) : themedLog(entry.text, theme);
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400),
    h = Math.floor((sec % 86400) / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  if (d > 0) return t("time.days", { d, h });
  if (h > 0) return t("time.hours", { h, m: String(m).padStart(2, "0") });
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** user-facing text of a failure: client errors are translated, server messages are mapped back to their key */
/** bot difficulty levels with the dictionary key of their label */
export const BOT_LEVELS = [
  { id: "easy", label: "bot.easy" },
  { id: "normal", label: "bot.normal" },
  { id: "hard", label: "bot.hard" },
] as const satisfies readonly { id: BotLevel; label: UiKey }[];

export function errMsg(e: unknown): string {
  if (e instanceof UiError) {
    return e.text();
  }
  return e instanceof Error ? serverMessageText(e.message) : t("common.unknownError");
}

export function nav(hash: string): void {
  location.hash = hash;
}

export function playerById(id: string | null | undefined) {
  return app.state?.players.find((p) => p.id === id);
}

export function Swatch({ color, size = 14 }: { color: string; size?: number }) {
  return <span class="swatch" style={{ background: color, width: size, height: size }} />;
}

/** applies the travel-poster palette of `themeId` to the document */
export function usePalette(themeId: string): void {
  useEffect(() => {
    applyPalette(themeId);
  }, [themeId]);
}

/** responsive layout bucket (phone portrait / phone landscape / tablet / desktop), live */
export function useLayout(): LayoutKind {
  const [kind, setKind] = useState<LayoutKind>(currentLayout);
  useEffect(() => {
    const lists = Object.values(LAYOUT_QUERIES).map((q) => window.matchMedia(q));
    const update = () => setKind(currentLayout());
    for (const l of lists) {
      l.addEventListener("change", update);
    }
    update();
    return () => {
      for (const l of lists) {
        l.removeEventListener("change", update);
      }
    };
  }, []);
  return kind;
}

/** the E2E suite (`poly:lite`) sees a fixed postmark date so that screenshots are reproducible */
const E2E_POSTMARK_DATE = new Date(Date.UTC(2026, 9, 24, 12));

/** postmark text such as "ZÜRICH 24.10.26" (city per theme, date in the locale of the language) */
export function postmarkText(
  theme: Theme,
  at: Date = LITE_RENDER ? E2E_POSTMARK_DATE : new Date(),
): { city: string; date: string } {
  return { city: paletteFor(theme.id).city, date: formatShortDate(at) };
}

/** circular postmark with wavy cancel lines; purely decorative */
export function Postmark({
  theme,
  color,
  class: cls = "",
}: {
  theme: Theme;
  color?: string;
  class?: string;
}) {
  const pm = postmarkText(theme);
  return (
    <div class={`postmark ${cls}`} style={color ? { "--pm": color } : {}} aria-hidden="true">
      <div class="pm-ring">
        <b>{pm.city}</b>
        <span>{pm.date}</span>
      </div>
      <i class="pm-lines" />
    </div>
  );
}
