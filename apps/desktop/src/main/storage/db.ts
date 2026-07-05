/** SQLite library index (better-sqlite3 — synchronous, embedded, zero-server).
 *  Holds only queryable state; audio blobs live on the filesystem. Rebuildable
 *  by scanning the library folder if ever lost. */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let db: Database.Database | null = null

export function initDb(): Database.Database {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const database = new Database(join(dir, 'timbrel.db'))
  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      artist       TEXT,
      duration_sec REAL,
      content_hash TEXT UNIQUE,
      source_json  TEXT NOT NULL,
      features_json TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      separated_at TEXT
    );
    -- content_hash's UNIQUE constraint already provides an index; the explicit
    -- idx_songs_hash created by earlier versions was a duplicate maintained on
    -- every write for no read benefit.
    DROP INDEX IF EXISTS idx_songs_hash;

    CREATE TABLE IF NOT EXISTS jobs (
      id         TEXT PRIMARY KEY,
      song_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      status     TEXT NOT NULL,
      progress   REAL NOT NULL DEFAULT 0,
      stage      TEXT,
      error      TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- App-global key/value settings (no per-song home). The multi-device
    -- output routing rig lives here (DECISIONS.md → Persistence): global, so
    -- machine-specific device ids never travel into a portable project.json.
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  db = database
  return database
}

export function getDb(): Database.Database {
  if (!db) throw new Error('database not initialized — call initDb() first')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
