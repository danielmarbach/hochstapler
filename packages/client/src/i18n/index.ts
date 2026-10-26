// Typed UI dictionaries and `t(key, params)` (docs/DESIGN.md decision #31).
import type { Lang, Placeholders } from "@poly/engine";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { fr } from "./fr.ts";
import { gsw } from "./gsw.ts";
import { it } from "./it.ts";
import { getLang } from "./lang.ts";

export type UiKey = keyof typeof de;

/** Shape every language dictionary must have (`satisfies UiMessages`). */
export type UiMessages = Record<UiKey, string>;

/** Placeholder names of a key, derived from the German template. */
export type UiParamName<K extends UiKey> = Placeholders<(typeof de)[K]>;

export type UiParams<K extends UiKey> = { [P in UiParamName<K>]: string | number };

/** No argument for keys without placeholders, otherwise the params object. */
export type UiArgs<K extends UiKey> = [UiParamName<K>] extends [never] ? [] : [params: UiParams<K>];

export const UI_MESSAGES: Readonly<Record<Lang, UiMessages>> = { de, en, gsw, fr, it };

export const UI_KEYS = Object.keys(de) as UiKey[];

/** Fills `{name}` placeholders; unknown names stay untouched. */
export function fillUi(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export function translate<K extends UiKey>(lang: Lang, key: K, ...args: UiArgs<K>): string {
  const params: Readonly<Record<string, string | number>> = args[0] ?? {};
  return fillUi(UI_MESSAGES[lang][key], params);
}

/** Like `translate` for keys only known at runtime (no compile-time check of the params). */
export function translateAny(
  lang: Lang,
  key: UiKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return fillUi(UI_MESSAGES[lang][key], params);
}

/** Translates `key` into the current language of this device. */
export function t<K extends UiKey>(key: K, ...args: UiArgs<K>): string {
  return translate(getLang(), key, ...args);
}

/** Error with a translatable message; `message` holds the German text. */
export class UiError extends Error {
  readonly key: UiKey;
  readonly params: Readonly<Record<string, string | number>>;

  constructor(key: UiKey, params: Readonly<Record<string, string | number>> = {}) {
    super(fillUi(de[key], params));
    this.key = key;
    this.params = params;
  }

  text(): string {
    return translateAny(getLang(), this.key, this.params);
  }
}
