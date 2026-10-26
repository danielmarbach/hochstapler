import gsap from "gsap";
import { onReducedMotionChange, prefersReducedMotion } from "../platform.ts";
import { invalidateAll } from "./invalidate.ts";

/** speed / instant flags are driven by the director (backlog) and by tab visibility */
export const clock = {
  _speed: 1,
  instant: false,
  /**
   * prefers-reduced-motion (UI review F06): tweens and waits jump to their final state instead of being sped up.
   * Follows the system setting live, see `setReducedMotion`.
   */
  reduced: prefersReducedMotion(),
  get speed() {
    return this._speed;
  },
  set speed(v: number) {
    this._speed = v;
    gsap.globalTimeline.timeScale(v);
  },
};

const motionListeners = new Set<(reduced: boolean) => void>();

/** the scene (camera transitions, water) reacts to a changed preference */
export function onMotionPreference(fn: (reduced: boolean) => void): () => void {
  motionListeners.add(fn);
  return () => motionListeners.delete(fn);
}

/** Applies the reduced-motion preference: running animations jump to their end and later ones are skipped. */
export function setReducedMotion(reduced: boolean): void {
  if (clock.reduced === reduced) {
    return;
  }
  clock.reduced = reduced;
  if (reduced) {
    flushTweens();
  }
  invalidateAll();
  for (const fn of [...motionListeners]) {
    fn(reduced);
  }
}

// the system setting can change during a session
onReducedMotionChange(setReducedMotion);

export type Ease = string;
export const easeInOut: Ease = "power2.inOut";
export const easeOutCubic: Ease = "power3.out";
export const linear: Ease = "none";
export const easeOutBack: Ease = "back.out(1.8)";

gsap.ticker.lagSmoothing(500, 33);

/** gsap-backed tween; resolves when finished. fn receives the eased progress 0..1 */
export function tween(
  durSec: number,
  fn: (k: number) => void,
  ease: Ease = easeInOut,
): Promise<void> {
  if (clock.instant || clock.reduced || durSec <= 0) {
    fn(1);
    invalidateAll();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const o = { k: 0 };
    gsap.to(o, {
      k: 1,
      duration: durSec,
      ease: "none",
      onUpdate: () => {
        fn(gsap.parseEase(ease)(o.k));
        invalidateAll();
      },
      onComplete: () => {
        fn(1);
        invalidateAll();
        resolve();
      },
    });
  });
}

export const sleep = (sec: number): Promise<void> =>
  clock.instant || clock.reduced || sec <= 0
    ? Promise.resolve()
    : new Promise((res) => {
        gsap.delayedCall(sec, res);
      });

/** finish everything immediately (backlog or hidden tab) */
export function flushTweens(): void {
  gsap.globalTimeline.getChildren(true, true, true).forEach((t) => {
    t.progress(1);
  });
}
