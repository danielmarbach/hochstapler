// WAI-ARIA tabs pattern helpers (UI review F03): tab/tabpanel ids that reference each other, roving tabindex and
// arrow-key navigation (Left/Right wrap around, Home/End jump; selection follows focus).
import type { JSX } from "preact";

export const tabId = (prefix: string, id: string): string => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string): string => `${prefix}-panel-${id}`;

/** attributes of one tab button */
export function tabProps(prefix: string, id: string, current: string) {
  const selected = id === current;
  return {
    id: tabId(prefix, id),
    role: "tab" as const,
    "aria-selected": selected,
    // only the shown panel exists in the DOM
    "aria-controls": selected ? panelId(prefix, id) : undefined,
    tabIndex: selected ? 0 : -1,
  };
}

/** attributes of the panel of the selected tab */
export function panelProps(prefix: string, id: string) {
  return {
    id: panelId(prefix, id),
    role: "tabpanel" as const,
    "aria-labelledby": tabId(prefix, id),
  };
}

/** the tab to select for a key press, or null when the key does not navigate */
export function nextTab(ids: readonly string[], current: string, key: string): string | null {
  const i = ids.indexOf(current);
  if (i < 0 || ids.length === 0) {
    return null;
  }
  switch (key) {
    case "ArrowRight":
      return ids[(i + 1) % ids.length] ?? null;
    case "ArrowLeft":
      return ids[(i - 1 + ids.length) % ids.length] ?? null;
    case "Home":
      return ids[0] ?? null;
    case "End":
      return ids.at(-1) ?? null;
    default:
      return null;
  }
}

/** onKeyDown of the tablist element: moves the selection and the focus */
export function tabKeys(
  prefix: string,
  ids: readonly string[],
  current: string,
  select: (id: string) => void,
): (e: JSX.TargetedKeyboardEvent<HTMLElement>) => void {
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const next = nextTab(ids, current, e.key);
    if (next === null) {
      return;
    }
    e.preventDefault();
    select(next);
    document.getElementById(tabId(prefix, next))?.focus();
  };
}
