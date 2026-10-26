// Blocking overlays as native modal <dialog> (docs/DESIGN.md #46 stays valid: no new sources, no inline styles):
// the browser makes the page behind inert (contained tab order), the dialog gets initial focus, Escape and
// focus restoration to the element that opened it (WAI dialog pattern, UI review T01).
import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** accessible name of the dialog */
  label: string;
  /** called for Escape (when allowed) and for a click on the backdrop (when allowed) */
  onClose: () => void;
  /** Escape closes the dialog (false for dialogs that must be answered, e.g. the results page) */
  escape?: boolean;
  /** a click beside the panel closes the dialog */
  backdrop?: boolean;
  /** classes of the full-screen dialog element (layout: `modal-bg` or `dl-bg`) */
  class: string;
  /** where the focus goes when the opener no longer exists (e.g. a menu entry that closed with the menu) */
  returnFocusTo?: string;
  children: ComponentChildren;
}

/**
 * Initial focus: the first element marked `data-autofocus` (Cancel for destructive confirmations), otherwise the
 * first focusable element of the dialog.
 */
function focusInitial(dlg: HTMLDialogElement): void {
  const target =
    dlg.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ??
    dlg.querySelector(FOCUSABLE);
  if (target instanceof HTMLElement) {
    target.focus();
  }
}

/** focusable elements in tab order that are actually shown */
function tabStops(dlg: HTMLDialogElement): HTMLElement[] {
  return [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
  );
}

export function Modal(p: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const props = useRef(p);
  props.current = p;
  const pressedOnBackdrop = useRef(false);

  useLayoutEffect(() => {
    const dlg = ref.current;
    if (!dlg) {
      return undefined;
    }
    // the opener may be gone already (a menu entry closes with its menu): then the focus sits on <body>
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    let closing = false;
    if (!dlg.open) {
      dlg.showModal();
    }
    focusInitial(dlg);
    // the browser closes a dialog on a second Escape even when `cancel` was prevented: reopen what must stay
    const onNativeClose = () => {
      if (!closing && props.current.escape === false && !dlg.open) {
        dlg.showModal();
      }
    };
    dlg.addEventListener("close", onNativeClose);
    return () => {
      closing = true;
      dlg.removeEventListener("close", onNativeClose);
      if (dlg.open) {
        dlg.close();
      }
      const fallback = props.current.returnFocusTo
        ? document.querySelector<HTMLElement>(props.current.returnFocusTo)
        : null;
      const back = opener?.isConnected ? opener : fallback;
      back?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class={p.class}
      aria-label={p.label}
      onCancel={(e) => {
        // the page state owns visibility: closing happens by unmounting
        e.preventDefault();
        if (p.escape !== false) {
          p.onClose();
        }
      }}
      onKeyDown={(e) => {
        // Tab cycles inside the dialog (the browser would leave the page for its own controls at the end)
        if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) {
          return;
        }
        const stops = tabStops(e.currentTarget);
        const first = stops[0];
        const last = stops.at(-1);
        if (!first || !last) {
          e.preventDefault();
          return;
        }
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === e.currentTarget)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // a drag that starts inside an input and ends beside the panel must not close the dialog
        if (p.backdrop !== false && e.target === e.currentTarget && pressedOnBackdrop.current) {
          p.onClose();
        }
        pressedOnBackdrop.current = false;
      }}
    >
      {p.children}
    </dialog>
  );
}
