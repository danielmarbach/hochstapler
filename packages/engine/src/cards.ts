// Card definitions: ids + effects. Themes provide texts per id (Theme.cardTexts).

export type CardEffect =
  | { kind: "move-to"; tile: number; collectGo: boolean }
  | { kind: "move-by"; steps: number }
  | { kind: "nearest"; target: "station" | "utility"; rentMultiplier: number }
  | { kind: "cash"; amount: number }
  | { kind: "cash-from-each"; amount: number }
  | { kind: "cash-to-each"; amount: number }
  | { kind: "repairs"; perHouse: number; perHotel: number; perSkyscraper: number }
  | { kind: "go-to-jail" }
  | { kind: "jail-card" };

export interface CardDef {
  id: string;
  deck: "chance" | "community";
  effect: CardEffect;
}

export const CARDS: CardDef[] = [
  // ---- chance deck, "Postkarte" (16) ----
  { id: "ch-go", deck: "chance", effect: { kind: "move-to", tile: 0, collectGo: true } },
  { id: "ch-g9-last", deck: "chance", effect: { kind: "move-to", tile: 51, collectGo: true } },
  { id: "ch-g6-first", deck: "chance", effect: { kind: "move-to", tile: 33, collectGo: true } },
  { id: "ch-g3-first", deck: "chance", effect: { kind: "move-to", tile: 14, collectGo: true } },
  { id: "ch-station-1", deck: "chance", effect: { kind: "move-to", tile: 5, collectGo: true } },
  {
    id: "ch-nearest-station",
    deck: "chance",
    effect: { kind: "nearest", target: "station", rentMultiplier: 2 },
  },
  {
    id: "ch-nearest-station-2",
    deck: "chance",
    effect: { kind: "nearest", target: "station", rentMultiplier: 2 },
  },
  {
    id: "ch-nearest-utility",
    deck: "chance",
    effect: { kind: "nearest", target: "utility", rentMultiplier: 10 },
  },
  { id: "ch-back-3", deck: "chance", effect: { kind: "move-by", steps: -3 } },
  { id: "ch-jail", deck: "chance", effect: { kind: "go-to-jail" } },
  { id: "ch-jail-card", deck: "chance", effect: { kind: "jail-card" } },
  { id: "ch-dividend", deck: "chance", effect: { kind: "cash", amount: 50 } },
  { id: "ch-loan", deck: "chance", effect: { kind: "cash", amount: 150 } },
  { id: "ch-speeding", deck: "chance", effect: { kind: "cash", amount: -15 } },
  { id: "ch-chairman", deck: "chance", effect: { kind: "cash-to-each", amount: 50 } },
  {
    id: "ch-repairs",
    deck: "chance",
    effect: { kind: "repairs", perHouse: 25, perHotel: 100, perSkyscraper: 200 },
  },
  // ---- community deck, per theme canton / Bundesland / mairie / comune (16) ----
  { id: "cc-go", deck: "community", effect: { kind: "move-to", tile: 0, collectGo: true } },
  { id: "cc-bank-error", deck: "community", effect: { kind: "cash", amount: 200 } },
  { id: "cc-doctor", deck: "community", effect: { kind: "cash", amount: -50 } },
  { id: "cc-stock", deck: "community", effect: { kind: "cash", amount: 50 } },
  { id: "cc-jail-card", deck: "community", effect: { kind: "jail-card" } },
  { id: "cc-jail", deck: "community", effect: { kind: "go-to-jail" } },
  { id: "cc-holiday", deck: "community", effect: { kind: "cash", amount: 100 } },
  { id: "cc-tax-refund", deck: "community", effect: { kind: "cash", amount: 20 } },
  { id: "cc-birthday", deck: "community", effect: { kind: "cash-from-each", amount: 10 } },
  { id: "cc-insurance", deck: "community", effect: { kind: "cash", amount: 100 } },
  { id: "cc-hospital", deck: "community", effect: { kind: "cash", amount: -100 } },
  { id: "cc-school", deck: "community", effect: { kind: "cash", amount: -50 } },
  { id: "cc-consultancy", deck: "community", effect: { kind: "cash", amount: 25 } },
  {
    id: "cc-street-repairs",
    deck: "community",
    effect: { kind: "repairs", perHouse: 40, perHotel: 115, perSkyscraper: 250 },
  },
  { id: "cc-beauty", deck: "community", effect: { kind: "cash", amount: 10 } },
  { id: "cc-inherit", deck: "community", effect: { kind: "cash", amount: 100 } },
];
