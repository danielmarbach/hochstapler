// Resolves the texts of a theme for a language, falling back to the German base fields.
import type { Lang } from "./i18n/lang.ts";
import type { Theme, ThemeToken } from "./theme-types.ts";

export interface ResolvedThemeText {
  lang: Lang;
  name: string;
  groupNames: string[];
  deckNames: { chance: string; community: string };
  cardTexts: Record<string, string>;
  tokens: ThemeToken[];
  /** company names by security id */
  securityNames: Record<string, string>;
}

/** Texts of `theme` in `lang`; every missing field falls back to the German base. */
export function themeText(theme: Theme, lang: Lang): ResolvedThemeText {
  const t = lang === "de" ? undefined : theme.i18n?.[lang];
  const groupNames = t?.groupNames?.length === theme.groupNames.length ? t.groupNames : undefined;
  return {
    lang,
    name: t?.name ?? theme.name,
    groupNames: groupNames ?? theme.groupNames,
    deckNames: t?.deckNames ?? theme.deckNames,
    cardTexts: { ...theme.cardTexts, ...t?.cardTexts },
    securityNames: Object.fromEntries(
      theme.securities.map((c) => [c.id, t?.securityNames?.[c.id] ?? c.name]),
    ),
    tokens: theme.tokens.map((tok) => ({ ...tok, name: t?.tokenNames?.[tok.id] ?? tok.name })),
  };
}
