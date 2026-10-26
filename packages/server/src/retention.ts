// Data retention (docs/DESIGN.md #57): how long inactive games live and how much of the action log is kept.
import { z } from "zod";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionConfig {
  /** a lobby that never started */
  lobbyDays: number;
  finishedDays: number;
  /** running game without human activity */
  runningDays: number;
  /** newest actions kept per game (traceability only; games load from the snapshot) */
  actionLogKeep: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  lobbyDays: 2,
  finishedDays: 30,
  runningDays: 60,
  actionLogKeep: 2000,
};

/** Unset or empty means "default"; anything else must be a positive integer within sane bounds. */
const positive = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(1).max(max).optional(),
  );

const RetentionEnvSchema = z.object({
  GAME_TTL_LOBBY_DAYS: positive(3650),
  GAME_TTL_FINISHED_DAYS: positive(3650),
  GAME_TTL_RUNNING_DAYS: positive(3650),
  ACTION_LOG_KEEP: positive(1_000_000),
});

/** GAME_TTL_LOBBY_DAYS / GAME_TTL_FINISHED_DAYS / GAME_TTL_RUNNING_DAYS / ACTION_LOG_KEEP; invalid values abort the start. */
export function loadRetention(env: NodeJS.ProcessEnv): RetentionConfig {
  const e = RetentionEnvSchema.parse(env);
  return {
    lobbyDays: e.GAME_TTL_LOBBY_DAYS ?? DEFAULT_RETENTION.lobbyDays,
    finishedDays: e.GAME_TTL_FINISHED_DAYS ?? DEFAULT_RETENTION.finishedDays,
    runningDays: e.GAME_TTL_RUNNING_DAYS ?? DEFAULT_RETENTION.runningDays,
    actionLogKeep: e.ACTION_LOG_KEEP ?? DEFAULT_RETENTION.actionLogKeep,
  };
}

export interface ExpiryPolicy {
  lobbyMs: number;
  finishedMs: number;
  runningMs: number;
}

export const expiryPolicy = (c: RetentionConfig): ExpiryPolicy => ({
  lobbyMs: c.lobbyDays * DAY_MS,
  finishedMs: c.finishedDays * DAY_MS,
  runningMs: c.runningDays * DAY_MS,
});
