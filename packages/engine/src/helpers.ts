// Pure helpers shared by engine, bots and client UI.
import { BOARD } from "./board.ts";
import { at, defined } from "./guards.ts";
import { formatMessage, makeMsg } from "./i18n/index.ts";
import type { EngineMsg } from "./i18n/index.ts";
import type {
  GameState,
  NetWorthBreakdown,
  PlayerId,
  PlayerResult,
  PlayerState,
  PropertyState,
  TileDef,
} from "./types.ts";
import { HOTEL_LEVEL, SKYSCRAPER_LEVEL } from "./types.ts";
import { holdingsLiquidation, holdingsValue } from "./securities.ts";

export const JAIL_FINE = 50;
/** Unmortgaging costs the mortgage value plus 10% interest. */
export const UNMORTGAGE_INTEREST = 1.1;
/** Highest building level that still consists of plain houses. */
const MAX_HOUSE_LEVEL = 4;
/** Skyscrapers cost this multiple of the street's build cost. */
const SKYSCRAPER_COST_MULTIPLIER = 2;
const SELL_RATIO = 0.5;

export const STATION_TILES: number[] = BOARD.filter((t) => t.kind === "station").map(
  (t) => t.index,
);
export const UTILITY_TILES: number[] = BOARD.filter((t) => t.kind === "utility").map(
  (t) => t.index,
);

const GROUPS: number[][] = (() => {
  const g: number[][] = [];
  for (const t of BOARD) {
    if (t.kind === "street" && t.group !== undefined) {
      (g[t.group] ??= []).push(t.index);
    }
  }
  return g;
})();

export function isBuyable(tile: number): boolean {
  const k = BOARD[tile]?.kind;
  return k === "street" || k === "station" || k === "utility";
}

/** Street tile indices of a colour group (0..9). */
export function groupTiles(group: number): number[] {
  return GROUPS[group] ?? [];
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function tileOwner(state: GameState, tile: number): PlayerId | null {
  return state.properties[tile]?.owner ?? null;
}

export function playerProperties(state: GameState, playerId: PlayerId): number[] {
  const out: number[] = [];
  for (const t of BOARD) {
    if (state.properties[t.index]?.owner === playerId) {
      out.push(t.index);
    }
  }
  return out;
}

/** True if the player owns every street of the group (mortgage status ignored). */
export function ownsGroup(state: GameState, playerId: PlayerId, group: number): boolean {
  return groupTiles(group).every((i) => state.properties[i]?.owner === playerId);
}

export function groupHasBuildings(state: GameState, group: number): boolean {
  return groupTiles(group).some((i) => (state.properties[i]?.level ?? 0) > 0);
}

export function groupHasMortgage(state: GameState, group: number): boolean {
  return groupTiles(group).some((i) => state.properties[i]?.mortgaged);
}

export function countOwned(
  state: GameState,
  playerId: PlayerId,
  kind: "station" | "utility",
): number {
  return (kind === "station" ? STATION_TILES : UTILITY_TILES).filter(
    (i) => state.properties[i]?.owner === playerId,
  ).length;
}

/** Cost of building up to `nextLevel` (skyscraper costs 2x). */
export function buildCostFor(tile: TileDef, nextLevel: number): number {
  const c = tile.buildCost ?? 0;
  return nextLevel >= SKYSCRAPER_LEVEL ? c * SKYSCRAPER_COST_MULTIPLIER : c;
}

/** Money received for selling the building at `level` (50% of its build cost). */
export function sellValue(tile: TileDef, level: number): number {
  return Math.floor(buildCostFor(tile, level) * SELL_RATIO);
}

/** Total money invested in buildings up to `level`. */
export function buildingsValue(tile: TileDef, level: number): number {
  let v = 0;
  for (let l = 1; l <= level; l++) {
    v += buildCostFor(tile, l);
  }
  return v;
}

export function unmortgageCost(tile: TileDef): number {
  // integer arithmetic: 100 * 1.1 is 110.00000000000001 in floating point and would round up to 111
  const m = tile.mortgage ?? 0;
  return m + Math.ceil(m / 10);
}

/**
 * What a player is worth: cash, the price of every property, buildings at build cost, minus the
 * mortgage debt of mortgaged properties (so a mortgaged property counts its mortgage value).
 */
export function netWorthBreakdown(state: GameState, playerId: PlayerId): NetWorthBreakdown {
  const p = getPlayer(state, playerId);
  if (!p || p.bankrupt) {
    return { cash: 0, properties: 0, buildings: 0, mortgages: 0, total: 0 };
  }
  let properties = 0;
  let buildings = 0;
  let mortgages = 0;
  for (const i of playerProperties(state, playerId)) {
    const def = tileDef(i);
    const pr = propState(state, i);
    properties += def.price ?? 0;
    buildings += buildingsValue(def, pr.level);
    if (pr.mortgaged) {
      mortgages -= def.mortgage ?? 0;
    }
  }
  // securities mode (docs/DESIGN.md #48): holdings count at the current market price
  const securities = state.market ? holdingsValue(state, playerId) : 0;
  // show-off mode (docs/DESIGN.md #93): open bank loans are debt
  const loans = 0 - (p.loans ?? []).reduce((sum, t) => sum + t.amount, 0);
  return {
    cash: p.cash,
    properties,
    buildings,
    mortgages,
    ...(state.market ? { securities } : {}),
    ...(state.settings.loans ? { loans } : {}),
    total: p.cash + properties + buildings + mortgages + securities + loans,
  };
}

/** Cash + property value (mortgage value if mortgaged) + invested building value + securities - loans. */
export function netWorth(state: GameState, playerId: PlayerId): number {
  return netWorthBreakdown(state, playerId).total;
}

/**
 * Final ranking, best first: active players by net worth, then more cash, then earlier seat;
 * bankrupt players follow in seat order.
 */
export function rankPlayers(state: GameState): PlayerResult[] {
  const rows = state.players.map((p, seat) => ({
    seat,
    bankrupt: p.bankrupt,
    id: p.id,
    worth: netWorthBreakdown(state, p.id),
  }));
  rows.sort(
    (a, b) =>
      Number(a.bankrupt) - Number(b.bankrupt) ||
      b.worth.total - a.worth.total ||
      b.worth.cash - a.worth.cash ||
      a.seat - b.seat,
  );
  return rows.map((r, i) => ({ playerId: r.id, rank: i + 1, bankrupt: r.bankrupt, ...r.worth }));
}

/** What the player could raise right now by selling all buildings and mortgaging everything. */
export function liquidationValue(state: GameState, playerId: PlayerId): number {
  const p = getPlayer(state, playerId);
  if (!p) {
    return 0;
  }
  let w = p.cash;
  for (const i of playerProperties(state, playerId)) {
    const def = tileDef(i);
    const pr = propState(state, i);
    for (let l = 1; l <= pr.level; l++) {
      w += sellValue(def, l);
    }
    if (!pr.mortgaged) {
      w += def.mortgage ?? 0;
    }
  }
  // securities can be sold in debt (locked lots with the emergency discount)
  return w + holdingsLiquidation(state, playerId);
}

/**
 * Highest bid `playerId` may place in the running auction: what they could raise (cash,
 * mortgages, building sales) plus the mortgage value of the auctioned tile itself. Bidding
 * above cash is allowed as in the classic board game; a winner short of cash must then raise the money.
 */
export function maxBid(state: GameState, playerId: PlayerId): number {
  const ph = state.phase;
  const p = getPlayer(state, playerId);
  if (ph.type !== "auction" || !p || p.bankrupt) {
    return 0;
  }
  return liquidationValue(state, playerId) + (tileDef(ph.auction.tile).mortgage ?? 0);
}

export interface RentOptions {
  /** multiply station rent (card) */
  stationMultiplier?: number;
  /** utility: use this multiplier instead of the owned-count one (card) */
  utilityMultiplier?: number;
}

/** Rent due when landing on `tile`. 0 if unowned, mortgaged or not rentable. */
export function rentFor(
  state: GameState,
  tile: number,
  diceTotal: number,
  opts: RentOptions = {},
): number {
  const def = BOARD[tile];
  const pr = state.properties[tile];
  if (!def || !pr || !pr.owner || pr.mortgaged) {
    return 0;
  }
  const owner = pr.owner;
  switch (def.kind) {
    case "street": {
      const rent = rentTableOf(def);
      if (pr.level > 0) {
        return at(rent, pr.level);
      }
      return ownsGroup(state, owner, groupIndexOf(def)) ? at(rent, 0) * 2 : at(rent, 0);
    }
    case "station": {
      const n = countOwned(state, owner, "station");
      return at(rentTableOf(def), Math.max(0, n - 1)) * (opts.stationMultiplier ?? 1);
    }
    case "utility": {
      const n = countOwned(state, owner, "utility");
      const mult = opts.utilityMultiplier ?? at(rentTableOf(def), Math.max(0, n - 1));
      return mult * diceTotal;
    }
    case "go":
    case "chance":
    case "community":
    case "tax":
    case "jail":
    case "free-parking":
    case "go-to-jail":
      return 0;
  }
}

// ---- building rules ----

/** Reason (structured, language-neutral) why `playerId` cannot build on `tile` right now (ignoring turn phase), or null if allowed. */
export function buildBlockerMsg(
  state: GameState,
  playerId: PlayerId,
  tile: number,
): EngineMsg | null {
  const def = BOARD[tile];
  const pr = state.properties[tile];
  const p = getPlayer(state, playerId);
  if (!def || def.kind !== "street" || !pr || !p) {
    return makeMsg("block.noStreet");
  }
  if (pr.owner !== playerId) {
    return makeMsg("block.notOwner");
  }
  const group = groupIndexOf(def);
  if (!ownsGroup(state, playerId, group)) {
    return makeMsg("block.needFullGroup");
  }
  if (groupHasMortgage(state, group)) {
    return makeMsg("block.groupMortgaged");
  }
  if (pr.level >= SKYSCRAPER_LEVEL) {
    return makeMsg("block.alreadySkyscraper");
  }
  const next = pr.level + 1;
  const levels = groupTiles(group).map((i) => propState(state, i).level);
  if (next === SKYSCRAPER_LEVEL) {
    if (levels.some((l) => l < HOTEL_LEVEL)) {
      return makeMsg("block.needHotels");
    }
  } else if (state.settings.evenBuild && pr.level > Math.min(...levels)) {
    return makeMsg("block.buildEvenly");
  }
  if (next === SKYSCRAPER_LEVEL && state.settings.evenBuild && pr.level > Math.min(...levels)) {
    return makeMsg("block.buildEvenly");
  }
  if (next <= MAX_HOUSE_LEVEL && state.bank.houses < 1) {
    return makeMsg("block.noHouses");
  }
  if (next === HOTEL_LEVEL && state.bank.hotels < 1) {
    return makeMsg("block.noHotels");
  }
  if (next === SKYSCRAPER_LEVEL && state.bank.skyscrapers < 1) {
    return makeMsg("block.noSkyscrapers");
  }
  if (p.cash < buildCostFor(def, next)) {
    return makeMsg("err.notEnoughCash");
  }
  return null;
}

export function canBuild(state: GameState, playerId: PlayerId, tile: number): boolean {
  return buildBlockerMsg(state, playerId, tile) === null;
}

export function sellBlockerMsg(
  state: GameState,
  playerId: PlayerId,
  tile: number,
): EngineMsg | null {
  const def = BOARD[tile];
  const pr = state.properties[tile];
  if (!def || def.kind !== "street" || !pr) {
    return makeMsg("block.noStreet");
  }
  if (pr.owner !== playerId) {
    return makeMsg("block.notOwner");
  }
  if (pr.level < 1) {
    return makeMsg("block.noBuildings");
  }
  const levels = groupTiles(groupIndexOf(def)).map((i) => propState(state, i).level);
  if (state.settings.evenBuild && pr.level < Math.max(...levels)) {
    return makeMsg("block.sellEvenly");
  }
  // a skyscraper needs a hotel on every street of the group, also when even build is off
  if (pr.level === HOTEL_LEVEL && levels.some((l) => l === SKYSCRAPER_LEVEL)) {
    return makeMsg("block.sellSkyscraperFirst");
  }
  if (pr.level === HOTEL_LEVEL && state.bank.houses < MAX_HOUSE_LEVEL) {
    return makeMsg("block.notEnoughHousesInBank");
  }
  if (pr.level === SKYSCRAPER_LEVEL && state.bank.hotels < 1) {
    return makeMsg("block.noHotelInBank");
  }
  return null;
}

export function canSellBuilding(state: GameState, playerId: PlayerId, tile: number): boolean {
  return sellBlockerMsg(state, playerId, tile) === null;
}

export function mortgageBlockerMsg(
  state: GameState,
  playerId: PlayerId,
  tile: number,
): EngineMsg | null {
  const def = BOARD[tile];
  const pr = state.properties[tile];
  if (!def || !pr || !isBuyable(tile)) {
    return makeMsg("block.notMortgageable");
  }
  if (pr.owner !== playerId) {
    return makeMsg("block.notOwner");
  }
  if (pr.mortgaged) {
    return makeMsg("block.alreadyMortgaged");
  }
  if (def.kind === "street" && groupHasBuildings(state, groupIndexOf(def))) {
    return makeMsg("block.sellBuildingsFirst");
  }
  return null;
}

export function canMortgage(state: GameState, playerId: PlayerId, tile: number): boolean {
  return mortgageBlockerMsg(state, playerId, tile) === null;
}

export function unmortgageBlockerMsg(
  state: GameState,
  playerId: PlayerId,
  tile: number,
): EngineMsg | null {
  const def = BOARD[tile];
  const pr = state.properties[tile];
  const p = getPlayer(state, playerId);
  if (!def || !pr || !p || !isBuyable(tile)) {
    return makeMsg("block.notPossible");
  }
  if (pr.owner !== playerId) {
    return makeMsg("block.notOwner");
  }
  if (!pr.mortgaged) {
    return makeMsg("block.notMortgaged");
  }
  if (p.cash < unmortgageCost(def)) {
    return makeMsg("err.notEnoughCash");
  }
  return null;
}

export function canUnmortgage(state: GameState, playerId: PlayerId, tile: number): boolean {
  return unmortgageBlockerMsg(state, playerId, tile) === null;
}

const germanOrNull = (m: EngineMsg | null): string | null => (m ? formatMessage("de", m) : null);

/** German text of buildBlockerMsg (legacy string API). */
export function buildBlocker(state: GameState, playerId: PlayerId, tile: number): string | null {
  return germanOrNull(buildBlockerMsg(state, playerId, tile));
}

/** German text of sellBlockerMsg (legacy string API). */
export function sellBlocker(state: GameState, playerId: PlayerId, tile: number): string | null {
  return germanOrNull(sellBlockerMsg(state, playerId, tile));
}

/** German text of mortgageBlockerMsg (legacy string API). */
export function mortgageBlocker(state: GameState, playerId: PlayerId, tile: number): string | null {
  return germanOrNull(mortgageBlockerMsg(state, playerId, tile));
}

/** German text of unmortgageBlockerMsg (legacy string API). */
export function unmortgageBlocker(
  state: GameState,
  playerId: PlayerId,
  tile: number,
): string | null {
  return germanOrNull(unmortgageBlockerMsg(state, playerId, tile));
}

/** Swiss-style number formatting: 1'250. Currency symbol placed per theme. */
export function formatMoney(
  theme: { currency: { symbol: string; position: "before" | "after" } },
  n: number,
): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n))
    .toString()
    // eslint-disable-next-line security/detect-unsafe-regex -- fixed lookahead over a number's digits (<= 16), no user text
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const body =
    theme.currency.position === "before"
      ? `${theme.currency.symbol} ${s}`
      : `${s} ${theme.currency.symbol}`;
  return neg ? `-${body}` : body;
}

// ---- guarded accessors (throw GameError instead of using non-null assertions) ----

/** Board tile definition; throws on an invalid index. */
export function tileDef(index: number): TileDef {
  return at(BOARD, index, "Feld");
}

/** Ownership/building state of a tile; throws on an invalid index. */
export function propState(state: Pick<GameState, "properties">, index: number): PropertyState {
  return at(state.properties, index, "Eigentum");
}

export function priceOf(def: TileDef): number {
  return defined(def.price, `Price of square ${def.index}`);
}

export function mortgageOf(def: TileDef): number {
  return defined(def.mortgage, `Mortgage of square ${def.index}`);
}

export function groupIndexOf(def: TileDef): number {
  return defined(def.group, `Group of square ${def.index}`);
}

export function rentTableOf(def: TileDef): number[] {
  return defined(def.rent, `Rent of square ${def.index}`);
}
