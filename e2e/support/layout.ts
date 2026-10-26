// Reusable, viewport-independent layout assertions for the responsive suite (docs/DESIGN.md #18).
// Everything is measured in the page (real layout), the test only sees a list of human-readable violations.
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Selector for everything a user can press, type into or choose. */
export const INTERACTIVE_SELECTOR = [
  "button",
  "[role=button]",
  "[role=tab]",
  "a[href]",
  "input",
  "select",
  "textarea",
  '[data-testid^="action-"]',
].join(",");

/** Minimum touch target edge in CSS px (DESIGN #18). */
export const MIN_TOUCH_PX = 44;

/**
 * Elements that may stay below the touch minimum. Keep this list tiny and justified.
 * `selector` is matched with Element.matches().
 */
export interface TouchExemption {
  readonly selector: string;
  readonly reason: string;
}
export const TOUCH_EXEMPTIONS: readonly TouchExemption[] = [
  {
    selector: "input[type=range]",
    reason:
      "native slider: the draggable thumb is 44px+, the track is only visual; the box spans the full row",
  },
];

/** Labels that must never be cut off. Matched against `[data-testid]` or class. */
export const CRITICAL_TEXT_SELECTOR = [
  '[data-testid="turn-name"]',
  '[data-testid="player-cash"]',
  '[data-testid="sheet-cash"]',
  '[data-testid^="action-"]',
  ".pkname",
  ".pname",
  ".ptitle",
  ".phead h2",
  ".phead h3",
  "[data-testid=winner]",
].join(",");

export interface AuditOptions {
  /** viewport is a touch device: enforce the 44px rule */
  touch: boolean;
  /** limit the audit to this subtree (defaults to the whole page) */
  scope?: string;
}

interface RawViolation {
  kind: string;
  element: string;
  detail: string;
}

/** The measuring code. Runs inside the page, must be self-contained (no closures). */
interface PageArgs {
  interactive: string;
  critical: string;
  touch: boolean;
  minTouch: number;
  exemptions: readonly string[];
  scope: string | null;
  checks: readonly string[];
}

function measure(args: PageArgs): RawViolation[] {
  const out: RawViolation[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const EPS = 1;
  const root: ParentNode = (args.scope ? document.querySelector(args.scope) : null) ?? document;

  const describe = (el: Element): string => {
    const id = el.getAttribute("data-testid");
    const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30);
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).join(".") : "";
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}${cls ? `.${cls}` : ""} "${label}"`;
  };
  const isVisible = (el: Element): boolean => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) {
      return false;
    }
    if (el.closest("[inert],[hidden],[aria-hidden=true]")) {
      return false;
    }
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) {
        return false;
      }
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const scrollable = (el: Element, axis: "x" | "y"): boolean => {
    const s = getComputedStyle(el);
    const o = axis === "x" ? s.overflowX : s.overflowY;
    if (o !== "auto" && o !== "scroll") {
      return false;
    }
    return axis === "x" ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight;
  };
  /** ancestors that clip their content (overflow other than visible) */
  const clippers = (el: Element): Element[] => {
    const list: Element[] = [];
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") {
        list.push(n);
      }
    }
    return list;
  };
  const inside = (r: DOMRect, box: { l: number; t: number; r: number; b: number }): boolean =>
    r.left >= box.l - EPS &&
    r.top >= box.t - EPS &&
    r.right <= box.r + EPS &&
    r.bottom <= box.b + EPS;
  const viewBox = { l: 0, t: 0, r: vw, b: vh };
  /** the element sits in a `position: sticky` box (a footer that follows the scroll) */
  const stuckTo = (el: Element): boolean => {
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === "sticky") {
        return true;
      }
    }
    return false;
  };

  const wanted = (k: string): boolean => args.checks.includes(k);

  // ---- 1. nothing wider than the viewport / horizontal overflow ----
  if (wanted("overflow")) {
    const se = document.scrollingElement;
    if (se && se.scrollWidth > vw + EPS) {
      out.push({
        kind: "horizontal-overflow",
        element: "document",
        detail: `scrollWidth ${se.scrollWidth} > innerWidth ${vw}`,
      });
    }
    for (const el of document.querySelectorAll("#app *")) {
      if (el.closest("canvas, .canvas-host") || !isVisible(el)) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width > vw + EPS) {
        out.push({
          kind: "wider-than-viewport",
          element: describe(el),
          detail: `width ${Math.round(r.width)} > ${vw}`,
        });
        continue;
      }
      // sticking out sideways (ignore content inside a horizontally scrolling or clipping parent)
      if (r.left < -EPS || r.right > vw + EPS) {
        const clipped = clippers(el).some((c) => {
          const cr = c.getBoundingClientRect();
          return cr.left >= -EPS && cr.right <= vw + EPS;
        });
        if (!clipped) {
          out.push({
            kind: "outside-viewport-x",
            element: describe(el),
            detail: `x ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`,
          });
        }
      }
    }
  }

  // ---- 2./3. interactive elements: reachable, not covered, big enough ----
  if (wanted("interactive") || wanted("touch")) {
    for (const el of root.querySelectorAll(args.interactive)) {
      if (!isVisible(el) || getComputedStyle(el).pointerEvents === "none") {
        continue;
      }
      // bring it into view inside scroll containers first (a reachable element may legitimately sit below the fold)
      // (only when a scrollable ancestor really hides it: scrolling an overflow:hidden box would move the layout)
      let r = el.getBoundingClientRect();
      const hiddenByScroller = clippers(el).some((c) => {
        const cr = c.getBoundingClientRect();
        return (
          (scrollable(c, "x") || scrollable(c, "y")) &&
          !inside(r, { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom })
        );
      });
      if (hiddenByScroller) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        r = el.getBoundingClientRect();
      }
      const name = describe(el);

      if (wanted("interactive")) {
        if (!inside(r, viewBox)) {
          out.push({
            kind: "outside-viewport",
            element: name,
            detail: `box ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh}`,
          });
          continue;
        }
        for (const c of clippers(el)) {
          const cr = c.getBoundingClientRect();
          const box = { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom };
          if (!inside(r, box) && !scrollable(c, "x") && !scrollable(c, "y")) {
            out.push({
              kind: "clipped-by-ancestor",
              element: name,
              detail: `clipped by ${describe(c)}`,
            });
            break;
          }
        }
        const probe = (): Element | null => {
          const box = el.getBoundingClientRect();
          return document.elementFromPoint(
            Math.min(Math.max(box.left + box.width / 2, 0), vw - 1),
            Math.min(Math.max(box.top + box.height / 2, 0), vh - 1),
          );
        };
        let hit = probe();
        // a sticky footer (setup form, lobby) overlaps content that is simply scrolled below it: the user scrolls it clear
        if (hit && hit !== el && !el.contains(hit) && stuckTo(hit)) {
          el.scrollIntoView({ block: "center", inline: "nearest" });
          hit = probe();
        }
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          out.push({
            kind: "covered",
            element: name,
            detail: `centre hit by ${describe(hit)}`,
          });
        }
      }

      if (wanted("touch") && args.touch) {
        const exempt = args.exemptions.some((s) => el.matches(s));
        const small = r.width < args.minTouch - 0.5 || r.height < args.minTouch - 0.5;
        if (small && !exempt) {
          out.push({
            kind: "touch-target",
            element: name,
            detail: `${r.width.toFixed(1)}x${r.height.toFixed(1)} < ${args.minTouch}`,
          });
        }
      }
    }
  }

  // ---- 4. clipped critical text ----
  if (wanted("text")) {
    const seen = new Set<Element>();
    const consider = (el: Element, mustCheck: boolean): void => {
      if (seen.has(el) || !isVisible(el) || !(el instanceof HTMLElement)) {
        return;
      }
      seen.add(el);
      const s = getComputedStyle(el);
      const ellipsis = s.textOverflow === "ellipsis" && el.hasAttribute("title");
      if (ellipsis) {
        return;
      }
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
      );
      if (!ownText && !mustCheck) {
        return;
      }
      // sideways: a primary label must fit its box; any other box must not hide text with overflow:hidden/clip
      const clipsX = s.overflowX === "hidden" || s.overflowX === "clip";
      const clipsY = s.overflowY === "hidden" || s.overflowY === "clip";
      const tooWide = el.scrollWidth > el.clientWidth + EPS && (mustCheck || clipsX);
      const tooTall = el.scrollHeight > el.clientHeight + EPS && clipsY;
      if (tooWide || tooTall) {
        out.push({
          kind: "clipped-text",
          element: describe(el),
          detail: `scroll ${el.scrollWidth}x${el.scrollHeight} > client ${el.clientWidth}x${el.clientHeight}`,
        });
      }
    };
    for (const el of root.querySelectorAll(args.critical)) {
      consider(el, true);
    }
    for (const el of root.querySelectorAll("#app *")) {
      if (!el.closest("canvas, .canvas-host")) {
        consider(el, false);
      }
    }
  }

  return out;
}

export type Check = "overflow" | "interactive" | "touch" | "text";

/** Runs the in-page measurements and returns what is wrong, formatted for the failure message. */
export async function collectLayoutViolations(
  page: Page,
  options: AuditOptions,
  checks: readonly Check[] = ["overflow", "interactive", "touch", "text"],
): Promise<string[]> {
  const raw = await page.evaluate(measure, {
    interactive: INTERACTIVE_SELECTOR,
    critical: CRITICAL_TEXT_SELECTOR,
    touch: options.touch,
    minTouch: MIN_TOUCH_PX,
    exemptions: TOUCH_EXEMPTIONS.map((e) => e.selector),
    scope: options.scope ?? null,
    checks,
  });
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const v of raw) {
    const line = `${v.kind}: ${v.element} (${v.detail})`;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

/** All generic layout rules at once. */
export async function expectSoundLayout(page: Page, options: AuditOptions): Promise<void> {
  expect(await collectLayoutViolations(page, options), "layout violations").toEqual([]);
}

/** no horizontal scrolling and nothing wider than the viewport */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await collectLayoutViolations(page, { touch: false }, ["overflow"]),
    "horizontal overflow",
  ).toEqual([]);
}

/** every visible interactive element is reachable and not covered */
export async function expectInteractiveReachable(page: Page, scope?: string): Promise<void> {
  expect(
    await collectLayoutViolations(page, { touch: false, ...(scope ? { scope } : {}) }, [
      "interactive",
    ]),
    "unreachable or covered controls",
  ).toEqual([]);
}

/** touch devices: every interactive element is at least 44x44 CSS px */
export async function expectTouchTargets(page: Page, scope?: string): Promise<void> {
  expect(
    await collectLayoutViolations(page, { touch: true, ...(scope ? { scope } : {}) }, ["touch"]),
    "touch targets below 44px",
  ).toEqual([]);
}

/** primary labels are neither clipped nor silently truncated */
export async function expectNoClippedText(page: Page, scope?: string): Promise<void> {
  expect(
    await collectLayoutViolations(page, { touch: false, ...(scope ? { scope } : {}) }, ["text"]),
    "clipped text",
  ).toEqual([]);
}

/**
 * The locator is completely visible right now, without scrolling anything: inside the viewport and inside every
 * clipping ancestor at its current scroll position. Used for the action bars of modals and sheets on phones.
 */
export async function expectVisibleWithoutScrolling(locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} is rendered`).toBeVisible();
  // layout that follows the DOM through a ResizeObserver (the phone sheet offset) only updates with the next frame:
  // measuring before it would compare against the previous state
  await locator
    .page()
    .evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  await animationsFinished(locator.page());
  const problem = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const eps = 1;
    if (
      r.left < -eps ||
      r.top < -eps ||
      r.right > window.innerWidth + eps ||
      r.bottom > window.innerHeight + eps
    ) {
      return `outside the viewport (${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)})`;
    }
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX === "visible" && s.overflowY === "visible") {
        continue;
      }
      const c = n.getBoundingClientRect();
      if (
        r.left < c.left - eps ||
        r.top < c.top - eps ||
        r.right > c.right + eps ||
        r.bottom > c.bottom + eps
      ) {
        return `scrolled/clipped out of its container`;
      }
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && (hit === el || el.contains(hit) || hit.contains(el))
      ? null
      : "covered by another element";
  });
  expect(problem, `${what} visible without scrolling`).toBeNull();
}

/** Waits until all finite CSS animations/transitions are done (reduced motion makes them ~instant, but not zero). */
export async function animationsFinished(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // resize/mutation observers run before the next paint and may start transitions (the phone sheet follows its
    // content height): look again after two frames until nothing finite is left, at most three rounds
    const frames = () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    for (let round = 0; round < 3; round++) {
      await frames();
      const finite = document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
      if (finite.length === 0) {
        return;
      }
      await Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
        new Promise((done) => setTimeout(done, 3000)),
      ]);
    }
  });
}

/** What the player-list check found (formatted lines, empty = fine). Runs in the page, must be self-contained. */
function measurePlayerCards(): string[] {
  const EPS = 1;
  const out: string[] = [];
  const list = document.querySelector<HTMLElement>(".players");
  if (!list) {
    return ["no player list (.players) on screen"];
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const label = (el: Element): string => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).join(".") : "";
    const id = el.getAttribute("data-testid");
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}${cls ? `.${cls}` : ""} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
  };
  // the list and every ancestor up to the HUD: no horizontal scrolling anywhere on the way
  for (let n: HTMLElement | null = list; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + EPS) {
      out.push(
        `horizontal-scroll: ${label(n)} (scrollWidth ${n.scrollWidth} > clientWidth ${n.clientWidth})`,
      );
    }
  }
  // the box the cards may use: the list's padding box, narrowed by every clipping ancestor and the viewport
  const clip = { l: 0, t: 0, r: vw, b: vh };
  for (let n: HTMLElement | null = list; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (n === list || s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = n.getBoundingClientRect();
      clip.l = Math.max(clip.l, r.left);
      clip.t = Math.max(clip.t, r.top);
      clip.r = Math.min(clip.r, r.right);
      clip.b = Math.min(clip.b, r.bottom);
    }
  }
  const cards = [...list.querySelectorAll<HTMLElement>('[data-testid="player-panel"]')];
  if (cards.length === 0) {
    out.push("no player cards");
  }
  for (const card of cards) {
    card.scrollIntoView({ block: "nearest", inline: "nearest" });
    const cr = card.getBoundingClientRect();
    const inClip = (r: DOMRect, slack: number): boolean =>
      r.left >= clip.l - EPS - slack &&
      r.right <= clip.r + EPS + slack &&
      r.top >= clip.t - EPS - slack &&
      r.bottom <= clip.b + EPS + slack;
    if (!inClip(cr, 0)) {
      out.push(
        `card-clipped: ${label(card)} box ${Math.round(cr.left)},${Math.round(cr.top)}..${Math.round(cr.right)},${Math.round(cr.bottom)} in ${Math.round(clip.l)},${Math.round(clip.t)}..${Math.round(clip.r)},${Math.round(clip.b)}`,
      );
    }
    // every part of the card stays inside the card (the turn tag hangs 2px over the right and 11px below the edge on purpose)
    for (const part of card.querySelectorAll<HTMLElement>("*")) {
      const r = part.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(part).display === "none") {
        continue;
      }
      const tag = part.classList.contains("turn-tag");
      const insideX = r.left >= cr.left - EPS && r.right <= cr.right + (tag ? 3 : EPS);
      const insideY = r.top >= cr.top - EPS && r.bottom <= cr.bottom + (tag ? 12 : EPS);
      if (!insideX || !insideY) {
        out.push(`part-outside-card: ${label(part)} in ${label(card)}`);
      }
      if (!inClip(r, tag ? 12 : 0) && part.getAttribute("data-testid") !== null) {
        out.push(`part-clipped: ${label(part)} in ${label(card)}`);
      }
      if (
        part.scrollWidth > part.clientWidth + EPS &&
        getComputedStyle(part).overflowX === "hidden"
      ) {
        const title = part.getAttribute("title");
        // an ellipsized name is acceptable only when the full text is still reachable
        if (!title && !part.closest("[title]")) {
          out.push(`text-cut: ${label(part)}`);
        }
      }
    }
  }
  // nothing else of the HUD lies on top of a card (what sits at the card's centre and corners belongs to the card)
  for (const card of cards) {
    card.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = card.getBoundingClientRect();
    const points: [number, number][] = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 6, r.top + 6],
      [r.right - 6, r.top + 6],
      [r.left + 6, r.bottom - 6],
      [r.right - 6, r.bottom - 6],
    ];
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= vw || y >= vh) {
        out.push(`card-outside-viewport: ${label(card)} at ${Math.round(x)},${Math.round(y)}`);
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      if (hit && !card.contains(hit)) {
        out.push(`covered-by-hud: ${label(card)} covered by ${label(hit)}`);
        break;
      }
    }
  }
  return out;
}

/**
 * The player list (desktop/tablet: left panel, phone: "Spieler" tab of the sheet): no horizontal scrolling, no card cut
 * off by the list, its container or the viewport, every badge/stamp/cash inside its card, no HUD part on top of it.
 */
export async function expectPlayerCardsSound(page: Page): Promise<void> {
  expect(await page.evaluate(measurePlayerCards), "player cards").toEqual([]);
  await expectTokenImages(page.locator('[data-testid="player-panel"] img.tokimg'), "player card");
}

/**
 * Token pictures are rendered thumbnails (docs/DESIGN.md, token thumbnails): at least `min` are present, every one has
 * loaded (naturalWidth > 0, no emoji fallback), carries a non-empty alt text and keeps a square, visible box.
 */
export async function expectTokenImages(images: Locator, what: string, min = 1): Promise<void> {
  expect(await images.count(), `${what}: token images`).toBeGreaterThanOrEqual(min);
  await expect
    .poll(
      () =>
        images.evaluateAll(
          (els) =>
            els.filter((el) => !(el instanceof HTMLImageElement) || el.naturalWidth === 0).length,
        ),
      { message: `${what}: every token image has loaded`, timeout: 10_000 },
    )
    .toBe(0);
  const problems = await images.evaluateAll((els) =>
    els.flatMap((el, i) => {
      const r = el.getBoundingClientRect();
      const out: string[] = [];
      if (!(el.getAttribute("alt") ?? "").trim()) {
        out.push(`#${i} has no alt text`);
      }
      if (r.width < 16 || Math.abs(r.width - r.height) > 1) {
        out.push(`#${i} box ${r.width}x${r.height}`);
      }
      return out;
    }),
  );
  expect(problems, `${what}: token images`).toEqual([]);
}

/**
 * The game piece picker (docs/DESIGN.md #75): `tiles` tiles, each a 44px target with its icon and texts inside, none
 * overlapping or leaving the picker/viewport; `taken` of them aria-disabled; exactly one is the pressed (own) piece.
 */
export async function expectTokenPickerSound(
  page: Page,
  expected: { tiles: number; taken: number },
): Promise<void> {
  const problems = await page.evaluate((exp) => {
    const out: string[] = [];
    const EPS = 1;
    const picker = document.querySelector<HTMLElement>('[data-testid="token-picker"]');
    if (!picker) {
      return ["no token picker"];
    }
    const pr = picker.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (pr.left < -EPS || pr.right > vw + EPS) {
      out.push(`picker outside viewport: ${Math.round(pr.left)}..${Math.round(pr.right)} of ${vw}`);
    }
    const tiles = [...picker.querySelectorAll<HTMLElement>('[data-testid="token"]')];
    if (tiles.length !== exp.tiles) {
      out.push(`${tiles.length} tiles, expected ${exp.tiles}`);
    }
    const taken = tiles.filter((t) => t.getAttribute("aria-disabled") === "true");
    if (taken.length !== exp.taken) {
      out.push(`${taken.length} disabled tiles, expected ${exp.taken}`);
    }
    const pressed = tiles.filter((t) => t.getAttribute("aria-pressed") === "true");
    if (pressed.length !== 1) {
      out.push(`${pressed.length} pressed tiles, expected 1`);
    }
    const rects = tiles.map((t) => t.getBoundingClientRect());
    tiles.forEach((tile, i) => {
      const r = rects[i];
      if (!r) {
        return;
      }
      const id = tile.getAttribute("data-token") ?? String(i);
      if (r.width < 44 || r.height < 44) {
        out.push(`${id}: target ${Math.round(r.width)}x${Math.round(r.height)} below 44px`);
      }
      if (r.left < pr.left - EPS || r.right > pr.right + EPS) {
        out.push(`${id}: outside picker horizontally`);
      }
      if (
        tile.scrollHeight > tile.clientHeight + EPS ||
        tile.scrollWidth > tile.clientWidth + EPS
      ) {
        out.push(`${id}: content overflows the tile`);
      }
      for (const part of tile.querySelectorAll<HTMLElement>(".pkico, .pkname, .pkby")) {
        const p = part.getBoundingClientRect();
        if (p.left < r.left - EPS || p.right > r.right + EPS || p.bottom > r.bottom + EPS) {
          out.push(`${id}: ${part.className} sticks out of the tile`);
        }
        if (part.scrollWidth > part.clientWidth + EPS) {
          out.push(`${id}: ${part.className} is cut off`);
        }
      }
      rects.forEach((o, j) => {
        if (
          j > i &&
          r.left < o.right - EPS &&
          o.left < r.right - EPS &&
          r.top < o.bottom - EPS &&
          o.top < r.bottom - EPS
        ) {
          out.push(`tiles ${i} and ${j} overlap`);
        }
      });
      if (
        tile.getAttribute("aria-disabled") === "true" &&
        !tile.getAttribute("aria-label")?.includes(",")
      ) {
        out.push(`${id}: disabled tile does not say who holds it`);
      }
    });
    return out;
  }, expected);
  expect(problems, "token picker").toEqual([]);
  await expectTokenImages(
    page.locator('[data-testid="token-picker"] img.tokimg'),
    "token picker",
    expected.tiles,
  );
}

/** The element sits horizontally in the middle of the viewport (a centred bar must not be pushed off by an animation). */
export async function expectHorizontallyCentred(locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} is rendered`).toBeVisible();
  await animationsFinished(locator.page());
  const offset = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2 - window.innerWidth / 2;
  });
  expect(
    Math.abs(offset),
    `${what} is horizontally centred (offset ${offset.toFixed(1)}px)`,
  ).toBeLessThanOrEqual(2);
}

/** The travel poster of the start page shows all of its text: nothing is squeezed or cut off at the bottom (UI review T08). */
export async function expectPosterNotClipped(page: Page): Promise<void> {
  const problem = await page.locator(".poster").evaluate((poster) => {
    const box = poster.getBoundingClientRect();
    if (poster.scrollHeight > poster.clientHeight + 1) {
      return `content ${poster.scrollHeight}px taller than the poster ${poster.clientHeight}px`;
    }
    for (const el of poster.querySelectorAll("p, h1, .poster-place")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > box.bottom + 1) {
        return `${el.tagName.toLowerCase()} ends ${Math.round(r.bottom - box.bottom)}px below the poster`;
      }
    }
    return null;
  });
  expect(problem, "poster text clipped").toBeNull();
}

/** HUD panels that must not sit on top of the board (the board is framed into the free rectangle, UI review T09). */
const HUD_PANELS = [
  ".hud .players .pp",
  ".hud .turn",
  ".hud .topright > *",
  ".hud .actionbar",
  ".hud .logtoggle",
  ".hud .logpanel",
  ".hud .drawer",
  ".hud .spectator",
].join(",");

interface Corner {
  x: number;
  y: number;
}

/**
 * The projected outline of the 3D board (screen positions of its four outer corners, via the test hook compiled into
 * the suite's bundle) lies inside the viewport and is not covered by any HUD panel. Waits for the camera to settle.
 */
export async function expectBoardClearOfHud(page: Page): Promise<void> {
  const read = (): Promise<Corner[] | null> =>
    page.evaluate(
      () =>
        (
          window as unknown as { __polyTest?: { boardCorners(): { x: number; y: number }[] } }
        ).__polyTest?.boardCorners() ?? null,
    );
  // the scene re-frames on the next animation frame (slow under software WebGL): wait until it knows the drawer
  await page.waitForFunction(() => {
    const hooks = (window as unknown as { __polyTest?: { insets(): { l: number; b: number } } })
      .__polyTest;
    if (!hooks) {
      return false;
    }
    const drawer = document.querySelector<HTMLElement>(".drawer");
    if (!drawer) {
      return true;
    }
    const insets = hooks.insets();
    return drawer.offsetWidth < innerWidth * 0.6
      ? insets.l >= drawer.offsetLeft + drawer.offsetWidth
      : insets.b >= innerHeight - drawer.offsetTop;
  });
  let corners = await read();
  expect(corners, "board corner hook (bundle built with POLY_E2E_HOOKS=1)").not.toBeNull();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    const next = await read();
    const before = corners;
    const still =
      next !== null &&
      before !== null &&
      next.every(
        (c, k) =>
          Math.abs(c.x - (before[k]?.x ?? 0)) < 0.5 && Math.abs(c.y - (before[k]?.y ?? 0)) < 0.5,
      );
    corners = next;
    if (still) {
      break;
    }
  }
  const problems = await page.evaluate(
    ({ points, panels }) => {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const box = {
        l: Math.min(...xs),
        r: Math.max(...xs),
        t: Math.min(...ys),
        b: Math.max(...ys),
      };
      const out: string[] = [];
      const round = (n: number): number => Math.round(n);
      const where = `${round(box.l)},${round(box.t)}..${round(box.r)},${round(box.b)}`;
      if (box.l < -1 || box.t < -1 || box.r > innerWidth + 1 || box.b > innerHeight + 1) {
        out.push(`board ${where} leaves the viewport ${innerWidth}x${innerHeight}`);
      }
      for (const el of document.querySelectorAll(panels)) {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display === "none" || s.visibility === "hidden" || r.width === 0 || r.height === 0) {
          continue;
        }
        if (r.left < box.r && r.right > box.l && r.top < box.b && r.bottom > box.t) {
          const id = el.getAttribute("data-testid");
          const cls = String(el.className).trim().split(/\s+/).join(".");
          out.push(
            `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}.${cls} ${round(r.left)},${round(r.top)}..${round(r.right)},${round(r.bottom)} covers board ${where}`,
          );
        }
      }
      return out;
    },
    { points: corners ?? [], panels: HUD_PANELS },
  );
  expect(problems, "board covered by HUD panels").toEqual([]);
}

/** Rectangles of the visible elements matching `selector` (hidden or zero-sized ones are ignored). */
async function visibleRects(page: Page, selector: string): Promise<Rect[]> {
  return page.evaluate((sel) => {
    const out: { l: number; t: number; r: number; b: number }[] = [];
    for (const el of document.querySelectorAll(sel)) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.display === "none" || s.visibility === "hidden" || r.width === 0 || r.height === 0) {
        continue;
      }
      out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    return out;
  }, selector);
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

const fmt = (r: Rect): string =>
  `${Math.round(r.l)},${Math.round(r.t)}..${Math.round(r.r)},${Math.round(r.b)}`;

/** No visible element of `first` overlaps a visible element of `second` (both may be absent: nothing to compare). */
export async function expectNoOverlap(
  page: Page,
  first: string,
  second: string,
  what: string,
): Promise<void> {
  await animationsFinished(page);
  const [a, b] = await Promise.all([visibleRects(page, first), visibleRects(page, second)]);
  const clashes = a.flatMap((ra) =>
    b.filter((rb) => rectsOverlap(ra, rb)).map((rb) => `${fmt(ra)} overlaps ${fmt(rb)}`),
  );
  expect(clashes, `${what} must not overlap`).toEqual([]);
}

/** The open property/securities drawer never covers the action bar (the bar can be taller, e.g. with a debt notice). */
export const expectDrawerClearOfActionBar = (page: Page): Promise<void> =>
  expectNoOverlap(
    page,
    '[data-testid="drawer"]',
    '[data-testid="action-bar"]',
    "Drawer and action bar",
  );

/** The turn banner and the top-right toolbar share the top row without overlapping or clipping each other. */
export const expectTopRowClear = (page: Page): Promise<void> =>
  expectNoOverlap(page, '[data-testid="turn-banner"]', ".topright", "Turn banner and toolbar");
