// WCAG 2.x contrast helper for the e2e suite (docs/DESIGN.md #18): computed colours in, ratio out.
import type { Locator } from "@playwright/test";

/** Parses the `rgb()`/`rgba()` strings `getComputedStyle` returns. */
export function parseRgb(css: string): { r: number; g: number; b: number; a: number } {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(css);
  if (!m) {
    throw new Error(`Not an rgb colour: ${css}`);
  }
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(css: string): number {
  const { r, g, b } = parseRgb(css);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (1..21) of two opaque CSS colours. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Text colour of the element and the first opaque background colour behind it (walking up the ancestors). */
export async function textAndBackground(locator: Locator): Promise<{ fg: string; bg: string }> {
  return locator.evaluate((el) => {
    let bg = "rgb(255, 255, 255)";
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = /rgba\(.*,\s*([\d.]+)\)$/.exec(c);
      if (c !== "transparent" && !(m && Number(m[1]) < 1)) {
        bg = c;
        break;
      }
    }
    return { fg: getComputedStyle(el).color, bg };
  });
}
