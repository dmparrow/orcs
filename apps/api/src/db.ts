import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "orchestrator.db");

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

/** Initialise tables (idempotent). */
function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id              TEXT PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'queued',
      repo_url        TEXT NOT NULL,
      default_branch  TEXT NOT NULL DEFAULT 'main',
      goal            TEXT NOT NULL,
      max_minutes     INTEGER NOT NULL DEFAULT 30,
      approvals_required INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS steps (
      id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES runs(id),
      type            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      seq             INTEGER NOT NULL,
      leased_by       TEXT,
      leased_at       TEXT,
      completed_at    TEXT,
      result_summary  TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id    TEXT NOT NULL REFERENCES runs(id),
      step_id   TEXT,
      ts        TEXT NOT NULL DEFAULT (datetime('now')),
      type      TEXT NOT NULL,
      payload   TEXT NOT NULL DEFAULT '{}'
    );
  `);
}
