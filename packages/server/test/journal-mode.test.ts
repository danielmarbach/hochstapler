// SQLITE_JOURNAL_MODE (docs/DESIGN.md #51): WAL stays the default, `delete` exists for network file systems
// (Azure Files / SMB) where WAL's shared-memory file is unsafe.
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { StoredLobbySchema } from "@poly/engine";
import { Db, loadJournalMode } from "../src/db.ts";

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function mode(dir: string): string {
  const raw = new DatabaseSync(join(dir, "games.sqlite"));
  try {
    const row = raw.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    return row.journal_mode;
  } finally {
    raw.close();
  }
}

const lobby = StoredLobbySchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "lobby-v1-running.json"), "utf8")),
);

describe("journal mode", () => {
  it("defaults to WAL", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-jm-"));
    dbs.push(new Db(dir, { log: () => {} }));
    expect(mode(dir)).toBe("wal");
  });

  it("uses a rollback journal (no -wal/-shm files) with journalMode 'delete'", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-jm-"));
    const db = new Db(dir, { log: () => {}, journalMode: "delete" });
    dbs.push(db);
    db.save(lobby, null);
    expect(mode(dir)).toBe("delete");
    expect(existsSync(join(dir, "games.sqlite-wal"))).toBe(false);
    expect(existsSync(join(dir, "games.sqlite-shm"))).toBe(false);
    expect(db.exists(lobby.gameId)).toBe(true);
  });

  it("converts an existing WAL database when switched to delete", () => {
    const dir = mkdtempSync(join(tmpdir(), "poly-jm-"));
    new Db(dir, { log: () => {} }).close();
    expect(mode(dir)).toBe("wal");
    dbs.push(new Db(dir, { log: () => {}, journalMode: "delete" }));
    expect(mode(dir)).toBe("delete");
  });
});

describe("loadJournalMode", () => {
  it("is wal when unset, accepts wal/delete case-insensitively and rejects anything else", () => {
    expect(loadJournalMode({})).toBe("wal");
    expect(loadJournalMode({ SQLITE_JOURNAL_MODE: "DELETE" })).toBe("delete");
    expect(loadJournalMode({ SQLITE_JOURNAL_MODE: "wal" })).toBe("wal");
    expect(() => loadJournalMode({ SQLITE_JOURNAL_MODE: "off" })).toThrow();
    expect(() => loadJournalMode({ SQLITE_JOURNAL_MODE: "wal; DROP TABLE games" })).toThrow();
  });
});
