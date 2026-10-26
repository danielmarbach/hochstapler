import { getTheme } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { paletteFor } from "./palette.ts";

const HEADLINES = {
  ch: ["poster.ch.pre", "poster.ch.place"],
  fr: ["poster.fr.pre", "poster.fr.place"],
  de: ["poster.de.pre", "poster.de.place"],
  it: ["poster.it.pre", "poster.it.place"],
} as const;

function hasHeadline(themeId: string): themeId is keyof typeof HEADLINES {
  return Object.hasOwn(HEADLINES, themeId);
}

/** poster headline split into a small pre-line and the big place name; themes without texts use the palette */
function headline(themeId: string): { pre: string; place: string } {
  if (hasHeadline(themeId)) {
    const [pre, place] = HEADLINES[themeId];
    return { pre: t(pre), place: t(place) };
  }
  const pal = paletteFor(themeId);
  return { pre: pal.pre, place: pal.place };
}

/** big travel-poster headline for the landing page ("Willkommen in der Schweiz") */
export function Poster({ themeId }: { themeId: string }) {
  const theme = getTheme(themeId);
  const pal = headline(themeId);
  return (
    <header class="hero poster">
      <div class="poster-top">
        <span class="poster-flag" aria-hidden="true">
          {theme.flag}
        </span>
        <span class="eyebrow">{t("poster.agency")}</span>
      </div>
      <div class="poster-body">
        <h1>
          <span class="poster-pre">{pal.pre}</span>
          <span class="poster-place">{pal.place}</span>
        </h1>
        <div class="poster-stripes" aria-hidden="true">
          {theme.groupColors.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </div>
      </div>
      <div class="poster-foot">
        <span class="wordmark">
          Hoch<span>stapler</span>
        </span>
        <p>{t("poster.blurb")}</p>
      </div>
    </header>
  );
}

/** slim headline band on top of join / lobby cards */
export function PosterBand({ themeId, label }: { themeId: string; label: string }) {
  const theme = getTheme(themeId);
  const pal = headline(themeId);
  return (
    <div class="band">
      <span class="band-flag" aria-hidden="true">
        {theme.flag}
      </span>
      <span class="band-text">
        {pal.pre} {pal.place}
      </span>
      <span class="band-label">{label}</span>
    </div>
  );
}
