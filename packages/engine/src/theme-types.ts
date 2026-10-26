// Country theme contract. Themes are pure data; amounts are identical across themes.
import type { Lang } from "./i18n/lang.ts";
import type { SecuritySector } from "./types.ts";

/** A fictitious, tongue-in-cheek company of the securities mode (docs/DESIGN.md #48). */
export interface SecurityDef {
  /** stable id, e.g. "ch-pilatus"; key of the market prices */
  id: string;
  sector: SecuritySector;
  /** German base name */
  name: string;
  /** price at game start, integer >= 1 */
  startPrice: number;
  /** typical swing per round in percent (1-15): the random walk's size */
  volatility: number;
}

export interface ThemeToken {
  /** stable id, also the asset name: assets/models/token-<id>.glb */
  id: string;
  name: string;
}

/** Per-language overrides of the German base texts of a theme. Tile names stay local (decision #31). */
export interface ThemeTexts {
  /** country name */
  name?: string;
  /** exactly 10 names, same order as Theme.groupNames */
  groupNames?: string[];
  deckNames?: { chance: string; community: string };
  /** card id -> text (same amounts as the German text) */
  cardTexts?: Record<string, string>;
  /** token id -> name */
  tokenNames?: Record<string, string>;
  /** security id -> company name (only where a translation is natural; else the German name) */
  securityNames?: Record<string, string>;
}

export interface Theme {
  id: string; // 'ch' | 'fr' | 'de' | 'it' ...
  name: string; // "Schweiz"
  flag: string; // emoji
  locale: string; // 'de-CH'
  currency: { code: string; symbol: string; position: "before" | "after" };
  /** exactly BOARD_SIZE (52) names, indexed by tile index */
  tileNames: string[];
  /** 10 css colours for street groups 0..9 */
  groupColors: string[];
  /** 10 group names, e.g. "Graubünden" */
  groupNames: string[];
  /** text for every card id defined in engine/src/cards.ts */
  cardTexts: Record<string, string>;
  deckNames: { chance: string; community: string };
  /** ≥ 8 country-flavoured names for bot seats (unique per theme, ≤ 24 chars) */
  botNames: string[];
  /** 6-8 themed tokens */
  tokens: ThemeToken[];
  /** 3D environment key used by the client scene, e.g. 'alps' | 'paris' | 'berlin' | 'tuscany' */
  environment: string;
  /** asset name of the landmark shown in the middle of the board, e.g. 'landmark-matterhorn' */
  landmark: string;
  /** optional per-group skyscraper asset name (fallback: generic skyscraper) */
  skyscraperModels?: Record<number, string>;
  /** 6 companies for the securities mode */
  securities: SecurityDef[];
  /** colour groups whose construction boosts tourism securities (e.g. mountains, coast) */
  scenicGroups: number[];
  /** texts per language; missing languages/fields fall back to the German base fields (see themeText) */
  i18n?: Partial<Record<Lang, ThemeTexts>>;
}
