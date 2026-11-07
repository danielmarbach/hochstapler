// Fencing at the database: every write asks the writer lease first (no write after a failed renewal), and on local disks
// the file is opened with locking_mode=EXCLUSIVE so a second process gets "database is locked" instead of writing.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "@poly/engine";
import type { StoredLobby } from "@poly/engine";
import { Db } from "../src/db.ts";
import { LeaseFencedError } from "../src/lease/types.ts";

const lobby = (gameId: string): StoredLobby => ({
  gameId,
  inviteCode: "ABCDEF",
  status: "lobby",
  settings: { ...DEFAULT_SETTINGS, buildingLimits: { ...DEFAULT_SETTINGS.buildingLimits } },
  seats: [],
  maxPlayers: 4,
  createdAt: 1,
  chat: { mode: "free", muted: [] },
});

describe("Db write guard", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "poly-fence-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses every kind of write once the guard says no, and writes nothing", () => {
    let allowed = true;
    const db = new Db(dir, {
      writeGuard: () => {
        if (!allowed) throw new LeaseFencedError();
      },
    });
    db.save(lobby("g1"), null);
    allowed = false;
    expect(() => db.save(lobby("g2"), null)).toThrow(LeaseFencedError);
    expect(() => db.touchActivity("g1", 5)).toThrow(LeaseFencedError);
    expect(() => db.logAction("g1", 1, "p1", { type: "roll" }, 1)).toThrow(LeaseFencedError);
    expect(() => db.purge(["g1"], 10)).toThrow(LeaseFencedError);
    expect(() => db.vacuumIfWorthIt()).toThrow(LeaseFencedError);
    // reads still work (nothing to protect)
    expect(db.exists("g1")).toBe(true);
    expect(db.exists("g2")).toBe(false);
    db.close();
  });
});

describe("Db.saveTogether (several games, one fenced transaction)", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "poly-together-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes every row", () => {
    const db = new Db(dir);
    db.saveTogether([
      { lobby: lobby("g1"), state: null },
      { lobby: lobby("g2"), state: null, activityAt: 5 },
    ]);
    expect(db.exists("g1")).toBe(true);
    expect(db.exists("g2")).toBe(true);
    db.close();
  });

  it("writes nothing when a later row fails (the first row is rolled back)", () => {
    const db = new Db(dir);
    // JSON cannot hold a BigInt: the second row fails after the first one was already written
    const broken = Object.assign(lobby("g2"), { createdAt: 10n });
    expect(() =>
      db.saveTogether([
        { lobby: lobby("g1"), state: null },
        { lobby: broken, state: null },
      ]),
    ).toThrow(TypeError);
    expect(db.exists("g1")).toBe(false);
    expect(db.exists("g2")).toBe(false);
    // the connection is usable afterwards (the transaction was closed)
    db.save(lobby("g3"), null);
    expect(db.exists("g3")).toBe(true);
    db.close();
  });

  it("refuses without writing anything once the guard says no", () => {
    let allowed = true;
    const db = new Db(dir, {
      writeGuard: () => {
        if (!allowed) throw new LeaseFencedError();
      },
    });
    allowed = false;
    expect(() =>
      db.saveTogether([
        { lobby: lobby("g1"), state: null },
        { lobby: lobby("g2"), state: null },
      ]),
    ).toThrow(LeaseFencedError);
    expect(db.exists("g1")).toBe(false);
    expect(db.exists("g2")).toBe(false);
    db.close();
  });
});

describe.each(["wal", "delete"] as const)("exclusive locking (%s journal)", (journalMode) => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "poly-excl-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a second process (connection) cannot open the file while the first holds it", () => {
    const first = new Db(dir, { journalMode, exclusiveLock: true });
    first.save(lobby("g1"), null);
    expect(() => new Db(dir, { journalMode, exclusiveLock: true })).toThrow(/locked|busy/i);
    const raw = new DatabaseSync(join(dir, "games.sqlite"));
    expect(() => raw.exec("INSERT INTO games (id) VALUES ('x')")).toThrow(/locked|busy/i);
    raw.close();
    first.close();
    // released on close: the next holder opens it
    const next = new Db(dir, { journalMode, exclusiveLock: true });
    expect(next.exists("g1")).toBe(true);
    next.close();
  });
});
