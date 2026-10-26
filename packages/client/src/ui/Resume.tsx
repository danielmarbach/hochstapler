import { useEffect } from "preact/hooks";
import type { Lang } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { setLang } from "../i18n/lang.ts";
import { getInvite, saveToken } from "../net/store.ts";
import { gameHash } from "../net/route.ts";
import { Backdrop } from "./Backdrop.tsx";

/**
 * `#/resume/<gameId>/<token>[?lang=<lang>]`: keep the seat token in localStorage and take it out of the address bar
 * and the history entry right away (replaceState), then continue as the normal game route. A language in the link is
 * the one the player chose on the other device: it is applied and stored here (an explicit choice beats the browser default).
 */
export function Resume({
  gameId,
  token,
  lang,
  onResumed,
}: {
  gameId: string;
  token: string;
  lang?: Lang;
  onResumed: () => void;
}) {
  useEffect(() => {
    saveToken(gameId, token);
    if (lang) {
      setLang(lang);
    }
    history.replaceState(null, "", `${location.pathname}${location.search}${gameHash(gameId)}`);
    onResumed();
  }, [gameId, token, lang, onResumed]);
  return (
    <div class="page center">
      <div class="panel loading" data-testid="resume-opening">
        {t("resume.opening")}
      </div>
    </div>
  );
}

/** The personal link is not usable: malformed, renewed, or the seat is gone. */
export function ResumeProblem({ gameId }: { gameId: string | null }) {
  const invite = gameId ? getInvite(gameId) : null;
  return (
    <div class="stage">
      <Backdrop themeId="ch" offsetX={0.14} offsetY={-0.13} />
      <div class="page center right">
        <div class="panel join" role="alert" data-testid="resume-problem">
          <div class="eyebrow">{t("resume.title")}</div>
          <p class="lead">{t(gameId ? "resume.rejected" : "resume.malformed")}</p>
          <p class="note">{t("resume.hint")}</p>
          {gameId && invite && (
            <a class="cta" data-testid="resume-join" href={`#/join/${gameId}/${invite}`}>
              {t("resume.join")}
            </a>
          )}
          <a class="ghost" data-testid="resume-home" href="#/">
            {t("common.toStart")}
          </a>
        </div>
      </div>
    </div>
  );
}
