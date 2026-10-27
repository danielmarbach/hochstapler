// SQLITE_LOCKING=none (docs/DESIGN.md #95): SQLite's unix-none VFS takes no file locks. The managed-identity (Kerberos)
// mount of Azure Files ignores `nobrl`, and SQLite's byte-range locks over SMB then fail with "database is locked";
// with the writer lease as the only guard (#89) no file lock is needed, the same as `nobrl` did on the key mount.
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { StoredLobbySchema } from "@poly/engine";
import { Db, checkSqliteLocking, loadSqliteLocking, sqliteFileUri } from "../src/db.ts";

const dbs: Db[] = [];
const raws: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const r of raws.splice(0)) r.close();
});

const lobby = StoredLobbySchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "lobby-v1-running.json"), "utf8")),
);

describe("loadSqliteLocking", () => {
  it("defaults to the normal file locks and accepts none", () => {
    expect(loadSqliteLocking({})).toBe("default");
    expect(loadSqliteLocking({ SQLITE_LOCKING: "" })).toBe("default");
    expect(loadSqliteLocking({ SQLITE_LOCKING: "none" })).toBe("none");
  });

  it("refuses anything else", () => {
    expect(() => loadSqliteLocking({ SQLITE_LOCKING: "off" })).toThrow();
  });
});

describe("checkSqliteLocking", () => {
  it("allows none only with a writer lease and the rollback journal", () => {
    expect(() => checkSqliteLocking("none", "delete", "azure-blob")).not.toThrow();
    expect(() => checkSqliteLocking("none", "delete", "file")).not.toThrow();
    expect(() => checkSqliteLocking("none", "wal", "azure-blob")).toThrow(/JOURNAL_MODE/);
    expect(() => checkSqliteLocking("none", "delete", "none")).toThrow(/lease/);
    expect(() => checkSqliteLocking("default", "wal", "none")).not.toThrow();
  });
});

describe("sqliteFileUri", () => {
  it("selects the unix-none VFS and escapes the URI specials in the path", () => {
    expect(sqliteFileUri("/data/v2/games.sqlite")).toBe("file:/data/v2/games.sqlite?vfs=unix-none");
    expect(sqliteFileUri("/tmp/a%b?c#d/games.sqlite")).toBe(
      "file:/tmp/a%25b%3Fc%23d/games.sqlite?vfs=unix-none",
    );
  });
});

describe("Db with fileLocking none", () => {
  it("writes the database file at its normal path", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-lock-"));
    const db = new Db(dir, { log: () => {}, journalMode: "delete", fileLocking: "none" });
    dbs.push(db);
    db.save(lobby, null);
    expect(existsSync(join(dir, "games.sqlite"))).toBe(true);
    expect(db.exists(lobby.gameId)).toBe(true);
  });

  it("takes no file locks: a lock held by another connection does not block its writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-lock-"));
    const db = new Db(dir, { log: () => {}, journalMode: "delete", fileLocking: "none" });
    dbs.push(db);
    const other = new DatabaseSync(join(dir, "games.sqlite"));
    raws.push(other);
    other.exec("BEGIN EXCLUSIVE");
    expect(() => db.save(lobby, null)).not.toThrow();
    other.exec("ROLLBACK");
  });

  it("the default VFS is blocked by the same lock (the test above proves something)", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-lock-"));
    const db = new Db(dir, { log: () => {}, journalMode: "delete" });
    dbs.push(db);
    const other = new DatabaseSync(join(dir, "games.sqlite"));
    raws.push(other);
    other.exec("BEGIN EXCLUSIVE");
    expect(() => db.save(lobby, null)).toThrow();
    other.exec("ROLLBACK");
  });

  it("refuses WAL and the exclusive locking mode, which both rely on file locks", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-lock-"));
    expect(() => new Db(dir, { log: () => {}, journalMode: "wal", fileLocking: "none" })).toThrow();
    expect(
      () =>
        new Db(dir, {
          log: () => {},
          journalMode: "delete",
          fileLocking: "none",
          exclusiveLock: true,
        }),
    ).toThrow();
  });
});
