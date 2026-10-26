// Client routes (hash based). The seat token of a resume link lives only in the URL fragment:
// browsers never send the fragment to the server, so it is not in any server log (DESIGN.md #47).
// The language of the sending device rides along inside the same fragment (`?lang=gsw`, DESIGN.md #47a).
import { LANGS, type Lang } from "@poly/engine";
import { z } from "zod";

export type Route =
  | { name: "home" }
  | { name: "join"; gameId: string; code: string }
  | { name: "game"; gameId: string }
  | { name: "resume"; gameId: string; token: string; lang?: Lang }
  | { name: "bad-resume" };

const GAME_ID = /^[A-Za-z0-9]{1,32}$/;
/** url-safe base64 as issued by the server (randomBytes(18) → 24 chars); generous bounds */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

const LangParam = z.enum(LANGS);

/** `lang` of a resume link's fragment query: exactly one supported value, anything else is ignored (the seat still resumes). */
function langFromQuery(query: string): Lang | undefined {
  const values = new URLSearchParams(query).getAll("lang");
  const parsed = values.length === 1 ? LangParam.safeParse(values[0]) : null;
  return parsed?.success ? parsed.data : undefined;
}

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.split(/\?(.*)/s, 2);
  const p = path.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (p[0] === "resume") {
    const [, gameId, token] = p;
    if (p.length === 3 && gameId !== undefined && token !== undefined) {
      if (GAME_ID.test(gameId) && TOKEN.test(token)) {
        const lang = langFromQuery(query);
        return lang ? { name: "resume", gameId, token, lang } : { name: "resume", gameId, token };
      }
    }
    return { name: "bad-resume" };
  }
  if (p[0] === "join" && p[1] && p[2]) {
    return { name: "join", gameId: p[1], code: p[2] };
  }
  if (p[0] === "game" && p[1]) {
    return { name: "game", gameId: p[1] };
  }
  return { name: "home" };
}

/** The address a game lives at once the token has been moved into localStorage. */
export const gameHash = (gameId: string): string => `#/game/${gameId}`;

/**
 * Personal link that continues this seat on another device (token and language only in the fragment).
 * The language is optional so that links without it (older ones) stay valid.
 */
export function resumeLink(
  where: { origin: string; pathname: string },
  gameId: string,
  token: string,
  lang?: Lang,
): string {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return `${where.origin}${where.pathname}#/resume/${gameId}/${token}${query}`;
}
