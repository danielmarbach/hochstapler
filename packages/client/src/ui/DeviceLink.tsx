import { useMemo, useState } from "preact/hooks";
import { encode } from "uqr";
import { attempt } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { useLang } from "../i18n/lang.ts";
import { getToken, toast, useApp } from "../net/store.ts";
import { resumeLink } from "../net/route.ts";
import { rotateSeatToken } from "../net/ws.ts";
import { errMsg } from "./util.tsx";
import { Modal } from "./Modal.tsx";
import "./device-link.css";

/** Menu entry "continue on another device": a round pill in the game HUD, a text button in the lobby. */
export function DeviceLinkButton({ variant }: { variant: "pill" | "ghost" }) {
  const [open, setOpen] = useState(false);
  const label = t("device.menu");
  return (
    <>
      {variant === "pill" ? (
        <button
          class="pill round"
          data-testid="device-link-open"
          title={label}
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          📲
        </button>
      ) : (
        <button class="ghost" data-testid="device-link-open" onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      {open && <DeviceLinkDialog onClose={() => setOpen(false)} />}
    </>
  );
}

const QUIET_ZONE = 2;

/** Black modules as one SVG path of 1x1 squares (no markup from a library is injected into the page). */
function qrPath(text: string): { path: string; size: number } {
  const { data, size } = encode(text, { ecc: "M", border: 0 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }),
  );
  return { path, size };
}

function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => qrPath(text), [text]);
  const box = size + 2 * QUIET_ZONE;
  return (
    <svg
      class="dl-qr"
      data-testid="device-qr"
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${box} ${box}`}
      role="img"
      aria-label={t("device.qr")}
      shape-rendering="crispEdges"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function DeviceLinkDialog({ onClose }: { onClose: () => void }) {
  const gameId = useApp((s) => s.lobby?.gameId ?? s.gameId);
  const [token, setToken] = useState(() => (gameId ? getToken(gameId) : null));
  const [busy, setBusy] = useState(false);

  const lang = useLang();
  const link = gameId && token ? resumeLink(location, gameId, token, lang) : null;
  const canShare = typeof navigator.share === "function";

  const copy = async () => {
    if (!link) return;
    const r = await attempt("devicelink:copy", () => navigator.clipboard.writeText(link));
    if (r.ok) toast(t("device.copied"), "good");
    else window.prompt(t("device.copyPrompt"), link);
  };
  const share = async () => {
    if (!link) return;
    // the user dismissing the share sheet rejects the promise: nothing to report
    await attempt("devicelink:share", () =>
      navigator.share({ title: t("device.shareTitle"), url: link }),
    );
  };
  const renew = async () => {
    if (!gameId) return;
    setBusy(true);
    const r = await attempt("devicelink:renew", () => rotateSeatToken(gameId));
    if (r.ok) {
      setToken(getToken(gameId));
      toast(t("device.renewed"), "good");
    } else {
      toast(errMsg(r.error), "bad");
    }
    setBusy(false);
  };

  return (
    <Modal
      class="dl-bg"
      label={t("device.title")}
      onClose={onClose}
      returnFocusTo='[data-testid="menu-toggle"]'
    >
      <div class="panel dl" data-testid="device-link-dialog">
        <div class="dhead">
          <h3>{t("device.title")}</h3>
          <button
            data-autofocus
            class="x"
            data-testid="device-link-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div class="dl-body">
          {link ? (
            <>
              <p class="dl-lead">{t("device.lead")}</p>
              <div class="dl-main">
                <QrCode text={link} />
                <div class="dl-side">
                  <input
                    readOnly
                    class="dl-link"
                    data-testid="device-link"
                    aria-label={t("device.linkLabel")}
                    value={link}
                    onFocus={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <div class="dl-row">
                    <button class="cta slim" data-testid="device-link-copy" onClick={copy}>
                      {t("device.copy")}
                    </button>
                    {canShare && (
                      <button class="ghost" data-testid="device-link-share" onClick={share}>
                        {t("device.share")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <p class="dl-warning" role="note" data-testid="device-link-warning">
                ⚠ {t("device.warning")}
              </p>
              <div class="dl-renew">
                <button
                  class="ghost"
                  data-testid="device-link-renew"
                  disabled={busy}
                  onClick={renew}
                >
                  {t("device.renew")}
                </button>
                <p class="note" data-testid="device-link-renew-hint">
                  {t("device.renewHint")}
                </p>
              </div>
            </>
          ) : (
            <p class="dl-lead">{t("device.noToken")}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
