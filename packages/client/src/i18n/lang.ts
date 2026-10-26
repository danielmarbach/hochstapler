// Language state of this device (docs/DESIGN.md decisions #31, #76): the choice is stored per device in
// localStorage, the initial value comes from the browser language. Lozärnerdütsch is never auto-picked.
import { attemptSync, DEFAULT_LANG, isLang, type Lang } from "@poly/engine";
import { useEffect, useState } from "preact/hooks";

export const LANG_STORAGE_KEY = "poly:lang";

/** Locale used for Intl (numbers, dates): Swiss formatting for all but English, British for English. */
export const LANG_LOCALE: Readonly<Record<Lang, string>> = {
  de: "de-CH",
  gsw: "de-CH",
  fr: "fr-CH",
  it: "it-CH",
  en: "en-GB",
};

/** Value of the `<html lang>` attribute. */
const HTML_LANG: Readonly<Record<Lang, string>> = {
  de: "de",
  en: "en",
  gsw: "gsw",
  fr: "fr",
  it: "it",
};

/** de-* and gsw-* browsers start in German, fr-* in French, it-* in Italian, everything else in English; never gsw. */
export function langFromBrowser(browserLang: string | null | undefined): Lang {
  const base = (browserLang ?? "").toLowerCase();
  if (base.startsWith("de") || base.startsWith("gsw")) {
    return "de";
  }
  if (base.startsWith("fr")) {
    return "fr";
  }
  if (base.startsWith("it")) {
    return "it";
  }
  return base === "" ? DEFAULT_LANG : "en";
}

/** Stored choice (any supported language) wins over the browser language. */
export function resolveInitialLang(stored: string | null, browserLang: string | undefined): Lang {
  return isLang(stored) ? stored : langFromBrowser(browserLang);
}

function readStored(): string | null {
  const r = attemptSync("lang:read", () => localStorage.getItem(LANG_STORAGE_KEY));
  return r.ok ? r.value : null;
}

const hasDom = typeof document !== "undefined";

function applyHtmlLang(lang: Lang): void {
  if (hasDom) {
    document.documentElement.lang = HTML_LANG[lang];
  }
}

let current: Lang = hasDom ? resolveInitialLang(readStored(), navigator.language) : DEFAULT_LANG;
applyHtmlLang(current);

const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

/** Stores the explicit choice (also when it equals the browser default: a stored choice wins from now on). */
export function setLang(lang: Lang): void {
  // storage unavailable (private mode): the choice lasts until reload
  attemptSync("lang:write", () => localStorage.setItem(LANG_STORAGE_KEY, lang));
  if (lang === current) {
    return;
  }
  current = lang;
  applyHtmlLang(lang);
  for (const l of [...listeners]) {
    l(lang);
  }
}

/** Calls `fn` on every language change; returns the unsubscribe function. */
export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Current language; re-renders the component when it changes. */
export function useLang(): Lang {
  const [lang, setL] = useState<Lang>(current);
  useEffect(() => {
    setL(current);
    return onLangChange(setL);
  }, []);
  return lang;
}
