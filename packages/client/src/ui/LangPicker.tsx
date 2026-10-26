import { LANGS, type Lang } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { setLang, useLang } from "../i18n/lang.ts";

const NAME_KEYS = {
  de: "lang.de",
  en: "lang.en",
  gsw: "lang.gsw",
  fr: "lang.fr",
  it: "lang.it",
} as const;
const SHORT_KEYS = {
  de: "lang.short.de",
  en: "lang.short.en",
  gsw: "lang.short.gsw",
  fr: "lang.short.fr",
  it: "lang.short.it",
} as const;

const isLangValue = (value: string): value is Lang => (LANGS as readonly string[]).includes(value);

/**
 * Segmented control for the landing page: the full names ("Deutsch · English · Lozärnerdütsch · Français ·
 * Italiano") on wide screens, the short codes ("DE · EN · GSW · FR · IT") on narrow ones so that all five
 * fit into one row at 320 px (DESIGN.md #76). The accessible name is always the full name.
 */
export function LangPills() {
  const lang = useLang();
  return (
    <div class="seg langpick" role="group" aria-label={t("lang.label")} data-testid="lang-picker">
      {LANGS.map((l) => (
        <button
          type="button"
          key={l}
          lang={l}
          data-testid={`lang-option-${l}`}
          aria-pressed={l === lang}
          class={l === lang ? "on" : ""}
          aria-label={t(NAME_KEYS[l])}
          title={t(NAME_KEYS[l])}
          onClick={() => setLang(l)}
        >
          <span class="ln-full" aria-hidden="true">
            {t(NAME_KEYS[l])}
          </span>
          <span class="ln-short" aria-hidden="true">
            {t(SHORT_KEYS[l])}
          </span>
        </button>
      ))}
    </div>
  );
}

/** compact dropdown for the in-game buttons (top right) */
export function LangSelect() {
  const lang = useLang();
  return (
    <select
      class="langselect"
      data-testid="lang-select"
      aria-label={t("lang.label")}
      title={t("lang.label")}
      value={lang}
      onChange={(e) => {
        const value = (e.target as HTMLSelectElement).value;
        if (isLangValue(value)) {
          setLang(value);
        }
      }}
    >
      {LANGS.map((l) => (
        <option key={l} value={l} lang={l} title={t(NAME_KEYS[l])}>
          {t(SHORT_KEYS[l])}
        </option>
      ))}
    </select>
  );
}
