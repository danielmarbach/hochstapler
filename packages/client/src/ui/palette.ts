import { need } from "../safe.ts";
/** Vintage travel-poster palettes: flat, bold colours per theme id, exposed as CSS variables. */

export interface Palette {
  /** body text */
  ink: string;
  /** muted text, still >= 4.5:1 on paper and paper2 */
  ink2: string;
  paper: string;
  paper2: string;
  /** main poster colour (buttons, bands); text on it is `onBrand` */
  brand: string;
  onBrand: string;
  /** deep secondary colour (headers, selected states); text on it is `onDeep` */
  deep: string;
  onDeep: string;
  /** light accent (sky / stone); text on it is `ink` */
  sky: string;
  /** warm highlight (ochre / gold); text on it is `ink` */
  gold: string;
  /** poster headline split into small pre-line and big place name */
  pre: string;
  place: string;
  /** postmark city */
  city: string;
}

export const PALETTES: Readonly<Record<string, Palette>> = {
  // alpine red / white / sky blue / pine green
  ch: {
    ink: "#1c2430",
    ink2: "#46515f",
    paper: "#f7f0e1",
    paper2: "#eadfc7",
    brand: "#c8281e",
    onBrand: "#ffffff",
    deep: "#1f5a45",
    onDeep: "#f7f0e1",
    sky: "#8cc4e6",
    gold: "#f0b429",
    pre: "Willkommen in",
    place: "der Schweiz",
    city: "ZÜRICH",
  },
  // Paris navy / cream / coral
  fr: {
    ink: "#16224a",
    ink2: "#3d4668",
    paper: "#f7eed9",
    paper2: "#ebdfc2",
    brand: "#c0402c",
    onBrand: "#ffffff",
    deep: "#1d2b5a",
    onDeep: "#f7eed9",
    sky: "#a9c7e8",
    gold: "#f2b84b",
    pre: "Bienvenue en",
    place: "France",
    city: "PARIS",
  },
  // deep green / ochre / brick
  de: {
    ink: "#1b2a22",
    ink2: "#3f4e45",
    paper: "#f2ebd8",
    paper2: "#e5dac0",
    brand: "#a8392b",
    onBrand: "#ffffff",
    deep: "#1e4d3a",
    onDeep: "#f2ebd8",
    sky: "#9bbfc9",
    gold: "#d99a22",
    pre: "Willkommen in",
    place: "Deutschland",
    city: "BERLIN",
  },
  // terracotta / olive / sky
  it: {
    ink: "#2a1e18",
    ink2: "#5a463b",
    paper: "#f8eddb",
    paper2: "#ecdcc0",
    brand: "#b2472a",
    onBrand: "#ffffff",
    deep: "#565b2c",
    onDeep: "#f8eddb",
    sky: "#86b6d4",
    gold: "#e3a63a",
    pre: "Benvenuti in",
    place: "Italia",
    city: "ROMA",
  },
};

const FALLBACK_ID = "ch";

export function paletteFor(themeId: string): Palette {
  return PALETTES[themeId] ?? need(PALETTES[FALLBACK_ID], "fallback palette");
}

/** writes the palette as CSS custom properties on <html> */
export function applyPalette(themeId: string): void {
  const p = paletteFor(themeId);
  const vars: Record<string, string> = {
    "--ink": p.ink,
    "--ink-2": p.ink2,
    "--paper": p.paper,
    "--paper-2": p.paper2,
    "--brand": p.brand,
    "--on-brand": p.onBrand,
    "--deep": p.deep,
    "--on-deep": p.onDeep,
    "--sky": p.sky,
    "--gold": p.gold,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = themeId;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return null;
  }
  const digits = m[1] ?? "";
  const h =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) {
    return 0.5;
  }
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a),
    lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** black or white text, whichever reads better on `bg` */
export function inkOn(bg: string): string {
  return contrast(bg, "#ffffff") >= contrast(bg, "#16130f") ? "#ffffff" : "#16130f";
}
