// Message formatting: typed placeholders, parameter kinds and the resolver used to render
// player ids / tile indices / money in a given language.
import type { de } from "./de.ts";

export type EngineMsgKey = keyof typeof de;

/** Shape every language catalogue must have (`satisfies EngineMessages`). */
export type EngineMessages = Record<EngineMsgKey, string>;

/** Placeholder names of a template string, e.g. "{a} und {b}" -> "a" | "b". */
export type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;

export type MsgParamName<K extends EngineMsgKey = EngineMsgKey> = Placeholders<(typeof de)[K]>;

/** Required parameters of a message key (derived from the German template). */
export type MsgParams<K extends EngineMsgKey> = {
  [P in MsgParamName<K>]: string | number;
};

/** Rest-parameter tuple: no argument for keys without placeholders, otherwise the params object. */
export type MsgArgs<K extends EngineMsgKey> = [MsgParamName<K>] extends [never]
  ? []
  : [params: MsgParams<K>];

export type MsgParamValues = Record<string, string | number>;

/** Structured, language-neutral message. */
export interface EngineMsg {
  key: EngineMsgKey;
  params: MsgParamValues;
}

/**
 * How a placeholder is rendered:
 *  player = player id -> name, tile = tile index -> themed name, money = number with thousands
 *  separators, number = plain number, card = card id (resolved by the client), text = verbatim.
 */
export type ParamKind = "player" | "tile" | "money" | "number" | "card" | "security" | "text";

type AllParamNames = MsgParamName;

/** Kind per placeholder name. Missing entries are a compile error (every placeholder is covered). */
export const PARAM_KINDS = {
  player: "player",
  owner: "player",
  target: "player",
  tile: "tile",
  amount: "money",
  was: "money",
  a: "number",
  b: "number",
  level: "number",
  min: "number",
  max: "number",
  card: "card",
  security: "security",
  shares: "number",
  pct: "number",
  rounds: "number",
  text: "text",
  what: "text",
  action: "text",
} as const satisfies Record<AllParamNames, ParamKind>;

/** Turns ids and indices into display text. Everything is optional; defaults are language-neutral. */
export interface MsgResolver {
  player?: (id: string) => string;
  tile?: (index: number) => string;
  money?: (amount: number) => string;
  card?: (id: string) => string;
  /** security id -> company name */
  security?: (id: string) => string;
}

/** 1250 -> 1'250 (Swiss grouping, no currency symbol). */
export function groupDigits(n: number): string {
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed lookahead over a number's digits, no user text
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

export function makeMsg<K extends EngineMsgKey>(key: K, ...args: MsgArgs<K>): EngineMsg {
  const params: MsgParamValues = args[0] ?? {};
  return { key, params };
}

function isParamName(name: string): name is keyof typeof PARAM_KINDS {
  return name in PARAM_KINDS;
}

function renderParam(kind: ParamKind, value: string | number, resolve: MsgResolver): string {
  switch (kind) {
    case "player":
      return resolve.player ? resolve.player(String(value)) : String(value);
    case "tile":
      return resolve.tile ? resolve.tile(Number(value)) : `#${value}`;
    case "money":
      return resolve.money ? resolve.money(Number(value)) : groupDigits(Number(value));
    case "card":
      return resolve.card ? resolve.card(String(value)) : String(value);
    case "security":
      return resolve.security ? resolve.security(String(value)) : String(value);
    case "number":
    case "text":
      return String(value);
  }
}

/** Fills `{name}` placeholders of `template`. Unknown or missing params stay untouched. */
export function fillTemplate(
  template: string,
  params: MsgParamValues,
  resolve: MsgResolver = {},
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined || !isParamName(name)) {
      return whole;
    }
    return renderParam(PARAM_KINDS[name], value, resolve);
  });
}
