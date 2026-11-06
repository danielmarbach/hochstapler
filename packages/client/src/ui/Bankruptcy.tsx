// Declaring bankruptcy is irreversible: both the debt button and the give-up entries ask in a dialog of the game
// (docs/DESIGN.md: replaces the browser's confirm()) that starts on the safe answer.
import { t } from "../i18n/index.ts";
import { sendAction } from "../net/ws.ts";
import { Modal } from "./Modal.tsx";

/** `debt`: bankruptcy to escape a debt; `giveUp`: leaving the game on purpose */
export type BankruptcyKind = "debt" | "giveUp";

export function BankruptcyDialog({ kind, onClose }: { kind: BankruptcyKind; onClose: () => void }) {
  const title = t(kind === "debt" ? "confirm.bankrupt.title" : "confirm.giveUp.title");
  return (
    <Modal class="modal-bg compact" label={title} onClose={onClose}>
      <div class="panel dialog" data-testid="bankrupt-dialog">
        <h2>{title}</h2>
        <p>{t(kind === "debt" ? "confirm.bankrupt.body" : "confirm.giveUp.body")}</p>
        <div class="dialog-actions">
          <button
            class="danger"
            data-testid="bankrupt-confirm"
            onClick={() => {
              if (sendAction({ type: "declare-bankruptcy" })) {
                onClose();
              }
            }}
          >
            {t("confirm.bankrupt.confirm")}
          </button>
          {/* the safe answer has the focus: an irreversible action never starts on "yes" */}
          <button class="ghost" data-testid="bankrupt-cancel" data-autofocus onClick={onClose}>
            {t("confirm.bankrupt.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
