// Supported UI languages (docs/DESIGN.md decision #31). `de` is the source language.

export const LANGS = ["de", "en", "gsw", "fr", "it"] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = "de";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}
