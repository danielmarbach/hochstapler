// "Can write" before "ready" (docs/DESIGN.md #94): the write self-test a new writer runs after opening the database, and
// the write health that turns readiness off after a few failed writes in a row.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "@poly/engine";
import type { StoredLobby } from "@poly/engine";
import { Db, WRITE_FAILURE_THRESHOLD } from "../src/db.ts";
import type { WriteHealthEvent } from "../src/db.ts";
import { LeaseFencedError } from "../src/lease/types.ts";
import { LATEST_SCHEMA_VERSION } from "../src/migrations/schema.ts";

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

/** What node:sqlite throws when the directory is read-only (seen live on the managed-identity mount: no journal). */
const sqliteError = (): Error =>
  Object.assign(new Error("attempt to write a readonly database"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 1544,
    errstr: "attempt to write a readonly database",
  });

const rows = (dir: string): unknown[] => {
  const raw = new DatabaseSync(join(dir, "games.sqlite"), { readOnly: true });
  try {
    return raw.prepare("SELECT instance, checked_at FROM writer_check").all();
  } finally {
    raw.close();
  }
};

// a read-only directory does not stop root
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("Db write self-test", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "poly-writecheck-"))));
  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  it("upserts one row with the instance and the time, in a transaction", () => {
    const db = new Db(dir, { journalMode: "delete" });
    db.writeCheck("replica-a");
    db.writeCheck("replica-b");
    db.close();
    expect(rows(dir)).toEqual([{ instance: "replica-b", checked_at: expect.any(Number) }]);
  });

  it("is no schema migration: an older version still opens the file (rollback)", () => {
    const db = new Db(dir);
    db.writeCheck("replica-a");
    db.close();
    const raw = new DatabaseSync(join(dir, "games.sqlite"), { readOnly: true });
    expect(raw.prepare("PRAGMA user_version").get()).toEqual({
      user_version: LATEST_SCHEMA_VERSION,
    });
    raw.close();
  });

  it("asks the write guard first: a fenced writer does not even try", () => {
    const db = new Db(dir, {
      writeGuard: () => {
        throw new LeaseFencedError();
      },
    });
    expect(() => db.writeCheck("replica-a")).toThrow(LeaseFencedError);
    db.close();
  });

  it.skipIf(isRoot)(
    "fails with the SQLite error when the rollback journal cannot be created (read-only directory), reads still work",
    () => {
      const first = new Db(dir, { journalMode: "delete" });
      first.save(lobby("g1"), null);
      first.close();
      chmodSync(dir, 0o555);
      const db = new Db(dir, { journalMode: "delete" });
      expect(db.exists("g1")).toBe(true);
      let thrown: unknown;
      try {
        db.writeCheck("replica-a");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toMatchObject({ code: "ERR_SQLITE_ERROR" });
      expect(db.exists("g1")).toBe(true);
      db.close({ checkpoint: false });
    },
  );

  it("an injected write fault fails it, too (tests of the server use this)", () => {
    const db = new Db(dir, {
      writeFault: () => {
        throw sqliteError();
      },
    });
    expect(() => db.writeCheck("replica-a")).toThrow("attempt to write a readonly database");
    db.close();
  });
});

describe("Db write health", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "poly-writehealth-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it(`turns unhealthy after ${WRITE_FAILURE_THRESHOLD} failed writes in a row, once, and healthy again after a good one`, () => {
    let failing = false;
    let fenced = false;
    const events: WriteHealthEvent[] = [];
    const db = new Db(dir, {
      writeGuard: () => {
        if (fenced) throw new LeaseFencedError();
      },
      writeFault: () => {
        if (failing) throw sqliteError();
      },
      onWriteHealth: (e) => events.push(e),
    });
    expect(WRITE_FAILURE_THRESHOLD).toBe(3);
    db.save(lobby("g1"), null);
    failing = true;
    expect(() => db.save(lobby("g1"), null)).toThrow();
    expect(() => db.touchActivity("g1", 5)).toThrow();
    expect(db.writesHealthy).toBe(true);
    // a fenced write is the lease's business, not a broken disk: it neither counts nor resets
    fenced = true;
    expect(() => db.logAction("g1", 1, "p1", { type: "roll" }, 1)).toThrow(LeaseFencedError);
    fenced = false;
    expect(db.writesHealthy).toBe(true);
    expect(() => db.logAction("g1", 1, "p1", { type: "roll" }, 1)).toThrow();
    expect(db.writesHealthy).toBe(false);
    expect(() => db.purge([], 10)).toThrow();
    expect(events).toEqual([
      { healthy: false, failures: WRITE_FAILURE_THRESHOLD, error: expect.any(Error) },
    ]);
    failing = false;
    db.save(lobby("g1"), null);
    expect(db.writesHealthy).toBe(true);
    expect(events.at(-1)).toEqual({ healthy: true, failures: 0 });
    expect(events).toHaveLength(2);
    db.close();
  });

  it("a failure in between successes never adds up", () => {
    let failing = false;
    const db = new Db(dir, {
      writeFault: () => {
        if (failing) throw sqliteError();
      },
    });
    for (let i = 0; i < 10; i++) {
      failing = i % 2 === 0;
      if (failing) expect(() => db.save(lobby("g1"), null)).toThrow();
      else db.save(lobby("g1"), null);
    }
    expect(db.writesHealthy).toBe(true);
    db.close();
  });
});
