// Stored game rows: full validation on load, state versions, "never crash, never overwrite".
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_STATE_VERSION, StoredLobbySchema, migrateState } from "@poly/engine";
import type { StateMigrationChain } from "@poly/engine";
import { Db } from "../src/db.ts";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

const lobby = StoredLobbySchema.parse(fixture("lobby-v1-running.json"));
const state = migrateState(fixture("state-v1-running.json"), 1);

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup(opts: { stateChain?: StateMigrationChain } = {}): {
  db: Db;
  file: string;
  logs: string[];
  raw(): DatabaseSync;
} {
  const dir = mkdtempSync(join(tmpdir(), "poly-rows-"));
  const logs: string[] = [];
  const db = new Db(dir, { log: (m) => logs.push(m), ...opts });
  dbs.push(db);
  const file = join(dir, "games.sqlite");
  return { db, file, logs, raw: () => new DatabaseSync(file) };
}

function rowOf(
  raw: DatabaseSync,
  id: string,
): { state_json: string | null; state_version: number } {
  const r = raw.prepare("SELECT state_json, state_version FROM games WHERE id = ?").get(id);
  return r as { state_json: string | null; state_version: number };
}

describe("Db rows", () => {
  it("clamps settings stored before the floors existed (turn time >= 30 s, >= 2 missed turns)", () => {
    const { db } = setup();
    const low = { ...lobby.settings, turnTimeoutSec: 1, awayAfterMissedTurns: 1 };
    db.save({ ...lobby, settings: low }, { ...state, settings: low });
    const loaded = db.load(lobby.gameId);
    expect(loaded?.lobby.settings).toMatchObject({ turnTimeoutSec: 30, awayAfterMissedTurns: 2 });
    expect(loaded?.state?.settings).toMatchObject({ turnTimeoutSec: 30, awayAfterMissedTurns: 2 });
  });

  it("leaves 'no time limit' and valid values alone on load", () => {
    const { db } = setup();
    const ok = { ...lobby.settings, turnTimeoutSec: 0, awayAfterMissedTurns: 3 };
    db.save({ ...lobby, settings: ok }, { ...state, settings: ok });
    expect(db.load(lobby.gameId)?.lobby.settings).toMatchObject({
      turnTimeoutSec: 0,
      awayAfterMissedTurns: 3,
    });
  });

  it("round-trips a validated lobby and state and stores the current state version", () => {
    const { db, raw } = setup();
    db.save(lobby, state);
    expect(db.load(lobby.gameId)).toEqual({ lobby, state });
    const r = raw();
    expect(rowOf(r, lobby.gameId).state_version).toBe(CURRENT_STATE_VERSION);
    r.close();
  });

  it("migrates an older stored state on load and keeps the stored row until the next save", () => {
    const chain: StateMigrationChain = {
      current: 2,
      steps: [(j) => ({ ...(j as object), freeParkingPot: 777 })],
    };
    const { db, raw } = setup({ stateChain: chain });
    db.save(lobby, state);
    const r = raw();
    r.prepare("UPDATE games SET state_version = 1 WHERE id = ?").run(lobby.gameId);
    const before = rowOf(r, lobby.gameId);
    expect(db.load(lobby.gameId)?.state?.freeParkingPot).toBe(777);
    expect(rowOf(r, lobby.gameId)).toEqual(before);
    r.close();
  });

  it("treats a row with an unreadable state as unavailable: logged, no crash, row untouched", () => {
    const { db, raw, logs } = setup();
    db.save(lobby, state);
    const r = raw();
    r.prepare("UPDATE games SET state_json = ? WHERE id = ?").run('{"id":"x"', lobby.gameId);
    const before = rowOf(r, lobby.gameId);
    expect(db.load(lobby.gameId)).toBeNull();
    expect(logs.join("\n")).toContain(lobby.gameId);
    expect(rowOf(r, lobby.gameId)).toEqual(before);
    r.close();
  });

  it("treats a state that fails the full schema as unavailable (not just the structural shell)", () => {
    const { db, raw, logs } = setup();
    db.save(lobby, state);
    const r = raw();
    const broken = { ...state, bank: { houses: "many" } };
    r.prepare("UPDATE games SET state_json = ? WHERE id = ?").run(
      JSON.stringify(broken),
      lobby.gameId,
    );
    expect(db.load(lobby.gameId)).toBeNull();
    expect(logs.join("\n")).toMatch(/bank/);
    r.close();
  });

  it("treats a state from a newer version as unavailable and never overwrites it", () => {
    const { db, raw, logs } = setup();
    db.save(lobby, state);
    const r = raw();
    r.prepare("UPDATE games SET state_version = ? WHERE id = ?").run(
      CURRENT_STATE_VERSION + 1,
      lobby.gameId,
    );
    const before = rowOf(r, lobby.gameId);
    expect(db.load(lobby.gameId)).toBeNull();
    expect(logs.join("\n")).toMatch(/newer/i);
    expect(rowOf(r, lobby.gameId)).toEqual(before);
    r.close();
  });

  it("treats an invalid lobby as unavailable", () => {
    const { db, raw } = setup();
    db.save(lobby, state);
    const r = raw();
    r.prepare("UPDATE games SET lobby_json = ? WHERE id = ?").run('{"gameId":"x"}', lobby.gameId);
    expect(db.load(lobby.gameId)).toBeNull();
    r.close();
  });
});
