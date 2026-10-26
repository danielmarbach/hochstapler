// Reading time of a drawn card (UI review T04). The card is an overlay with its own clock: it never blocks the
// director's event queue, so a long read does not delay the game state of this client.

/** Minimum time a drawn card stays open. */
export const CARD_READING_MS = 3200;
/** Extra reading time per character of the card text beyond the minimum (long cards need longer). */
export const CARD_PER_CHAR_MS = 55;
/** Reading time never exceeds this without the player holding the card. */
export const CARD_MAX_READING_MS = 9000;
/** Grace period after the pointer or focus leaves a held card. */
export const CARD_RELEASE_MS = 1200;
/** Upper bound for a held (hovered/focused) card before it closes anyway. */
export const CARD_MAX_HOLD_MS = 15_000;

/** How long a card with `chars` characters is shown; `speed` > 1 shortens it when the event backlog is long. */
export function readingTime(chars: number, speed = 1): number {
  const base = Math.min(
    CARD_MAX_READING_MS,
    Math.max(CARD_READING_MS, CARD_READING_MS - 1000 + chars * CARD_PER_CHAR_MS),
  );
  return base / Math.max(1, speed);
}

/** The timer behind the card popup: one deadline that reading, holding and releasing re-arm. */
export class CardHold {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly expire: () => void;

  constructor(expire: () => void) {
    this.expire = expire;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  /** a new card: it closes after `ms` unless held */
  show(ms: number): void {
    this.arm(ms);
  }

  /** pointer or focus on the card: extends the reading time, but never indefinitely */
  hold(): void {
    if (this.active) {
      this.arm(CARD_MAX_HOLD_MS);
    }
  }

  /** pointer or focus left the card: it closes after a short grace period */
  release(): void {
    if (this.active) {
      this.arm(CARD_RELEASE_MS);
    }
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(ms: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.expire();
    }, ms);
  }
}
