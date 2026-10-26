/**
 * Global "the picture changed" signal for code that has no scene reference (tweens, async model loading).
 * Every live GameScene subscribes and schedules a frame.
 */
type Listener = (shadows: boolean) => void;
const listeners = new Set<Listener>();

export function onInvalidate(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function invalidateAll(shadows = true): void {
  for (const fn of listeners) {
    fn(shadows);
  }
}
