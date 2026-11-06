// Debt arithmetic for the recovery panel (docs/DESIGN.md, T10): the debtor settles as soon as cash covers the amount.

/** What the cash does not cover yet. */
export function debtShortfall(amount: number, cash: number): number {
  return Math.max(0, amount - cash);
}

/** What is still missing after selling a lot for `proceeds`. */
export function debtAfterSale(amount: number, cash: number, proceeds: number): number {
  return Math.max(0, amount - cash - proceeds);
}

/** The player the debt is owed to; null for the bank (or a creditor who is not at the table). */
export function debtCreditorName(
  creditor: string | null,
  players: readonly { id: string; name: string }[],
): string | null {
  return players.find((p) => p.id === creditor)?.name ?? null;
}

/** Spaces become no-break spaces so a formatted amount ("CHF 900") never splits across lines. */
export function noBreak(text: string): string {
  return text.replace(/ /g, "\u00a0");
}
