// Ending a game early by vote (docs/DESIGN.md #45): the menu entry, its confirmation and the vote banner.
import { DeviceLinkDialog } from "./DeviceLink.tsx";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { attemptSync, legalActions } from "@poly/engine";
import type { GameAction, PublicGameState } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { set, useApp } from "../net/store.ts";
import { sendAction } from "../net/ws.ts";
import { asGame, fmtTime, useNow } from "./util.tsx";
import { Modal } from "./Modal.tsx";
import { useGate } from "./gate.ts";

/** actions of `you` the engine accepts right now (empty when the state cannot be evaluated) */
function useLegal(state: PublicGameState | null, you: string | null): GameAction["type"][] {
  return useMemo(() => {
    if (!state || !you) {
      return [];
    }
    const r = attemptSync("endgame:legal", () => legalActions(asGame(state), you));
    return r.ok ? r.value : [];
  }, [state, you]);
}

/** "⋯" button with the in-game menu; only players at the table see it */
export function GameMenu({ children }: { children?: ComponentChildren }) {
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  const busy = useApp((s) => s.busy);
  const [open, setOpen] = useState(false);
  // lives outside the dropdown so closing the menu does not unmount the dialog
  const [deviceOpen, setDeviceOpen] = useState(false);
  const legal = useLegal(state, you);
  if (!state || !you) {
    return null;
  }
  const canPropose = !busy && legal.includes("propose-end-game");
  const hint =
    state.endVote !== undefined
      ? t("menu.endGameBusy")
      : canPropose
        ? null
        : t("menu.endGameLater");
  return (
    <div class="gamemenu">
      <button
        class={`pill round ${open ? "on" : ""}`}
        data-testid="menu-toggle"
        title={t("menu.toggle")}
        aria-label={t("menu.toggle")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div class="menu panel" role="menu" data-testid="game-menu">
          {children}
          <button
            class="ghost"
            role="menuitem"
            data-testid="menu-end-game"
            disabled={!canPropose}
            onClick={() => {
              setOpen(false);
              set({ endGameDialog: true });
            }}
          >
            {t("menu.endGame")}
          </button>
          {hint && (
            <p class="note" data-testid="menu-end-game-hint">
              {hint}
            </p>
          )}
          <button
            class="ghost"
            role="menuitem"
            data-testid="device-link-open"
            aria-label={t("device.menu")}
            onClick={() => {
              setOpen(false);
              setDeviceOpen(true);
            }}
          >
            📲 {t("device.menu")}
          </button>
        </div>
      )}
      {deviceOpen && <DeviceLinkDialog onClose={() => setDeviceOpen(false)} />}
    </div>
  );
}

/** explains the vote before it starts */
export function EndGameDialog() {
  const close = () => set({ endGameDialog: false });
  const gate = useGate();
  return (
    <Modal
      class="modal-bg compact"
      label={t("endgame.title")}
      onClose={close}
      returnFocusTo='[data-testid="menu-toggle"]'
    >
      <div class="panel dialog" data-testid="end-game-dialog">
        <h2>{t("endgame.title")}</h2>
        <p>{t("endgame.body")}</p>
        <p class="note">{t("endgame.auto")}</p>
        {gate.reason && (
          <p class="note" role="status">
            {gate.reason}
          </p>
        )}
        <div class="dialog-actions">
          <button
            class="cta slim"
            data-testid="end-game-start"
            disabled={gate.blocked}
            onClick={() => {
              if (sendAction({ type: "propose-end-game" })) {
                close();
              }
            }}
          >
            {t("endgame.start")}
          </button>
          {/* the safe answer has the focus: a destructive confirmation never starts on "yes" */}
          <button class="ghost" data-testid="end-game-cancel" data-autofocus onClick={close}>
            {t("endgame.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** the pending vote: who asked, who already agreed, and Yes/No for those who still have to answer */
export function EndVoteBanner() {
  const state = useApp((s) => s.state);
  const you = useApp((s) => s.you);
  const legal = useLegal(state, you);
  const now = useNow(1000);
  const gate = useGate();
  const vote = state?.endVote;
  if (!state || !vote) {
    return null;
  }
  const nameOf = (id: string): string => state.players.find((p) => p.id === id)?.name ?? id;
  const active = state.players.filter((p) => !p.bankrupt);
  const agreed = active.filter((p) => vote.votes[p.id] === true).map((p) => p.name);
  const open = active.filter((p) => vote.votes[p.id] === undefined).map((p) => p.name);
  const votable = legal.includes("vote-end-game");
  const mine = you !== null && vote.by === you;
  const iAgreed = you !== null && vote.votes[you] === true;
  const left = vote.expiresAt === null ? null : (vote.expiresAt - now) / 1000;
  const body = (
    <div class="endvote panel" data-testid="end-vote" role={votable ? undefined : "status"}>
      <div class="eyebrow">{t("endvote.label")}</div>
      <p class="ask">{mine ? t("endvote.own") : t("endvote.ask", { name: nameOf(vote.by) })}</p>
      <p class="who" data-testid="end-vote-agreed">
        {t("endvote.agreed", { names: agreed.join(", ") })}
      </p>
      {open.length > 0 && (
        <p class="who" data-testid="end-vote-open">
          {t("endvote.open", { names: open.join(", ") })}
        </p>
      )}
      {iAgreed && !mine && <p class="who">{t("endvote.youAgreed")}</p>}
      {left !== null && left > 0 && (
        <p class="who">{t("endvote.expires", { time: fmtTime(left) })}</p>
      )}
      {votable && (
        <div class="dialog-actions">
          <button
            class="cta slim"
            data-testid="end-vote-yes"
            disabled={gate.blocked}
            onClick={() => sendAction({ type: "vote-end-game", accept: true })}
          >
            {t("endvote.yes")}
          </button>
          <button
            class="ghost"
            data-testid="end-vote-no"
            data-autofocus
            disabled={gate.blocked}
            onClick={() => sendAction({ type: "vote-end-game", accept: false })}
          >
            {t("endvote.no")}
          </button>
        </div>
      )}
      {votable && gate.reason && (
        <p class="who" role="status">
          {gate.reason}
        </p>
      )}
    </div>
  );
  // whoever still has to answer is asked in a blocking dialog (it cannot be dismissed: expiring or answering ends it);
  // the proposer and players who already answered keep playing with a banner
  return votable ? (
    <Modal
      class="modal-bg compact vote"
      label={t("endvote.label")}
      escape={false}
      backdrop={false}
      onClose={() => undefined}
    >
      {body}
    </Modal>
  ) : (
    body
  );
}
