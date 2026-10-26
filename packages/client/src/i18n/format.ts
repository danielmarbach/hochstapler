// Numbers, money and dates via Intl: de-CH / fr-CH / it-CH for the Swiss languages, en-GB for English.
// Currency symbols and their position come from the theme (docs/DESIGN.md decisions #30, #31).
import { attemptSync, type Lang } from "@poly/engine";
import { getLang, LANG_LOCALE } from "./lang.ts";

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string): Intl.NumberFormat {
  let f = formatters.get(locale);
  if (!f) {
    // "always": Italian does not group four-digit numbers by default, the game shows 1'250 everywhere
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: "always" });
    formatters.set(locale, f);
  }
  return f;
}

/** 1250 -> "1'250" (de-CH, gsw, it-CH) / "1 250" with a no-break space (fr-CH) / "1,250" (en-GB). */
export function formatNumber(n: number, lang: Lang = getLang()): string {
  // the Swiss grouping separator is a typographic apostrophe in CLDR; the game uses the plain one everywhere
  // fr-CH groups with a narrow no-break space (U+202F), which many fonts lack: use the plain no-break space
  return numberFormat(LANG_LOCALE[lang])
    .format(n)
    .replace(/’/g, "'")
    .replace(/\u202f/g, "\u00a0");
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

/** 3.24 -> "3.2" (de-CH, it-CH, en-GB) / "3,2" (fr-CH), one decimal. */
export function formatPercent(pct: number, lang: Lang = getLang()): string {
  const locale = LANG_LOCALE[lang];
  let f = percentFormatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    percentFormatters.set(locale, f);
  }
  return f.format(pct);
}

/** 1250 -> "CHF 1'250" / "1,250 €" with the symbol and position of the theme. */
export function formatMoney(
  theme: { currency: { symbol: string; position: "before" | "after" } },
  n: number,
  lang: Lang = getLang(),
): string {
  const digits = formatNumber(Math.abs(Math.round(n)), lang);
  const body =
    theme.currency.position === "before"
      ? `${theme.currency.symbol} ${digits}`
      : `${digits} ${theme.currency.symbol}`;
  return n < 0 ? `-${body}` : body;
}

/** "24.10.26" (de-CH, fr-CH, it-CH, gsw) / "24/10/26" (en-GB). */
export function formatShortDate(at: Date, lang: Lang = getLang()): string {
  const formatted = attemptSync("date:format", () =>
    new Intl.DateTimeFormat(LANG_LOCALE[lang], {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(at),
  );
  return formatted.ok ? formatted.value : at.toLocaleDateString();
}
