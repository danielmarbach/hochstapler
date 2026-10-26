// Mutating controls are disabled while the socket is down or an action still waits for the server's answer
// (UI review T02), with a translated reason instead of a silent no-op.
import { t } from "../i18n/index.ts";
import { useApp } from "../net/store.ts";

export interface Gate {
  /** no action may be sent right now */
  blocked: boolean;
  /** translated explanation for `blocked` (null when free) */
  reason: string | null;
}

export function useGate(): Gate {
  const connected = useApp((s) => s.connected);
  const pending = useApp((s) => s.pending);
  if (!connected) {
    return { blocked: true, reason: t("action.offline") };
  }
  if (pending !== null) {
    return { blocked: true, reason: t("action.pending") };
  }
  return { blocked: false, reason: null };
}
