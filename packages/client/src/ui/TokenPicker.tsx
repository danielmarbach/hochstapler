import { getTheme, themeText } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";
import { TokenIcon } from "./TokenIcon.tsx";

/**
 * The theme's game pieces as tiles (docs/DESIGN.md #75). `value` is the own piece, `taken` maps pieces of the other
 * seats to their holder's name. A taken tile stays focusable (aria-disabled, with the holder in its label) so that
 * keyboard and screen reader users learn why it cannot be picked; clicking it does nothing.
 */
export function TokenPicker({
  themeId,
  value,
  taken,
  onPick,
  busy = false,
}: {
  themeId: string;
  value: string | null;
  taken: ReadonlyMap<string, string>;
  onPick: (tokenId: string) => void;
  busy?: boolean;
}) {
  const tokens = themeText(getTheme(themeId), getLang()).tokens;
  return (
    <div class="tokpick" data-testid="token-picker">
      <div class="toklabel" id="toklabel">
        {t("tokens.label")}
      </div>
      <div class="toks" role="group" aria-labelledby="toklabel">
        {tokens.map((tok) => {
          const holder = taken.get(tok.id);
          const on = tok.id === value;
          return (
            <button
              type="button"
              key={tok.id}
              data-testid="token"
              data-token={tok.id}
              data-taken={holder === undefined ? undefined : "1"}
              class={`tok ${on ? "on" : ""} ${holder === undefined ? "" : "taken"}`}
              aria-pressed={on}
              aria-disabled={holder !== undefined || busy}
              aria-label={
                holder === undefined
                  ? tok.name
                  : t("tokens.tile", { token: tok.name, name: holder })
              }
              onClick={() => {
                if (holder === undefined && !busy && !on) onPick(tok.id);
              }}
            >
              <span class="pkico" aria-hidden="true">
                <TokenIcon id={tok.id} size={44} name={tok.name} />
              </span>
              <span class="pkname">{tok.name}</span>
              {holder !== undefined && (
                <span class="pkby" aria-hidden="true">
                  {t("tokens.takenBy", { name: holder })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
