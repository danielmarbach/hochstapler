// L-4 (docs/DESIGN.md #61): a host cannot make a game all-bot within seconds.
import { describe, expect, it } from "vitest";
import {
  CreateGameRequestSchema,
  GameSettingsSchema,
  MIN_AWAY_AFTER_MISSED_TURNS,
  MIN_TURN_TIMEOUT_SEC,
  PartialGameSettingsSchema,
  clampSettingsFloors,
} from "../src/schemas.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";

describe("settings floors", () => {
  it("the defaults satisfy the floors", () => {
    expect(DEFAULT_SETTINGS.turnTimeoutSec).toBeGreaterThanOrEqual(MIN_TURN_TIMEOUT_SEC);
    expect(DEFAULT_SETTINGS.awayAfterMissedTurns).toBeGreaterThanOrEqual(
      MIN_AWAY_AFTER_MISSED_TURNS,
    );
  });

  it("accepts off (0) and anything from the floor up", () => {
    for (const v of [0, 30, 31, 60, 86_400]) {
      expect(PartialGameSettingsSchema.safeParse({ turnTimeoutSec: v }).success).toBe(true);
    }
    for (const v of [2, 3, 10]) {
      expect(PartialGameSettingsSchema.safeParse({ awayAfterMissedTurns: v }).success).toBe(true);
    }
  });

  it("rejects 1..29 seconds and fewer than 2 missed turns in API input", () => {
    for (const v of [1, 5, 29, -1]) {
      expect(PartialGameSettingsSchema.safeParse({ turnTimeoutSec: v }).success).toBe(false);
    }
    for (const v of [0, 1]) {
      expect(PartialGameSettingsSchema.safeParse({ awayAfterMissedTurns: v }).success).toBe(false);
    }
    const create = CreateGameRequestSchema.safeParse({
      hostName: "A",
      settings: { turnTimeoutSec: 1 },
      bots: [],
      maxPlayers: 2,
    });
    expect(create.success).toBe(false);
  });

  it("stored settings stay loadable (lenient) and are clamped on load", () => {
    const old = { ...DEFAULT_SETTINGS, turnTimeoutSec: 1, awayAfterMissedTurns: 1 };
    expect(GameSettingsSchema.safeParse(old).success).toBe(true);
    const clamped = clampSettingsFloors(old);
    expect(clamped.turnTimeoutSec).toBe(MIN_TURN_TIMEOUT_SEC);
    expect(clamped.awayAfterMissedTurns).toBe(MIN_AWAY_AFTER_MISSED_TURNS);
    // off stays off, valid values stay
    expect(clampSettingsFloors({ ...old, turnTimeoutSec: 0 }).turnTimeoutSec).toBe(0);
    expect(
      clampSettingsFloors({ ...old, turnTimeoutSec: 90, awayAfterMissedTurns: 4 }),
    ).toMatchObject({
      turnTimeoutSec: 90,
      awayAfterMissedTurns: 4,
    });
  });
});
