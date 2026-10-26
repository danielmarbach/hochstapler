import { t } from "../i18n/index.ts";
import { Backdrop } from "./Backdrop.tsx";

/** The game was deleted (inactivity, docs/DESIGN.md #57) or never existed: say so and lead back to the start page. */
export function GameGone() {
  return (
    <div class="stage">
      <Backdrop themeId="ch" offsetX={0.14} offsetY={-0.13} />
      <div class="page center right">
        <div class="panel join" role="alert" data-testid="game-gone">
          <div class="eyebrow">{t("gone.title")}</div>
          <p class="lead">{t("gone.lead")}</p>
          <p class="note">{t("gone.hint")}</p>
          <a class="cta" data-testid="game-gone-home" href="#/">
            {t("common.toStart")}
          </a>
        </div>
      </div>
    </div>
  );
}
