/** Minimum gap between two frames while something changes: caps 90/120 Hz displays at ~60 fps (a hair below 16.7 ms for jitter). */
export const ACTIVE_FRAME_MS = 15;
/** Gap between two frames while only the water moves: ~24 fps (a hair below 41.7 ms = 5 frames at 120 Hz, for jitter). */
export const IDLE_FRAME_MS = 38;

export type FrameKind = "skip" | "active" | "idle";

/**
 * Pure "should this display frame render?" logic of the render-on-demand loop. Anything that changes the picture calls
 * `invalidate()`; with nothing pending only the animated water keeps the scene alive, at the reduced idle rate.
 */
export class RenderScheduler {
  private readonly activeMs: number;
  private readonly idleMs: number;
  private last = -Infinity;
  private dirty = true;
  private shadowDirty = true;

  constructor(o: { activeMs: number; idleMs: number }) {
    this.activeMs = o.activeMs;
    this.idleMs = o.idleMs;
  }

  /** the picture is out of date; `shadows` when a shadow caster changed */
  invalidate(shadows = true): void {
    this.dirty = true;
    this.shadowDirty ||= shadows;
  }

  /** a requested frame has not been drawn yet */
  get pending(): boolean {
    return this.dirty;
  }

  /** ms until an idle (water) frame is due */
  idleDelay(now: number): number {
    return Math.max(0, this.idleMs - (now - this.last));
  }

  decide(now: number): FrameKind {
    const since = now - this.last;
    if (this.dirty) {
      return since >= this.activeMs ? "active" : "skip";
    }
    return since >= this.idleMs ? "idle" : "skip";
  }

  rendered(now: number): void {
    this.last = now;
    this.dirty = false;
  }

  /** true once per request: the shadow map must be re-rendered with this frame */
  takeShadowDirty(): boolean {
    const v = this.shadowDirty;
    this.shadowDirty = false;
    return v;
  }
}
