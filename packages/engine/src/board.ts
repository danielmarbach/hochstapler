import { at } from "./guards.ts";
import type { TileDef, TileKind } from "./types.ts";

// Layout per docs/DESIGN.md §4. 'g<N>' = street of colour group N.
const LAYOUT: string[] = [
  "go",
  "g0",
  "community",
  "g0",
  "tax",
  "station",
  "g1",
  "chance",
  "g1",
  "g1",
  "g2",
  "g2",
  "g2",
  "jail",
  "g3",
  "utility",
  "g3",
  "g3",
  "g3",
  "station",
  "g4",
  "community",
  "g4",
  "g4",
  "chance",
  "g4",
  "free-parking",
  "g5",
  "chance",
  "g5",
  "g5",
  "g5",
  "station",
  "g6",
  "g6",
  "utility",
  "g6",
  "community",
  "g6",
  "go-to-jail",
  "g7",
  "g7",
  "utility",
  "g7",
  "station",
  "chance",
  "g8",
  "g8",
  "g8",
  "tax",
  "g9",
  "g9",
];

/** Street prices per group, in board order, and building cost per group. */
const GROUP_PRICES: number[][] = [
  [60, 60],
  [100, 100, 120],
  [140, 140, 160],
  [160, 180, 180, 200],
  [200, 220, 220, 240],
  [240, 260, 260, 280],
  [280, 300, 320, 340],
  [350, 360, 380],
  [400, 410, 430],
  [430, 450],
];
const GROUP_BUILD_COST = [50, 50, 75, 75, 100, 100, 125, 150, 175, 200];

function streetRent(price: number): number[] {
  const round = (n: number) => (n >= 25 ? Math.round(n / 5) * 5 : Math.round(n));
  const base = Math.max(2, Math.round(price * (0.03 + price * 0.00009)));
  const hotel = round(base * 125);
  return [
    base,
    round(base * 5),
    round(base * 15),
    round(base * 45),
    round(base * 80),
    hotel,
    round(hotel * 1.7),
  ];
}

function nextInGroup(counters: number[], group: number): number {
  const n = at(counters, group);
  counters[group] = n + 1;
  return n;
}

function build(): TileDef[] {
  const counters: number[] = Array(10).fill(0);
  return LAYOUT.map((k, index): TileDef => {
    if (/^g\d$/.test(k)) {
      const group = Number(k.slice(1));
      const price = at(at(GROUP_PRICES, group), nextInGroup(counters, group));
      return {
        index,
        kind: "street",
        group,
        price,
        rent: streetRent(price),
        buildCost: at(GROUP_BUILD_COST, group),
        mortgage: price / 2,
      };
    }
    const kind = k as TileKind;
    switch (kind) {
      case "station":
        return { index, kind, price: 200, rent: [25, 50, 100, 200], mortgage: 100 };
      case "utility":
        return { index, kind, price: 150, rent: [4, 10, 20], mortgage: 75 };
      case "tax":
        return { index, kind, taxAmount: index === 4 ? 200 : 100 };
      case "go":
      case "street":
      case "chance":
      case "community":
      case "jail":
      case "free-parking":
      case "go-to-jail":
        return { index, kind };
    }
  }).map((t) => (t.kind === "tax" && t.index === 49 ? { ...t, taxAmount: 100 } : t));
}

export const BOARD: TileDef[] = build();
