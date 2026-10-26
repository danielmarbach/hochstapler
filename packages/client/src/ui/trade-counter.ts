// Pure helpers of the counteroffer flow (docs/DESIGN.md "counteroffers"): the prefilled form and the
// compact history note ("Ben: 260 instead of 200").
import { MAX_COUNTERS, type PlayerId, type Trade, type TradeOffer } from "@poly/engine";

/** The answering player may reply with a counteroffer: the offer is open and the chain is not used up. */
export function canCounter(tr: Trade): boolean {
  return tr.status === "pending" && (tr.counterDepth ?? 0) < MAX_COUNTERS;
}

/** What the original proposer gave becomes what the answering player wants, and vice versa. */
export function counterDraft(tr: Trade): TradeOffer {
  return {
    to: tr.from,
    giveCash: tr.wantCash,
    giveTiles: [...tr.wantTiles],
    giveJailCards: tr.wantJailCards,
    wantCash: tr.giveCash,
    wantTiles: [...tr.giveTiles],
    wantJailCards: tr.giveJailCards,
  };
}

export type CounterNote =
  { kind: "cash"; by: PlayerId; now: number; was: number } | { kind: "changed"; by: PlayerId };

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * One-line summary of how a counteroffer differs from the offer it answers. When only the price
 * moved, both prices are named as amounts (the money flows the same way in both offers).
 */
export function counterNote(cur: Trade, prev: Trade | undefined): CounterNote | null {
  if (cur.counterOf === undefined) {
    return null;
  }
  if (
    prev !== undefined &&
    sameSet(prev.giveTiles, cur.wantTiles) &&
    sameSet(prev.wantTiles, cur.giveTiles) &&
    prev.giveJailCards === cur.wantJailCards &&
    prev.wantJailCards === cur.giveJailCards
  ) {
    const was = prev.giveCash - prev.wantCash;
    const now = cur.wantCash - cur.giveCash;
    // same direction of the money (the counterer receives in both, or pays in both)
    if (was * now >= 0 && was !== now) {
      return { kind: "cash", by: cur.from, now: Math.abs(now), was: Math.abs(was) };
    }
  }
  return { kind: "changed", by: cur.from };
}
