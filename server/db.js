import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'app.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL,
  ordinal INT NOT NULL,
  track TEXT NOT NULL CHECK(track IN ('sql','de')),
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK(difficulty IN ('foundation','intermediate','advanced')),
  topics TEXT NOT NULL DEFAULT '[]',
  statement TEXT NOT NULL,
  schema_sql TEXT,
  hints TEXT NOT NULL DEFAULT '[]',
  rubric TEXT,
  reference_answer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id),
  answer TEXT NOT NULL,
  score INT,
  verdict TEXT,
  strengths TEXT,
  gaps TEXT,
  improved_answer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS practice_days (
  date_key TEXT PRIMARY KEY,
  completed INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS topic_stats (
  topic TEXT PRIMARY KEY,
  track TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  total_score INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_sources (
  date_key TEXT PRIMARY KEY,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openai_sub TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  picture TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  plan_scope_granted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_challenges_date ON challenges(date_key);
CREATE INDEX IF NOT EXISTS idx_attempts_challenge ON attempts(challenge_id);
`);

export function configGet(key) {
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
  return row ? row.value : null;
}

export function configSet(key, value) {
  db.prepare(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export default db;
