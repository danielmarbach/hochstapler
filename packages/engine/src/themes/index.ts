import type { Theme, ThemeTexts } from "../theme-types.ts";
import { ch } from "./ch.ts";
import { fr } from "./fr.ts";
import { de } from "./de.ts";
import { it } from "./it.ts";
import { GSW_THEME_TEXTS } from "./gsw.ts";
import { FR_THEME_TEXTS } from "./texts-fr.ts";
import { IT_THEME_TEXTS } from "./texts-it.ts";
import { SECURITY_NAMES } from "./securities.ts";
import type { Lang } from "../i18n/lang.ts";

/** Attach the Swiss German texts (kept in one generated file, see scripts/i18n/import-gsw.ts). */
function withGsw(theme: Theme): Theme {
  const gsw = GSW_THEME_TEXTS[theme.id];
  return gsw ? { ...theme, i18n: { ...theme.i18n, gsw } } : theme;
}

/** Attach the French and Italian texts (texts-fr.ts, texts-it.ts). */
function withFrIt(theme: Theme): Theme {
  const frTexts = FR_THEME_TEXTS[theme.id];
  const itTexts = IT_THEME_TEXTS[theme.id];
  return {
    ...theme,
    i18n: {
      ...theme.i18n,
      ...(frTexts ? { fr: frTexts } : {}),
      ...(itTexts ? { it: itTexts } : {}),
    },
  };
}

/** Attach translated company names (securities.ts) to the theme's language texts. */
function withSecurityNames(theme: Theme): Theme {
  const i18n: Partial<Record<Lang, ThemeTexts>> = { ...theme.i18n };
  for (const [lang, names] of Object.entries(SECURITY_NAMES) as [Lang, Record<string, string>][]) {
    const own = Object.fromEntries(
      theme.securities.flatMap((c) => (names[c.id] === undefined ? [] : [[c.id, names[c.id]]])),
    ) as Record<string, string>;
    if (Object.keys(own).length > 0) {
      i18n[lang] = { ...i18n[lang], securityNames: own };
    }
  }
  return { ...theme, i18n };
}

export const THEMES: Record<string, Theme> = {
  ch: withSecurityNames(withFrIt(withGsw(ch))),
  fr: withSecurityNames(withFrIt(withGsw(fr))),
  de: withSecurityNames(withFrIt(withGsw(de))),
  it: withSecurityNames(withFrIt(withGsw(it))),
};

export function getTheme(id: string): Theme {
  return THEMES[id] ?? THEMES.ch ?? ch;
}
