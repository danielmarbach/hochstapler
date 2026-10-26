import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  STATE_MIGRATION_CHAIN,
  StoredLobbySchema,
  attemptSync,
  clampSettingsFloors,
  migrateState,
} from "@poly/engine";
import type {
  GameAction,
  GameSettings,
  GameState,
  StateMigrationChain,
  StoredLobby,
} from "@poly/engine";
import { migrateSchema } from "./migrations/schema.ts";
import { dbLoadDuration, dbTimed, dbWriteDuration, emitLog, spanGameId } from "./telemetry.ts";
import type { MigrationReport, SchemaMigration } from "./migrations/schema.ts";
import type { ExpiryPolicy } from "./retention.ts";

export type { StoredLobby, StoredSeat } from "@poly/engine";

export interface GameRow {
  lobby: StoredLobby;
  state: GameState | null;
}

// ---------- runtime schemas for the JSON columns (DB content is a trust boundary too) ----------
// Lobby: StoredLobbySchema; state: GameStateSchema via migrateState (both in the engine, drift-checked).
const RowSchema = z.object({
  lobby_json: z.string(),
  state_json: z.string().nullable(),
  state_version: z.number().int(),
});
const IdRowSchema = z.object({ id: z.string() });
const ExpiredRowSchema = z.object({
  id: z.string(),
  status: z.enum(["lobby", "running", "finished"]),
});
const StatusCountSchema = z.object({
  status: z.enum(["lobby", "running", "finished"]),
  n: z.number(),
});
const NumberRowSchema = z.object({ n: z.number() });

/** Free space (bytes) in the database file from which a VACUUM is worth its (blocking) time; see vacuumIfWorthIt. */
export const DEFAULT_VACUUM_MIN_FREE_BYTES = 1024 * 1024;

export interface ExpiredGame {
  id: string;
  status: "lobby" | "running" | "finished";
}

export interface PurgeResult {
  /** games deleted */
  games: number;
  /** actions deleted together with their games */
  expiredActions: number;
  /** actions trimmed from the games that stay */
  trimmedActions: number;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export type JournalMode = "wal" | "delete";

const JournalModeSchema = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(["wal", "delete"]));

/**
 * SQLITE_JOURNAL_MODE: `wal` (default) or `delete`. WAL needs shared memory and is unsafe on network file systems;
 * `delete` (rollback journal) is for Azure Files / SMB (docs/DESIGN.md #51). Anything else is refused at startup.
 */
export function loadJournalMode(env: NodeJS.ProcessEnv): JournalMode {
  const raw = env["SQLITE_JOURNAL_MODE"];
  return raw === undefined || raw === "" ? "wal" : JournalModeSchema.parse(raw);
}

export interface DbOptions {
  /** `wal` (default) or `delete` (network file systems); see loadJournalMode */
  journalMode?: JournalMode;
  /** schema migrations to apply (tests inject failing ones); defaults to SCHEMA_MIGRATIONS */
  migrations?: readonly SchemaMigration[];
  /** state migration chain used on load; defaults to the engine's */
  stateChain?: StateMigrationChain;
  /** raise stored settings to the floors on load (default true; docs/DESIGN.md #61). Off only for test mode / tests. */
  clampSettings?: boolean;
  log?: (message: string) => void;
  now?: () => Date;
  /** VACUUM after a sweep only when at least this many bytes are free (default 1 MiB) */
  vacuumMinFreeBytes?: number;
}

export class Db {
  private db: DatabaseSync;
  private readonly stateChain: StateMigrationChain;
  private readonly clampSettings: boolean;
  private readonly log: (message: string) => void;
  private readonly vacuumMinFreeBytes: number;
  /** What the startup schema migration did (from/to version, backup path). */
  readonly migration: MigrationReport;

  /** Opens the database and brings its schema up to date; throws MigrationError (refuse to start). */
  constructor(dataDir: string, opts: DbOptions = {}) {
    const inMemory = dataDir === ":memory:";
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- DATA_DIR is operator config, not request input
    if (!inMemory) mkdirSync(dataDir, { recursive: true });
    const dbFile = inMemory ? null : join(dataDir, "games.sqlite");
    this.stateChain = opts.stateChain ?? STATE_MIGRATION_CHAIN;
    this.clampSettings = opts.clampSettings ?? true;
    this.log = opts.log ?? ((m: string) => console.error(m));
    this.vacuumMinFreeBytes = opts.vacuumMinFreeBytes ?? DEFAULT_VACUUM_MIN_FREE_BYTES;
    this.db = new DatabaseSync(dbFile ?? ":memory:");
    const migrated = attemptSync("db:migrate", () => {
      // the value comes from a closed enum (JournalMode), never from request input
      this.db.exec(`PRAGMA journal_mode = ${(opts.journalMode ?? "wal").toUpperCase()}`);
      const migrateOpts: Parameters<typeof migrateSchema>[1] = { dbFile };
      if (opts.migrations) migrateOpts.migrations = opts.migrations;
      if (opts.now) migrateOpts.now = opts.now;
      if (opts.log) migrateOpts.log = opts.log;
      return migrateSchema(this.db, migrateOpts);
    });
    if (!migrated.ok) {
      this.db.close();
      throw migrated.error;
    }
    this.migration = migrated.value;
  }

  /**
   * `activityAt` = time of the last HUMAN activity behind this save (docs/DESIGN.md #57). Saves caused by bots and
   * timers omit it: they update `updated_at` only, so a bot-heavy game still expires. A new game starts "active".
   */
  save(lobby: StoredLobby, state: GameState | null, activityAt?: number): void {
    dbTimed("save", dbWriteDuration, () => this.saveRow(lobby, state, activityAt));
  }

  private saveRow(
    lobby: StoredLobby,
    state: GameState | null,
    activityAt: number | undefined,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO games (id, invite_code, lobby_json, state_json, state_version, status, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET invite_code=excluded.invite_code, lobby_json=excluded.lobby_json,
           state_json=excluded.state_json, state_version=excluded.state_version,
           status=excluded.status, updated_at=excluded.updated_at,
           last_activity_at=CASE WHEN ? THEN excluded.last_activity_at ELSE games.last_activity_at END`,
      )
      .run(
        lobby.gameId,
        lobby.inviteCode,
        JSON.stringify(lobby),
        state ? JSON.stringify(state) : null,
        this.stateChain.current,
        lobby.status,
        now,
        activityAt ?? now,
        activityAt === undefined ? 0 : 1,
      );
  }

  /** A seated human opened the game (no state change): counts as activity. */
  touchActivity(gameId: string, at: number): void {
    this.db.prepare("UPDATE games SET last_activity_at = ? WHERE id = ?").run(at, gameId);
  }

  lastActivity(gameId: string): number | null {
    const row = this.db.prepare("SELECT last_activity_at AS n FROM games WHERE id = ?").get(gameId);
    return row === undefined ? null : NumberRowSchema.parse(row).n;
  }

  /** Versions of the logged actions of a game, oldest first (tests / diagnostics). */
  actionVersions(gameId: string): number[] {
    return this.db
      .prepare("SELECT version AS n FROM actions WHERE game_id = ? ORDER BY rowid")
      .all(gameId)
      .map((r) => NumberRowSchema.parse(r).n);
  }

  /** Games whose last human activity is longer ago than the limit of their status. */
  expiredGames(policy: ExpiryPolicy, now: number): ExpiredGame[] {
    return this.db
      .prepare(
        `SELECT id, status FROM games WHERE
           (status = 'lobby' AND last_activity_at < ?1) OR
           (status = 'finished' AND last_activity_at < ?2) OR
           (status = 'running' AND last_activity_at < ?3)
         ORDER BY id`,
      )
      .all(now - policy.lobbyMs, now - policy.finishedMs, now - policy.runningMs)
      .map((r) => ExpiredRowSchema.parse(r));
  }

  /**
   * One transaction: delete the given games with their actions, then trim every remaining game's action log to
   * its newest `keep` entries. The log is write-only traceability (games load from the snapshot in `games`),
   * so nothing replays it. All or nothing: on an error the database is unchanged.
   */
  purge(ids: readonly string[], keep: number): PurgeResult {
    const result: PurgeResult = { games: 0, expiredActions: 0, trimmedActions: 0 };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const delActions = this.db.prepare("DELETE FROM actions WHERE game_id = ?");
      const delGame = this.db.prepare("DELETE FROM games WHERE id = ?");
      for (const id of ids) {
        result.expiredActions += Number(delActions.run(id).changes);
        result.games += Number(delGame.run(id).changes);
      }
      const over = this.db
        .prepare("SELECT game_id AS id FROM actions GROUP BY game_id HAVING count(*) > ?")
        .all(keep)
        .map((r) => IdRowSchema.parse(r).id);
      // rowid = insertion order; the keep-th newest row is the oldest one that stays
      const trim = this.db.prepare(
        `DELETE FROM actions WHERE game_id = ?1 AND rowid <
           (SELECT rowid FROM actions WHERE game_id = ?1 ORDER BY rowid DESC LIMIT 1 OFFSET ?2)`,
      );
      for (const id of over) result.trimmedActions += Number(trim.run(id, keep - 1).changes);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return result;
  }

  /** Bytes inside the file that belong to no table (freed pages that VACUUM would give back). */
  freeBytes(): number {
    const pages = z
      .object({ freelist_count: z.number() })
      .parse(this.db.prepare("PRAGMA freelist_count").get()).freelist_count;
    const size = z
      .object({ page_size: z.number() })
      .parse(this.db.prepare("PRAGMA page_size").get()).page_size;
    return pages * size;
  }

  /**
   * VACUUM rewrites the whole file (blocking, and ~50 ms per write on Azure Files), so it only runs once the freed
   * space is worth it. Returns whether it ran.
   */
  vacuumIfWorthIt(): boolean {
    if (this.freeBytes() < this.vacuumMinFreeBytes) return false;
    this.db.exec("VACUUM");
    return true;
  }

  logAction(
    gameId: string,
    version: number,
    playerId: string,
    action: GameAction | { type: string },
    at: number,
  ): void {
    dbTimed("append_action", dbWriteDuration, () =>
      this.insertAction(gameId, version, playerId, action, at),
    );
  }

  private insertAction(
    gameId: string,
    version: number,
    playerId: string,
    action: GameAction | { type: string },
    at: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO actions (game_id, version, player_id, action_json, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(gameId, version, playerId, JSON.stringify(action), at);
  }

  /**
   * Returns null for unknown ids and for rows that cannot be used (invalid JSON/schema, state from a
   * newer version): those are logged and left untouched in the database, never overwritten.
   * Older state versions are migrated in memory; the row is rewritten by the next save().
   */
  load(id: string): GameRow | null {
    return dbTimed("load", dbLoadDuration, () => this.loadRow(id));
  }

  private loadRow(id: string): GameRow | null {
    const raw = this.db
      .prepare("SELECT lobby_json, state_json, state_version FROM games WHERE id = ?")
      .get(id);
    if (raw === undefined) return null;
    try {
      return this.parseRow(RowSchema.parse(raw));
    } catch (e) {
      const detail =
        e instanceof z.ZodError
          ? e.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : e instanceof Error
            ? e.message
            : String(e);
      this.log(`[db] game ${id} is unavailable (row left untouched): ${detail}`);
      emitLog(
        "warn",
        "stored game is unavailable, row left untouched",
        { "game.id": spanGameId(id) },
        e,
      );
      return null;
    }
  }

  runningIds(): string[] {
    return this.db
      .prepare("SELECT id FROM games WHERE status = 'running'")
      .all()
      .flatMap((r) => {
        const p = IdRowSchema.safeParse(r);
        return p.success ? [p.data.id] : [];
      });
  }

  /** Stored games per status (the caps of docs/DESIGN.md #59 count stored games, not only loaded rooms). */
  countByStatus(): Record<"lobby" | "running" | "finished", number> {
    const out = { lobby: 0, running: 0, finished: 0 };
    const rows = this.db.prepare("SELECT status, COUNT(*) AS n FROM games GROUP BY status").all();
    for (const r of rows) {
      const p = StatusCountSchema.safeParse(r);
      if (p.success) out[p.data.status] = p.data.n;
    }
    return out;
  }

  exists(id: string): boolean {
    return !!this.db.prepare("SELECT 1 AS x FROM games WHERE id = ?").get(id);
  }

  close(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
    this.db.close();
  }

  private parseRow(r: z.infer<typeof RowSchema>): GameRow {
    const parsed = StoredLobbySchema.parse(parseJson(r.lobby_json));
    // games stored before the settings floors (docs/DESIGN.md #61) are raised to them; the next save() writes them back
    const floor = (s: GameSettings): GameSettings =>
      this.clampSettings ? clampSettingsFloors(s) : s;
    const lobby = { ...parsed, settings: floor(parsed.settings) };
    const migrated = r.state_json
      ? migrateState(parseJson(r.state_json), r.state_version, this.stateChain)
      : null;
    const state = migrated && { ...migrated, settings: floor(migrated.settings) };
    return { lobby, state };
  }
}
