import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { LobbyInfo } from "@poly/engine";
import { Db } from "../src/db.ts";
import {
  LATEST_SCHEMA_VERSION,
  MigrationError,
  SCHEMA_MIGRATIONS,
  migrateSchema,
} from "../src/migrations/schema.ts";
import type { SchemaMigration } from "../src/migrations/schema.ts";
import { startServer } from "../src/server.ts";

const FIXTURE_DB = join(import.meta.dirname, "fixtures", "games-v0.sqlite");
/** Copy of the real database (17 games, 237k actions); only used when present on this machine. */
const REAL_DB_DIR = "/tmp/wp-realdb";
const HAS_REAL_DB = existsSync(join(REAL_DB_DIR, "games.sqlite"));

const dirs: string[] = [];
const dbs: Db[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "poly-mig-"));
  dirs.push(d);
  return d;
}
function open(dir: string, opts: ConstructorParameters<typeof Db>[1] = {}): Db {
  const db = new Db(dir, { log: () => {}, ...opts });
  dbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

/** Copies the v0 database (all sidecar files) into a fresh data dir. */
function legacyDir(source = FIXTURE_DB): string {
  const dir = tmp();
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(source + suffix))
      copyFileSync(source + suffix, join(dir, `games.sqlite${suffix}`));
  }
  return dir;
}
function backupsOf(dir: string): string[] {
  const d = join(dir, "backups");
  return existsSync(d) ? readdirSync(d).sort() : [];
}
function userVersion(file: string): number {
  const raw = new DatabaseSync(file, { readOnly: true });
  try {
    const row = raw.prepare("PRAGMA user_version").get();
    return Number((row as { user_version: number }).user_version);
  } finally {
    raw.close();
  }
}
function columns(file: string, table: string): string[] {
  const raw = new DatabaseSync(file, { readOnly: true });
  try {
    return raw
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => String((r as { name: string }).name));
  } finally {
    raw.close();
  }
}

describe("schema migrations: list", () => {
  it("is numbered 1..n without gaps and ends at LATEST_SCHEMA_VERSION", () => {
    expect(SCHEMA_MIGRATIONS.map((m) => m.version)).toEqual(SCHEMA_MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST_SCHEMA_VERSION).toBe(SCHEMA_MIGRATIONS.length);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    for (const m of SCHEMA_MIGRATIONS) expect(m.name).toMatch(/\S/);
  });

  it("rejects a migration list with gaps or duplicates", () => {
    const up = (): void => {};
    const bad: SchemaMigration[] = [
      { version: 1, name: "a", up },
      { version: 3, name: "c", up },
    ];
    const raw = new DatabaseSync(":memory:");
    expect(() => migrateSchema(raw, { migrations: bad, dbFile: null, log: () => {} })).toThrow(
      /consecutive|order/i,
    );
    raw.close();
  });
});

describe("schema migrations: fresh database", () => {
  it("applies every migration, needs no backup and creates the latest schema", () => {
    const dir = tmp();
    const db = open(dir);
    expect(db.migration.from).toBe(0);
    expect(db.migration.to).toBe(LATEST_SCHEMA_VERSION);
    expect(db.migration.applied).toEqual(SCHEMA_MIGRATIONS.map((m) => m.name));
    expect(db.migration.backup).toBeNull();
    expect(backupsOf(dir)).toEqual([]);
    db.close();
    dbs.length = 0;
    const file = join(dir, "games.sqlite");
    expect(userVersion(file)).toBe(LATEST_SCHEMA_VERSION);
    expect(columns(file, "games")).toContain("state_version");
  });

  it("works for in-memory databases (no backup possible or needed)", () => {
    const db = open(":memory:");
    expect(db.migration.to).toBe(LATEST_SCHEMA_VERSION);
    expect(db.migration.backup).toBeNull();
  });
});

describe("schema migrations: existing v0 database (as written before migrations existed)", () => {
  it("backs up first, migrates in place and keeps every game loadable", () => {
    const dir = legacyDir();
    const before = new DatabaseSync(join(dir, "games.sqlite"), { readOnly: true });
    const ids = before
      .prepare("SELECT id FROM games ORDER BY id")
      .all()
      .map((r) => String((r as { id: string }).id));
    before.close();
    expect(ids.length).toBeGreaterThanOrEqual(3);

    const logs: string[] = [];
    const db = open(dir, {
      log: (m) => logs.push(m),
      now: () => new Date("2026-10-24T10:15:30.123Z"),
    });

    expect(db.migration).toMatchObject({ from: 0, to: LATEST_SCHEMA_VERSION });
    const backups = backupsOf(dir);
    expect(backups).toEqual(["games-2026-10-24T10-15-30-123Z-v0.sqlite"]);
    expect(db.migration.backup).toBe(join(dir, "backups", backups[0]!));
    expect(logs.join("\n")).toMatch(/backup/i);
    expect(logs.join("\n")).toMatch(new RegExp(`migrat.*${LATEST_SCHEMA_VERSION}`, "i"));

    // the backup is the untouched pre-migration database
    expect(userVersion(join(dir, "backups", backups[0]!))).toBe(0);
    expect(columns(join(dir, "backups", backups[0]!), "games")).not.toContain("state_version");

    // everything still there, validated by the full schemas
    for (const id of ids) {
      const row = db.load(id);
      expect(row, `game ${id}`).not.toBeNull();
      expect(row!.lobby.gameId).toBe(id);
    }
    expect(db.runningIds().length).toBeGreaterThan(0);
  });

  it("migration 3 backfills last_activity_at from updated_at for every existing game", () => {
    const dir = legacyDir();
    const db = open(dir);
    expect(db.migration.applied).toContain("last-activity-column");
    db.close();
    dbs.length = 0;
    const file = join(dir, "games.sqlite");
    expect(columns(file, "games")).toContain("last_activity_at");
    const raw = new DatabaseSync(file, { readOnly: true });
    const rows = raw.prepare("SELECT updated_at AS u, last_activity_at AS a FROM games").all();
    raw.close();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows as { u: number; a: number }[]) {
      expect(r.a).toBeGreaterThan(0);
      expect(r.a).toBe(r.u);
    }
  });

  it("a second start does nothing: no migration, no new backup", () => {
    const dir = legacyDir();
    open(dir).close();
    dbs.length = 0;
    const files = backupsOf(dir);
    expect(files).toHaveLength(1);

    const again = open(dir);
    expect(again.migration.applied).toEqual([]);
    expect(again.migration.backup).toBeNull();
    expect(again.migration.from).toBe(LATEST_SCHEMA_VERSION);
    expect(backupsOf(dir)).toEqual(files);
  });

  it("running games resume through the server and answer the API", async () => {
    const dir = legacyDir();
    const running = (() => {
      const raw = new DatabaseSync(join(dir, "games.sqlite"), { readOnly: true });
      const ids = raw
        .prepare("SELECT id FROM games WHERE status = 'running'")
        .all()
        .map((r) => String((r as { id: string }).id));
      raw.close();
      return ids;
    })();
    expect(running.length).toBeGreaterThan(0);
    const srv = await startServer({ port: 0, dataDir: dir, botDelayMs: 0, host: "127.0.0.1" });
    try {
      for (const id of running) {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/games/${id}`);
        expect(res.status).toBe(200);
        const info = (await res.json()) as LobbyInfo;
        expect(info.status).toBe("running");
      }
    } finally {
      await srv.close();
    }
    expect(backupsOf(dir)).toHaveLength(1);
  });

  it.skipIf(!HAS_REAL_DB)(
    "the real database copy (17 games) migrates and loads completely",
    () => {
      const dir = legacyDir(join(REAL_DB_DIR, "games.sqlite"));
      const db = open(dir);
      expect(db.migration.from).toBe(0);
      expect(backupsOf(dir)).toHaveLength(1);
      const raw = new DatabaseSync(join(dir, "games.sqlite"), { readOnly: true });
      const ids = raw
        .prepare("SELECT id FROM games")
        .all()
        .map((r) => String((r as { id: string }).id));
      raw.close();
      expect(ids).toHaveLength(17);
      for (const id of ids) expect(db.load(id), `game ${id}`).not.toBeNull();
    },
    60_000,
  );
});

describe("schema migrations: failure handling", () => {
  const boom: SchemaMigration = {
    version: LATEST_SCHEMA_VERSION + 1,
    name: "explode",
    up(raw) {
      raw.exec("ALTER TABLE games ADD COLUMN half_done TEXT");
      throw new Error("kaputt");
    },
  };

  it("rolls everything back (even earlier pending migrations), keeps the backup and refuses", () => {
    const dir = legacyDir();
    const file = join(dir, "games.sqlite");
    const logs: string[] = [];
    expect(() =>
      open(dir, { migrations: [...SCHEMA_MIGRATIONS, boom], log: (m) => logs.push(m) }),
    ).toThrow(MigrationError);
    expect(() => open(dir, { migrations: [...SCHEMA_MIGRATIONS, boom] })).toThrow(
      /explode.*kaputt/s,
    );
    expect(userVersion(file)).toBe(0);
    expect(columns(file, "games")).not.toContain("half_done");
    expect(columns(file, "games")).not.toContain("state_version");
    expect(backupsOf(dir).length).toBeGreaterThanOrEqual(1);
    expect(logs.join("\n")).toMatch(/explode/);
  });

  it("startServer refuses to start and leaves the database untouched", async () => {
    const dir = legacyDir();
    const file = join(dir, "games.sqlite");
    await expect(
      startServer({
        port: 0,
        dataDir: dir,
        host: "127.0.0.1",
        schemaMigrations: [...SCHEMA_MIGRATIONS, boom],
      }),
    ).rejects.toThrow(/explode/);
    expect(userVersion(file)).toBe(0);
  });

  it("refuses a database written by a newer version instead of touching it", () => {
    const dir = tmp();
    const file = join(dir, "games.sqlite");
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 5}`);
    raw.close();
    expect(() => open(dir)).toThrow(/newer/i);
    expect(userVersion(file)).toBe(LATEST_SCHEMA_VERSION + 5);
  });
});

describe("schema migrations: backups", () => {
  it("keeps only the 10 newest backups", () => {
    const dir = legacyDir();
    const bdir = join(dir, "backups");
    mkdirSync(bdir);
    for (let i = 1; i <= 12; i++) {
      writeFileSync(
        join(bdir, `games-2026-01-${String(i).padStart(2, "0")}T00-00-00-000Z-v0.sqlite`),
        "x",
      );
    }
    writeFileSync(join(bdir, "notes.txt"), "not a backup, must survive");
    const db = open(dir, { now: () => new Date("2026-10-24T10:00:00.000Z") });
    expect(db.migration.backup).not.toBeNull();
    const left = backupsOf(dir).filter((f) => f.startsWith("games-"));
    expect(left).toHaveLength(10);
    expect(left.at(-1)).toBe("games-2026-10-24T10-00-00-000Z-v0.sqlite");
    expect(left[0]).toBe("games-2026-01-04T00-00-00-000Z-v0.sqlite");
    expect(backupsOf(dir)).toContain("notes.txt");
  });

  it("includes data that only lives in the WAL (checkpoint before VACUUM INTO)", () => {
    const dir = legacyDir();
    const file = join(dir, "games.sqlite");
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    raw.exec("UPDATE games SET invite_code = 'WALONLY' WHERE id = (SELECT id FROM games LIMIT 1)");
    // keep the connection open so the change stays in the -wal file while we migrate
    const db = open(dir);
    const backup = db.migration.backup!;
    raw.close();
    const check = new DatabaseSync(backup, { readOnly: true });
    const row = check
      .prepare("SELECT count(*) AS n FROM games WHERE invite_code = 'WALONLY'")
      .get();
    check.close();
    expect(Number((row as { n: number }).n)).toBe(1);
  });
});
