// Game-state migrations (docs/DESIGN.md #43). The server stores GameState as JSON in games.state_json
// together with the shape version in games.state_version. When the shape changes:
//   1. bump CURRENT_STATE_VERSION and append ONE pure step `vN -> vN+1` to STATE_STEPS,
//   2. add a fixture `packages/server/test/fixtures/state-v<N+1>-*.json` (README "Datenbank & Migrationen").
// Steps work on untyped JSON (the old shape is not a TypeScript type any more), must not mutate their
// input and must be deterministic. migrateState validates the final result with GameStateSchema, so a
// forgotten or wrong step surfaces as an error (and in CI via the fixture guard test), never as a
// silently broken game.
import { GameStateSchema } from "./state-schema.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import type { GameState } from "./types.ts";

/**
 * Version 1 = the shape before versioning existed (all games created up to this point).
 * Version 2 = securities mode: settings.securities / securitiesLockRounds (docs/DESIGN.md #48).
 * Version 3 = securities dividends: settings.securitiesDividends (docs/DESIGN.md #83).
 * Version 4 = show-off mode (bank loans): settings.loans (docs/DESIGN.md #93).
 */
export const CURRENT_STATE_VERSION = 4;

/** Pure transformation of the stored JSON from one state version to the next. */
export type StateMigrationStep = (json: unknown) => unknown;

export interface StateMigrationChain {
  /** version the final result must have */
  current: number;
  /** steps[i] migrates version i+1 to i+2, so steps.length === current - 1 */
  steps: readonly StateMigrationStep[];
}

/**
 * v1 -> v2: the securities settings did not exist; old games play without the mode (off, default
 * lock-up) and get no market.
 */
export const migrateV1toV2: StateMigrationStep = (json) => {
  const state = structuredClone(json);
  if (typeof state !== "object" || state === null || !("settings" in state)) {
    return state;
  }
  const settings: unknown = state.settings;
  if (typeof settings !== "object" || settings === null) {
    return state;
  }
  return {
    ...state,
    settings: {
      ...settings,
      securities: false,
      securitiesLockRounds: DEFAULT_SETTINGS.securitiesLockRounds,
    },
  };
};

/**
 * v2 -> v3: games that were already running keep their rules, so the dividends stay off (the
 * players never agreed to them); PlayerState.dividends is optional and needs no step.
 */
export const migrateV2toV3: StateMigrationStep = (json) => {
  const state = structuredClone(json);
  if (typeof state !== "object" || state === null || !("settings" in state)) {
    return state;
  }
  const settings: unknown = state.settings;
  if (typeof settings !== "object" || settings === null) {
    return state;
  }
  return { ...state, settings: { ...settings, securitiesDividends: false } };
};

/**
 * v3 -> v4: the show-off mode did not exist; running games keep their rules (no loans).
 * PlayerState.loans and the debt flag `loanInterest` are optional and need no step.
 */
export const migrateV3toV4: StateMigrationStep = (json) => {
  const state = structuredClone(json);
  if (typeof state !== "object" || state === null || !("settings" in state)) {
    return state;
  }
  const settings: unknown = state.settings;
  if (typeof settings !== "object" || settings === null) {
    return state;
  }
  return { ...state, settings: { ...settings, loans: false } };
};

/** Index i migrates v(i+1) -> v(i+2). */
const STATE_STEPS: readonly StateMigrationStep[] = [migrateV1toV2, migrateV2toV3, migrateV3toV4];

export const STATE_MIGRATION_CHAIN: StateMigrationChain = {
  current: CURRENT_STATE_VERSION,
  steps: STATE_STEPS,
};

export class StateMigrationError extends Error {
  readonly fromVersion: number;

  constructor(message: string, fromVersion: number) {
    super(message);
    this.name = "StateMigrationError";
    this.fromVersion = fromVersion;
  }
}

/**
 * Brings stored state JSON of any known version to the current shape and validates it.
 * Throws StateMigrationError for unknown/future versions and ZodError for invalid content.
 */
export function migrateState(
  json: unknown,
  fromVersion: number,
  chain: StateMigrationChain = STATE_MIGRATION_CHAIN,
): GameState {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new StateMigrationError(`unknown state version ${fromVersion}`, fromVersion);
  }
  if (fromVersion > chain.current) {
    throw new StateMigrationError(
      `state version ${fromVersion} is newer than this server understands (${chain.current})`,
      fromVersion,
    );
  }
  let current: unknown = json;
  for (let v = fromVersion; v < chain.current; v++) {
    const step = chain.steps[v - 1];
    if (!step) {
      throw new StateMigrationError(`missing state migration ${v} -> ${v + 1}`, fromVersion);
    }
    current = step(current);
  }
  return GameStateSchema.parse(current);
}
