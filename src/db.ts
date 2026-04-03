import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR } from './memory.js';

const DB_PATH = path.join(DATA_DIR, 'app.sqlite');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized — call initDb() first');
  return _db;
}

export function initDb(): void {
  if (_db) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      expression  TEXT    NOT NULL,
      prompt      TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      enabled     INTEGER DEFAULT 1,
      last_run    TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_state (
      chat_id         TEXT PRIMARY KEY,
      last_message_id TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
