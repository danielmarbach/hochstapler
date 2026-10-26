// Rendering of language-neutral engine output (LogEntry.msg, GameError.code/params, blocker
// reasons) in the language of this device; theme texts via themeText (docs/DESIGN.md decision #31).
import {
  ENGINE_MESSAGES,
  ENGINE_MSG_KEYS,
  formatMessage,
  themeText,
  type EngineMsg,
  type EngineMsgKey,
  type Lang,
  type MsgParamValues,
  type MsgResolver,
  type Theme,
} from "@poly/engine";
import { UI_KEYS, UI_MESSAGES, translate, translateAny, type UiKey } from "./index.ts";
import { formatMoney } from "./format.ts";
import { getLang } from "./lang.ts";

/** Id of the player to display name; unknown ids stay as they are. */
export type PlayerNames = (id: string) => string | undefined;

/** Resolver for formatMessage: player names, themed tile names, money and card texts. */
export function makeResolver(
  theme: Theme,
  lang: Lang,
  playerName: PlayerNames = () => undefined,
): MsgResolver {
  const texts = themeText(theme, lang);
  return {
    player: (id) => playerName(id) ?? id,
    tile: (index) => theme.tileNames[index] ?? translate(lang, "tile.fallback", { n: index }),
    money: (amount) => formatMoney(theme, amount, lang),
    card: (id) => texts.cardTexts[id] ?? id,
    security: (id) => texts.securityNames[id] ?? id,
  };
}

/** Renders `msg` in the current language. */
export function engineText(msg: EngineMsg, theme: Theme, playerName?: PlayerNames): string {
  const lang = getLang();
  return formatMessage(lang, msg, makeResolver(theme, lang, playerName));
}

// ---- messages that reach the client only as German text ----
// The server forwards `GameError.message` (German) without code/params, and answers REST errors with
// German text. They are mapped back to their catalogue key by matching the German templates.

interface Matcher {
  readonly key: EngineMsgKey;
  readonly pattern: RegExp;
  readonly names: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcherFor(key: EngineMsgKey, template: string): Matcher {
  const names: string[] = [];
  const source = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m) {
        names.push(m[1] ?? "");
        return "(.+?)";
      }
      return escapeRegExp(part);
    })
    .join("");
  // eslint-disable-next-line security/detect-non-literal-regexp -- `source` is built from our own catalogue; literal parts go through escapeRegExp
  return { key, pattern: new RegExp(`^${source}$`), names };
}

// "err.generic" is "{text}" and would match everything: it is the fallback, not a candidate
const MATCHERS: readonly Matcher[] = ENGINE_MSG_KEYS.filter(
  (k) => k.startsWith("err.") || k.startsWith("block."),
)
  .filter((k) => k !== "err.generic")
  .map((k) => matcherFor(k, ENGINE_MESSAGES.de[k]));

const SERVER_KEYS: ReadonlyMap<string, UiKey> = new Map(
  UI_KEYS.filter((k) => k.startsWith("srv.")).map((k) => [UI_MESSAGES.de[k], k] as const),
);

/** Reverse lookup of a German engine error text; null when it is not a catalogue message. */
export function parseEngineError(message: string): EngineMsg | null {
  for (const m of MATCHERS) {
    const hit = m.pattern.exec(message);
    if (hit) {
      const params: MsgParamValues = {};
      m.names.forEach((name, i) => {
        params[name] = hit[i + 1] ?? "";
      });
      return { key: m.key, params };
    }
  }
  return null;
}

/**
 * Localised text of a message the server sent in German (WebSocket `error`, REST `error`):
 * engine rule errors and server messages are translated, anything unknown is shown as received.
 */
export function serverMessageText(message: string): string {
  const lang = getLang();
  const srv = SERVER_KEYS.get(message);
  if (srv) {
    return translateAny(lang, srv);
  }
  const parsed = parseEngineError(message);
  if (parsed) {
    return formatMessage(lang, parsed);
  }
  return message;
}
