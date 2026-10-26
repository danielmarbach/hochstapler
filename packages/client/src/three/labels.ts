import { context2d } from "../safe.ts";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";
import { themeText, type TileDef, type Theme } from "@poly/engine";
import { formatMoney } from "../i18n/format.ts";
import { t } from "../i18n/index.ts";
import { getLang } from "../i18n/lang.ts";

const SERIF = '"Alegreya", Georgia, serif';
const SANS = "Inter, system-ui, sans-serif";

const BASE: Record<string, string> = {
  street: "#f7eed8",
  station: "#ece3d6",
  utility: "#e6eadb",
  chance: "#f8dfc0",
  community: "#d9e6ea",
  tax: "#ede0cb",
  go: "#f5d7b4",
  jail: "#f1d9cf",
  "free-parking": "#dcebc6",
  "go-to-jail": "#f2cfc2",
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, context2d(c)];
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** draws centred, auto-shrinking multi-line text; returns bottom y */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxW: number,
  maxH: number,
  size: number,
  weight = 700,
  color = "#3d2a1a",
  family = SERIF,
): number {
  let s = size;
  let lines: string[] = [];
  for (; s > 12; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    lines = wrap(ctx, text, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length * s * 1.12 <= maxH && widest <= maxW) break;
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * s * 1.12));
  return y + lines.length * s * 1.12;
}

function circleIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

type IconFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void;
const icons: Record<string, IconFn> = {
  station: (ctx, cx, cy, s) => {
    ctx.fillStyle = "#3b3550";
    ctx.beginPath();
    ctx.roundRect(cx - s * 0.5, cy - s * 0.42, s, s * 0.7, s * 0.14);
    ctx.fill();
    ctx.fillStyle = "#e8f1fb";
    ctx.fillRect(cx - s * 0.38, cy - s * 0.32, s * 0.32, s * 0.26);
    ctx.fillRect(cx + s * 0.06, cy - s * 0.32, s * 0.32, s * 0.26);
    ctx.fillStyle = "#f2a65a";
    circleIcon(ctx, cx - s * 0.28, cy + s * 0.14, s * 0.07, "#f2a65a");
    circleIcon(ctx, cx + s * 0.28, cy + s * 0.14, s * 0.07, "#f2a65a");
    ctx.strokeStyle = "#3b3550";
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy + s * 0.42);
    ctx.lineTo(cx + s * 0.6, cy + s * 0.42);
    ctx.stroke();
  },
  utility: (ctx, cx, cy, s) => {
    circleIcon(ctx, cx, cy - s * 0.1, s * 0.34, "#ffd36b");
    ctx.fillStyle = "#6f6a7d";
    ctx.fillRect(cx - s * 0.16, cy + s * 0.22, s * 0.32, s * 0.2);
    ctx.strokeStyle = "#c68a1b";
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.1, cy + s * 0.1);
    ctx.lineTo(cx + s * 0.04, cy - s * 0.12);
    ctx.lineTo(cx - s * 0.04, cy - s * 0.12);
    ctx.lineTo(cx + s * 0.1, cy - s * 0.32);
    ctx.stroke();
  },
  chance: (ctx, cx, cy, s) => {
    circleIcon(ctx, cx, cy, s * 0.5, "#f08a4b");
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${s * 0.85}px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", cx, cy + s * 0.04);
  },
  community: (ctx, cx, cy, s) => {
    ctx.fillStyle = "#4e86b3";
    ctx.beginPath();
    ctx.roundRect(cx - s * 0.5, cy - s * 0.18, s, s * 0.62, s * 0.08);
    ctx.fill();
    ctx.fillStyle = "#6aa3cf";
    ctx.beginPath();
    ctx.roundRect(cx - s * 0.5, cy - s * 0.42, s, s * 0.3, s * 0.15);
    ctx.fill();
    circleIcon(ctx, cx, cy + s * 0.02, s * 0.1, "#ffd36b");
  },
  tax: (ctx, cx, cy, s) => {
    circleIcon(ctx, cx, cy, s * 0.5, "#b9a58a");
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${s * 0.7}px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("%", cx, cy + s * 0.04);
  },
};

function drawNormal(def: TileDef, theme: Theme): HTMLCanvasElement {
  const W = 192,
    H = 384;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = BASE[def.kind] ?? "#f8f1e3";
  ctx.fillRect(0, 0, W, H);
  // subtle inner frame
  ctx.strokeStyle = "rgba(120,85,45,0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  const name = theme.tileNames[def.index] ?? t("tile.fallback", { n: def.index });
  if (def.kind === "street") {
    ctx.fillStyle = theme.groupColors[def.group ?? 0] ?? "#999";
    ctx.fillRect(4, 4, W - 8, 92);
    const g = ctx.createLinearGradient(0, 4, 0, 96);
    g.addColorStop(0, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0.08)");
    ctx.fillStyle = g;
    ctx.fillRect(4, 4, W - 8, 92);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, 96);
    ctx.lineTo(W - 4, 96);
    ctx.stroke();
  }
  const y = 112;
  const iconFn = icons[def.kind];
  if (iconFn) iconFn(ctx, W / 2, 62, 74);
  const bottom = fitText(ctx, name, W / 2, y, W - 24, 118, 32);
  void bottom;
  if (def.price) {
    ctx.fillStyle = "#3d2a1a";
    ctx.font = `600 28px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(formatMoney(theme, def.price), W / 2, H - 22);
  } else if (def.kind === "tax" && def.taxAmount) {
    ctx.fillStyle = "#7a2e2e";
    ctx.font = `600 28px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t("canvas.pay", { amount: formatMoney(theme, def.taxAmount) }), W / 2, H - 22);
  }
  return c;
}

function drawCorner(def: TileDef, theme: Theme): HTMLCanvasElement {
  const S = 384;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = BASE[def.kind] ?? "#f8f1e3";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "rgba(120,85,45,0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  const name = theme.tileNames[def.index] ?? "";
  ctx.save();
  // corners are drawn diagonally like the classic board: rotate toward the board centre
  ctx.translate(S / 2, S / 2);
  if (def.kind === "go") {
    ctx.fillStyle = "#e8734a";
    ctx.beginPath();
    ctx.moveTo(-120, 30);
    ctx.lineTo(60, 30);
    ctx.lineTo(60, 80);
    ctx.lineTo(140, 0);
    ctx.lineTo(60, -80);
    ctx.lineTo(60, -30);
    ctx.lineTo(-120, -30);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(0);
  }
  ctx.restore();
  if (def.kind === "jail") {
    ctx.fillStyle = "#f0b86a";
    ctx.fillRect(60, 60, 160, 160);
    ctx.strokeStyle = "#3b3550";
    ctx.lineWidth = 8;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(80 + i * 30, 60);
      ctx.lineTo(80 + i * 30, 220);
      ctx.stroke();
    }
    ctx.strokeRect(60, 60, 160, 160);
    ctx.fillStyle = "#3b3550";
    ctx.font = `600 22px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t("canvas.visitOnly"), S - 90, 330);
  } else if (def.kind === "free-parking") {
    circleIcon(ctx, S / 2, 130, 70, "#5f9e6e");
    ctx.fillStyle = "#fff";
    ctx.font = `800 90px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("P", S / 2, 136);
  } else if (def.kind === "go-to-jail") {
    circleIcon(ctx, S / 2, 130, 70, "#d15b50");
    ctx.fillStyle = "#fff";
    ctx.font = `800 64px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", S / 2, 136);
  } else if (def.kind === "go") {
    ctx.fillStyle = "#e8734a";
    ctx.beginPath();
    ctx.moveTo(60, 190);
    ctx.lineTo(220, 190);
    ctx.lineTo(220, 240);
    ctx.lineTo(310, 160);
    ctx.lineTo(220, 80);
    ctx.lineTo(220, 130);
    ctx.lineTo(60, 130);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `800 54px ${SERIF}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(t("canvas.go"), 76, 162);
  }
  fitText(ctx, name, S / 2, def.kind === "go" ? 270 : 262, S - 60, 100, 44, 700);
  if (def.kind === "go") {
    ctx.fillStyle = "#3d2a1a";
    ctx.font = `600 22px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t("canvas.collect", { amount: formatMoney(theme, 200) }), S / 2, 360);
  }
  return c;
}

export function tileTexture(def: TileDef, theme: Theme): Texture {
  const corner = ["go", "jail", "free-parking", "go-to-jail"].includes(def.kind);
  const t = new CanvasTexture(corner ? drawCorner(def, theme) : drawNormal(def, theme));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Leave a margin on the 1024px title canvas so wide glyphs/fallback fonts are never clipped. */
const TITLE_MAX_WIDTH = 920;

export function titleTexture(theme: Theme): Texture {
  const [c, ctx] = canvas(1024, 512);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(61,42,26,0.9)";
  ctx.font = `900 200px ${SERIF}`;
  ctx.fillText("HOCHSTAPLER", 512, 190, TITLE_MAX_WIDTH);
  ctx.fillStyle = "rgba(61,42,26,0.6)";
  ctx.font = `500 76px ${SERIF}`;
  ctx.fillText(`${theme.flag}  ${themeText(theme, getLang()).name}`, 512, 350, TITLE_MAX_WIDTH);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function deckTexture(label: string, color: string): Texture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 228, 228);
  fitText(ctx, label.toUpperCase(), 128, 78, 200, 120, 44, 800, "#fff");
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
