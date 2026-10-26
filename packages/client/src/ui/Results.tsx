// Result screen of a finished game: podium, ranking and the net worth breakdown of every player.
import type { GameOverReason, PlayerResult, PlayerState, Theme } from "@poly/engine";
import { breakdownLines, resultsOf } from "../game/results.ts";
import { t } from "../i18n/index.ts";
import type { UiKey } from "../i18n/index.ts";
import { useApp } from "../net/store.ts";
import { inkOn } from "./palette.ts";
import { money, nav, useTheme } from "./util.tsx";
import { TokenIcon } from "./TokenIcon.tsx";
import { Modal } from "./Modal.tsx";

const PODIUM_PLACES = 3;
/** podium columns left to right: 2nd, 1st, 3rd (the winner stands in the middle) */
const PODIUM_ORDER = [1, 0, 2];

const REASON_KEYS = {
  vote: "results.reasonVote",
  "round-limit": "results.reasonRounds",
  "last-player": "results.reasonLast",
} as const satisfies Record<GameOverReason, UiKey>;

interface Row {
  result: PlayerResult;
  player: PlayerState;
}

function Podium({ rows, theme }: { rows: Row[]; theme: Theme }) {
  const top = rows.slice(0, PODIUM_PLACES);
  const order = PODIUM_ORDER.filter((i) => i < top.length);
  return (
    <ol class="podium" aria-hidden="true">
      {order.map((i) => {
        const row = top[i];
        if (!row) {
          return null;
        }
        const { result, player } = row;
        return (
          <li
            key={player.id}
            class={`step place-${result.rank}`}
            style={{ "--pc": player.color, "--pt": inkOn(player.color) }}
          >
            <span class="ticon">
              <TokenIcon id={player.tokenId} size={44} />
            </span>
            <span class="pdname">{player.name}</span>
            <span class="pworth">{money(theme, result.total)}</span>
            <span class="block">{result.rank}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Breakdown({ result, theme }: { result: PlayerResult; theme: Theme }) {
  const lines = breakdownLines(result);
  return (
    <dl class="breakdown">
      {lines.map(([key, value]) => (
        <div key={key}>
          <dt>{t(key)}</dt>
          <dd>{money(theme, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Results() {
  const theme = useTheme();
  const state = useApp((s) => s.state);
  if (!state) {
    return null;
  }
  const ph = state.phase;
  const results = resultsOf(state);
  const rows: Row[] = results.flatMap((result) => {
    const player = state.players.find((p) => p.id === result.playerId);
    return player ? [{ result, player }] : [];
  });
  const winner =
    ph.type === "game-over" ? state.players.find((p) => p.id === ph.winner) : undefined;
  const reason = ph.type === "game-over" && ph.reason ? ph.reason : null;
  return (
    <Modal
      class="modal-bg results-bg"
      label={t("gameover.title")}
      escape={false}
      backdrop={false}
      onClose={() => undefined}
    >
      <div class="panel results" data-testid="game-over">
        <header class="results-head">
          <div class="eyebrow">{t("gameover.title")}</div>
          {/* the winner is announced first: the heading takes the initial focus */}
          <h1 class="small" data-testid="winner" tabIndex={-1} data-autofocus>
            {winner ? t("gameover.winner", { name: winner.name }) : t("gameover.draw")}
          </h1>
          {reason && <p class="reason">{t(REASON_KEYS[reason])}</p>}
          <div class="poster-stripes" aria-hidden="true">
            {theme.groupColors.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </div>
        </header>
        <Podium rows={rows} theme={theme} />
        <h2 class="results-title">{t("results.ranking")}</h2>
        <ol class="ranking" data-testid="results">
          {rows.map(({ result, player }) => (
            <li
              key={player.id}
              class={`rrow ${result.rank === 1 && !result.bankrupt ? "first" : ""} ${result.bankrupt ? "out" : ""}`}
              style={{ "--pc": player.color, "--pt": inkOn(player.color) }}
              data-testid="results-row"
              data-player-name={player.name}
              data-rank={result.rank}
            >
              <div class="rhead">
                <span class="rank" aria-label={t("results.rank", { n: result.rank })}>
                  {result.rank === 1 && !result.bankrupt ? "★" : result.rank}
                </span>
                <span class="ticon" aria-hidden="true">
                  <TokenIcon id={player.tokenId} size={32} />
                </span>
                <span class="rname">
                  {player.name}
                  {result.bankrupt && <em> {t("results.bankrupt")}</em>}
                </span>
                <span class="rtotal" data-testid="results-total" title={t("results.total")}>
                  {money(theme, result.total)}
                </span>
              </div>
              <Breakdown result={result} theme={theme} />
            </li>
          ))}
        </ol>
        <p class="note">{t("results.note")}</p>
        <button class="cta" data-testid="new-game" onClick={() => nav("#/")}>
          {t("results.newGame")}
        </button>
      </div>
    </Modal>
  );
}
