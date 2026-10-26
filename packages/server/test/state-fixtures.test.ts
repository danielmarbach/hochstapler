// Safety net for stored games (docs/DESIGN.md #43). Fixtures are anonymised copies of real games,
// frozen at the state version they were written with. They must keep loading forever.
//
// THE RULE: every fixture of every past version must migrate to a state that passes the CURRENT
// schema. Adding a required field to GameState (or tightening the schema) without a migration step
// makes the guard test below red, long before a real multi-day game would be lost.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_STATE_VERSION,
  GameStateSchema,
  StoredLobbySchema,
  applyBotAction,
  chooseBotAction,
  handleTimeout,
  migrateState,
  whoMustAct,
} from "@poly/engine";
import type { GameState } from "@poly/engine";
import { assertInvariants } from "../../engine/test/invariants.ts";

const DIR = join(import.meta.dirname, "fixtures");
const json = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));

interface StateFixture {
  name: string;
  version: number;
  kind: string;
}
const stateFixtures: StateFixture[] = readdirSync(DIR)
  .flatMap((name) => {
    const m = /^state-v(\d+)-(.+)\.json$/.exec(name);
    return m ? [{ name, version: Number(m[1]), kind: m[2]! }] : [];
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const lobbyFixtures = readdirSync(DIR).filter((n) => /^lobby-v\d+-.+\.json$/.test(n));

describe("fixture inventory", () => {
  it("has a fixture for every state version up to the current one (add one when you bump it)", () => {
    const have = new Set(stateFixtures.map((f) => f.version));
    for (let v = 1; v <= CURRENT_STATE_VERSION; v++) {
      expect(have.has(v), `no packages/server/test/fixtures/state-v${v}-*.json`).toBe(true);
    }
    expect(Math.max(...have)).toBeLessThanOrEqual(CURRENT_STATE_VERSION);
  });

  it("covers a running mid-game and a finished game", () => {
    const kinds = stateFixtures.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["running", "finished"]));
  });
});

describe("GUARD: every fixture of every past version migrates to the current schema", () => {
  for (const f of stateFixtures) {
    it(`${f.name} (v${f.version}) -> v${CURRENT_STATE_VERSION}`, () => {
      const migrated = migrateState(json(f.name), f.version);
      expect(GameStateSchema.safeParse(migrated).success).toBe(true);
    });
  }

  for (const name of lobbyFixtures) {
    it(`${name} passes the current lobby schema`, () => {
      expect(StoredLobbySchema.safeParse(json(name)).success).toBe(true);
    });
  }

  it("fails (red) when the schema gains a required field that no migration provides", () => {
    // Scratch simulation of what a developer would do wrong: require a new field without a step.
    const stricter = GameStateSchema.extend({ endVote: GameStateSchema.shape.rng });
    for (const f of stateFixtures) {
      expect(stricter.safeParse(migrateState(json(f.name), f.version)).success).toBe(false);
    }
  });
});

describe("migrated fixtures are real, playable games", () => {
  for (const f of stateFixtures) {
    it(`${f.name}: invariants hold and the game continues`, () => {
      let s: GameState = migrateState(json(f.name), f.version);
      assertInvariants(s, { legacyLog: true });
      if (s.status === "finished") {
        expect(s.phase.type).toBe("game-over");
        return;
      }
      let now = Math.max(s.deadline ?? 0, s.log.at(-1)?.at ?? 0) + 1;
      const start = s.version;
      for (let i = 0; i < 40 && s.status === "running"; i++) {
        now += 1000;
        const pid = whoMustAct(s)[0];
        const action = pid ? chooseBotAction(s, pid) : null;
        const r = pid && action ? applyBotAction(s, pid, action, now) : handleTimeout(s, now);
        s = r.state;
        assertInvariants(s, { lastNow: now, legacyLog: true });
        expect(GameStateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
      }
      expect(s.version).toBeGreaterThan(start);
    });
  }
});

describe("chat controls (stored lobby, docs/DESIGN.md #69)", () => {
  it("lobbies stored before the controls existed load with free chat and nobody muted", () => {
    for (const name of lobbyFixtures.filter((n) => !n.startsWith("lobby-v3"))) {
      const lobby = StoredLobbySchema.parse(json(name));
      expect(lobby.chat, name).toEqual({ mode: "free", muted: [] });
    }
  });

  it("keeps the host's choice when it is stored", () => {
    const lobby = StoredLobbySchema.parse(json("lobby-v3-chat.json"));
    expect(lobby.chat).toEqual({ mode: "quick", muted: ["p2"] });
  });

  it("refuses an unknown mode or too many muted players", () => {
    const base = json("lobby-v3-chat.json") as Record<string, unknown>;
    expect(
      StoredLobbySchema.safeParse({ ...base, chat: { mode: "loud", muted: [] } }).success,
    ).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => `p${i + 1}`);
    expect(
      StoredLobbySchema.safeParse({ ...base, chat: { mode: "free", muted: nine } }).success,
    ).toBe(false);
  });
});

describe("securities mode (state v2, docs/DESIGN.md #48)", () => {
  it("v1 fixtures migrate with the mode off, the default lock-up and no market", () => {
    for (const f of stateFixtures.filter((x) => x.version === 1)) {
      const s = migrateState(json(f.name), 1);
      expect(s.settings.securities, f.name).toBe(false);
      expect(s.settings.securitiesLockRounds, f.name).toBe(3);
      expect(s.market, f.name).toBeUndefined();
    }
  });

  it("the v2 securities fixtures carry a market and portfolios", () => {
    const running = migrateState(json("state-v2-running.json"), 2);
    expect(running.settings.securities).toBe(true);
    expect(Object.keys(running.market?.prices ?? {})).toHaveLength(6);
    expect(running.players.some((p) => (p.holdings?.length ?? 0) > 0)).toBe(true);
    const finished = migrateState(json("state-v2-finished.json"), 2);
    expect(finished.status).toBe("finished");
    expect(finished.market).toBeDefined();
  });

  it("lobbies of both versions load (the lobby settings default the new fields)", () => {
    for (const name of lobbyFixtures) {
      const lobby = StoredLobbySchema.parse(json(name));
      expect(typeof lobby.settings.securities).toBe("boolean");
      expect(lobby.settings.securitiesLockRounds).toBeGreaterThanOrEqual(1);
    }
  });
});
