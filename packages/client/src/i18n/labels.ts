// Labels of enumerations (trade status, tile kinds, building levels) in the current language.
import type { TileDef } from "@poly/engine";
import { t, type UiKey } from "./index.ts";

const TRADE_STATUS_KEYS = {
  pending: "trade.status.pending",
  accepted: "trade.status.accepted",
  rejected: "trade.status.rejected",
  cancelled: "trade.status.cancelled",
  invalid: "trade.status.invalid",
  expired: "trade.status.expired",
  countered: "trade.status.countered",
} as const satisfies Record<string, UiKey>;

function isTradeStatus(status: string): status is keyof typeof TRADE_STATUS_KEYS {
  return Object.hasOwn(TRADE_STATUS_KEYS, status);
}

/** "offen" / "pending" / ... ; unknown statuses are shown as received */
export function tradeStatusText(status: string): string {
  return isTradeStatus(status) ? t(TRADE_STATUS_KEYS[status]) : status;
}

const KIND_KEYS = {
  go: "kind.go",
  jail: "kind.jail",
  "free-parking": "kind.free-parking",
  "go-to-jail": "kind.go-to-jail",
  chance: "kind.chance",
  community: "kind.community",
  tax: "kind.tax",
  station: "kind.station",
  utility: "kind.utility",
  street: "kind.street",
} as const satisfies Record<TileDef["kind"], UiKey>;

export function tileKindText(kind: TileDef["kind"]): string {
  return t(KIND_KEYS[kind]);
}

const LEVEL_KEYS = [
  "rent.level0",
  "rent.level1",
  "rent.level2",
  "rent.level3",
  "rent.level4",
  "rent.level5",
  "rent.level6",
] as const satisfies readonly UiKey[];

/** "Grundmiete", "1 Haus", ... "Wolkenkratzer" for a building level 0..6 */
export function levelNameText(level: number): string {
  const key = LEVEL_KEYS[level];
  return key ? t(key) : String(level);
}
