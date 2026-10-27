// Loan dialog of the show-off mode (Protzmodus, docs/DESIGN.md #93): the bank's rate before
// confirming, borrowing in steps, the open tranches with the interest due, and repayment.
import { useEffect, useState } from "preact/hooks";
import { trancheInterest } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { useLang } from "../i18n/lang.ts";
import { set, useApp } from "../net/store.ts";
import { sendAction } from "../net/ws.ts";
import { Modal } from "./Modal.tsx";
import { useGate } from "./gate.ts";
import { clampAmount, lenderText, loanView, rateNote, rateText } from "./loans.ts";
import { asGame, money, useGameState, useTheme } from "./util.tsx";

interface StepperProps {
  value: number;
  max: number;
  step: number;
  set: (n: number) => void;
  testid: string;
}

function AmountStepper({ value, max, step, set: setValue, testid }: StepperProps) {
  const theme = useTheme();
  return (
    <div class="sec-stepper loan-stepper">
      <span class="lbl">{t("loan.amount")}</span>
      <span class="step">
        <button
          type="button"
          aria-label={t("loan.less")}
          data-testid={`${testid}-minus`}
          disabled={value <= step}
          onClick={() => setValue(clampAmount(value - step, max, step))}
        >
          −
        </button>
        <output data-testid={`${testid}-amount`}>{money(theme, value)}</output>
        <button
          type="button"
          aria-label={t("loan.more")}
          data-testid={`${testid}-plus`}
          disabled={value + step > max}
          onClick={() => setValue(clampAmount(value + step, max, step))}
        >
          +
        </button>
      </span>
    </div>
  );
}

export function LoanDialog() {
  const state = useGameState();
  const you = useApp((s) => s.you);
  const busy = useApp((s) => s.busy);
  const gate = useGate();
  const theme = useTheme();
  const lang = useLang();
  const me = state.players.find((p) => p.id === you);
  const game = asGame(state);
  const view = me ? loanView(game, me) : null;
  const [take, setTake] = useState(0);
  const [repay, setRepay] = useState(0);
  const room = view?.room ?? 0;
  const maxRepay = view?.maxRepay ?? 0;
  const step = view?.step ?? 1;
  // keep the steppers inside what is possible after every update (cash, debt and room change)
  useEffect(() => {
    setTake((v) => clampAmount(v === 0 ? step : v, room, step));
  }, [room, step]);
  useEffect(() => {
    setRepay((v) => clampAmount(v === 0 ? maxRepay : v, maxRepay, step));
  }, [maxRepay, step]);
  // an old refusal must not greet the player when the dialog opens
  useEffect(() => {
    set({ actionError: null });
  }, []);
  const actionError = useApp((s) => s.actionError);
  const close = () => set({ loanOpen: false });
  if (!me || !view) {
    return null;
  }
  const ready = view.turnOk && !busy && !gate.blocked;
  const interestOfTake = trancheInterest({ amount: take, ratePct: view.ratePct });

  return (
    <Modal
      class="modal-bg"
      label={t("loan.title")}
      onClose={close}
      returnFocusTo='[data-testid="open-loan"]'
    >
      <div class="panel trade loan" data-testid="loan-dialog">
        <div class="dhead">
          <h3>{t("loan.title")}</h3>
          <button class="x" data-testid="loan-close" aria-label={t("common.close")} onClick={close}>
            ×
          </button>
        </div>
        <div class="tbody">
          <section class="loan-offer">
            <p class="loan-lender" data-testid="loan-lender">
              {lenderText(game, view.room, lang)}
            </p>
            <p class="loan-rate" data-testid="loan-rate" data-rate={view.ratePct}>
              {rateText(view.ratePct, lang)}
            </p>
            <p class="note">{rateNote(lang)}</p>
            {view.room >= view.step ? (
              <>
                <AmountStepper
                  value={take}
                  max={view.room}
                  step={view.step}
                  set={setTake}
                  testid="loan-take"
                />
                <div class="sec-cost" data-testid="loan-interest-preview">
                  {t("loan.interestPreview", { amount: money(theme, interestOfTake) })}
                </div>
                <button
                  type="button"
                  class="cta slim"
                  data-testid="loan-take-confirm"
                  disabled={!ready || take < view.step}
                  onClick={() => sendAction({ type: "take-loan", amount: take })}
                >
                  {t("loan.take", { amount: money(theme, take) })}
                </button>
              </>
            ) : (
              <p class="note" data-testid="loan-limit-reached">
                {t("loan.limitReached")}
              </p>
            )}
          </section>
          <section class="loan-debt" data-testid="loan-debt">
            <h4>{t("loan.debt")}</h4>
            {view.debt === 0 ? (
              <p class="note" data-testid="loan-none">
                {t("loan.none")}
              </p>
            ) : (
              <>
                <div class="loan-total" data-testid="loan-debt-total">
                  <b>{money(theme, view.debt)}</b>
                </div>
                <ul class="loan-tranches">
                  {view.tranches.map((tr) => (
                    <li key={tr.ratePct} data-testid="loan-tranche">
                      {t("loan.tranche", { amount: money(theme, tr.amount), pct: tr.ratePct })}
                    </li>
                  ))}
                </ul>
                <p class="sec-cost" data-testid="loan-due">
                  {t("loan.due", { amount: money(theme, view.due) })}
                </p>
                {view.maxRepay >= view.step && (
                  <>
                    <AmountStepper
                      value={repay}
                      max={view.maxRepay}
                      step={view.step}
                      set={setRepay}
                      testid="loan-repay"
                    />
                    <button
                      type="button"
                      class="ghost"
                      data-testid="loan-repay-confirm"
                      disabled={!ready || repay < view.step}
                      onClick={() => sendAction({ type: "repay-loan", amount: repay })}
                    >
                      {t("loan.repay", { amount: money(theme, repay) })}
                    </button>
                  </>
                )}
                <p class="note">{t("loan.repayNote")}</p>
              </>
            )}
          </section>
          {!view.turnOk && (
            <p class="note sec-note" role="status" data-testid="loan-blocker">
              {t("loan.blocker")}
            </p>
          )}
          {actionError && (
            <p class="err" role="alert" data-testid="loan-error">
              {actionError}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
