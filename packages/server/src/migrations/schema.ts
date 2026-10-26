// SQLite schema migrations (docs/DESIGN.md #43). The schema version lives in `PRAGMA user_version`.
// On startup, BEFORE any room is loaded:
//   pending migrations?  -> checkpoint the WAL, `VACUUM INTO` a backup, apply ALL pending migrations in
//                           ONE transaction (all-or-nothing), set user_version;
//   a migration throws?  -> rollback, log, refuse to start (never run on a half-migrated database).
// To change the schema, append a migration to SCHEMA_MIGRATIONS (README "Datenbank & Migrationen");
// never edit one that has shipped. Game-state JSON changes are a different mechanism (engine migrations.ts).
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { attemptSync } from "@poly/engine";
import { emitLog } from "../telemetry.ts";

export interface SchemaMigration {
  /** 1, 2, 3 ... strictly consecutive */
  version: number;
  name: string;
  /** Runs inside the migration transaction: must not BEGIN/COMMIT; throw to abort everything. */
  up(db: DatabaseSync): void;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => String((r as { name: unknown }).name));
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    // The schema as it existed before migrations: recognises databases that already have the tables
    // (user_version 0, created by older versions) and creates them for fresh ones.
    version: 1,
    name: "baseline",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          invite_code TEXT NOT NULL,
          lobby_json TEXT NOT NULL,
          state_json TEXT,
          status TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS actions (
          game_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          player_id TEXT NOT NULL,
          action_json TEXT NOT NULL,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS actions_game ON actions(game_id, version);
      `);
    },
  },
  {
    // Version of the state_json shape (engine CURRENT_STATE_VERSION); existing rows are version 1.
    version: 2,
    name: "state-version-column",
    up(db) {
      if (!tableColumns(db, "games").includes("state_version")) {
        db.exec("ALTER TABLE games ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1");
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS actions_game ON actions(game_id, version);
        CREATE INDEX IF NOT EXISTS games_status ON games(status);
      `);
    },
  },
  {
    // Last HUMAN activity (action, join, lobby change, seated player connecting): the data retention clock
    // (docs/DESIGN.md #57). updated_at cannot serve: bots and turn timers keep writing it in bot-heavy games.
    version: 3,
    name: "last-activity-column",
    up(db) {
      if (!tableColumns(db, "games").includes("last_activity_at")) {
        db.exec("ALTER TABLE games ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0");
      }
      db.exec("UPDATE games SET last_activity_at = updated_at WHERE last_activity_at = 0");
    },
  },
];

export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS.length;

export const DEFAULT_KEEP_BACKUPS = 10;

export interface MigrateOptions {
  /** defaults to SCHEMA_MIGRATIONS (tests inject their own) */
  migrations?: readonly SchemaMigration[];
  /** path of the database file, null for in-memory (no backup possible or needed) */
  dbFile: string | null;
  /** defaults to `backups/` next to the database file */
  backupDir?: string;
  keepBackups?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface MigrationReport {
  /** user_version before */
  from: number;
  /** user_version after */
  to: number;
  /** names of the applied migrations, in order */
  applied: string[];
  /** absolute path of the backup written before migrating, null if none was needed */
  backup: string | null;
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  return Number((row as { user_version: unknown } | undefined)?.user_version ?? 0);
}

function hasUserTables(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  return Number((row as { n: unknown } | undefined)?.n ?? 0) > 0;
}

function assertConsecutive(migrations: readonly SchemaMigration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new MigrationError(
        `schema migrations must be numbered consecutively from 1 in order (found version ${m.version} at position ${i + 1})`,
      );
    }
  });
}

const BACKUP_NAME = /^games-.+-v\d+\.sqlite$/;

function pruneBackups(dir: string, keep: number, log: (m: string) => void): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- backup dir derives from DATA_DIR (operator config)
  const old = readdirSync(dir)
    .filter((n) => BACKUP_NAME.test(n))
    .sort()
    .slice(0, -keep);
  for (const name of old) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- name matched BACKUP_NAME, dir is operator config
    const r = attemptSync(`backup:prune:${name}`, () => unlinkSync(join(dir, name)));
    if (r.ok) log(`[db] removed old backup ${name}`);
    else log(`[db] could not remove old backup ${name}: ${r.error.message}`);
  }
}

function createBackup(
  db: DatabaseSync,
  opts: Required<Pick<MigrateOptions, "now">> & {
    dir: string;
    from: number;
    keep: number;
    log: (m: string) => void;
  },
): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- backup dir derives from DATA_DIR (operator config)
  mkdirSync(opts.dir, { recursive: true });
  // Fold the WAL into the main file so nothing is only "in flight"; VACUUM INTO reads a consistent
  // snapshot including the WAL anyway, the checkpoint just keeps the backup path simple to reason about.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const stamp = opts.now().toISOString().replace(/[:.]/g, "-");
  const file = join(opts.dir, `games-${stamp}-v${opts.from}.sqlite`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- generated name inside the backup dir
  if (existsSync(file)) throw new MigrationError(`backup ${file} already exists`);
  db.prepare("VACUUM INTO ?").run(file);
  pruneBackups(opts.dir, opts.keep, opts.log);
  return file;
}

export function migrateSchema(db: DatabaseSync, opts: MigrateOptions): MigrationReport {
  const migrations = opts.migrations ?? SCHEMA_MIGRATIONS;
  const log = opts.log ?? ((m: string) => console.warn(m));
  assertConsecutive(migrations);

  const from = readUserVersion(db);
  const latest = migrations.length;
  if (from > latest) {
    throw new MigrationError(
      `database schema version ${from} is newer than this version of Hochstapler understands (${latest}). ` +
        "Start the newer version again or restore a backup from data/backups/ (see README).",
    );
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, applied: [], backup: null };

  let backup: string | null = null;
  if (opts.dbFile !== null && hasUserTables(db)) {
    const dir = opts.backupDir ?? join(dirname(opts.dbFile), "backups");
    const made = attemptSync("db:backup", () =>
      createBackup(db, {
        dir,
        from,
        keep: opts.keepBackups ?? DEFAULT_KEEP_BACKUPS,
        now: opts.now ?? (() => new Date()),
        log,
      }),
    );
    if (!made.ok) {
      throw new MigrationError(
        `could not write a backup before migrating, refusing to touch the database: ${made.error.message}`,
      );
    }
    backup = made.value;
    log(`[db] backup written: ${backup}`);
  }

  log(`[db] migrating schema v${from} -> v${latest} (${pending.map((m) => m.name).join(", ")})`);
  db.exec("BEGIN IMMEDIATE");
  for (const m of pending) {
    const done = attemptSync(`migration:${m.version}`, () => {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
    if (!done.ok) {
      db.exec("ROLLBACK");
      const message =
        `schema migration ${m.version} (${m.name}) failed: ${done.error.message}. ` +
        `The database was rolled back to version ${from}` +
        (backup ? `; backup: ${backup}` : "") +
        ". Refusing to start.";
      log(`[db] ${message}`);
      emitLog(
        "error",
        "schema migration failed",
        { "schema.from": from, "schema.version": m.version },
        done.error,
      );
      throw new MigrationError(message);
    }
    log(`[db] applied migration ${m.version} ${m.name}`);
  }
  db.exec("COMMIT");
  log(`[db] schema is now at version ${latest}`);
  emitLog("info", "schema migration applied", {
    "schema.from": from,
    "schema.to": latest,
    "schema.migrations": pending.length,
    "schema.backup": backup !== null,
  });
  return { from, to: latest, applied: pending.map((m) => m.name), backup };
}
