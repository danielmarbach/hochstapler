// Engine message catalogue (docs/DESIGN.md decision #31).
import { de } from "./de.ts";
import { en } from "./en.ts";
import { fillTemplate } from "./format.ts";
import type { EngineMessages, EngineMsg, EngineMsgKey, MsgResolver } from "./format.ts";
import { fr } from "./fr.ts";
import { gsw } from "./gsw.ts";
import { it } from "./it.ts";
import type { Lang } from "./lang.ts";

export { DEFAULT_LANG, LANGS, isLang } from "./lang.ts";
export type { Lang } from "./lang.ts";
export {
  PARAM_KINDS,
  fillTemplate,
  groupDigits,
  makeMsg,
  type EngineMessages,
  type EngineMsg,
  type EngineMsgKey,
  type MsgArgs,
  type MsgParamName,
  type MsgParamValues,
  type MsgParams,
  type MsgResolver,
  type ParamKind,
  type Placeholders,
} from "./format.ts";

export const ENGINE_MESSAGES: Record<Lang, EngineMessages> = { de, en, gsw, fr, it };

export const ENGINE_MSG_KEYS = Object.keys(de) as EngineMsgKey[];

/** Renders a structured message in `lang`; `resolve` maps ids/indices to display text. */
export function formatMessage(lang: Lang, msg: EngineMsg, resolve: MsgResolver = {}): string {
  return fillTemplate(ENGINE_MESSAGES[lang][msg.key], msg.params, resolve);
}
