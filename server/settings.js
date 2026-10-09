// User practice settings: track toggles + per-track daily question counts.
// Stored in the `settings` table as strings; parsed/validated here.

import db from './db.js';

const DEFAULTS = {
  sql_enabled: '1',
  de_enabled: '1',
  sql_count: '2',
  de_count: '2',
  seed_offset_sql: '0',
  seed_offset_de: '0',
};

function rawGet(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}

function rawSet(key, value) {
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
}

// Parsed settings plus effective per-track counts (disabled track → 0).
export function getSettings() {
  const sql_enabled = toBool(rawGet('sql_enabled'));
  const de_enabled = toBool(rawGet('de_enabled'));
  const sql_count = toInt(rawGet('sql_count'), 2);
  const de_count = toInt(rawGet('de_count'), 2);
  return {
    sql_enabled,
    de_enabled,
    sql_count,
    de_count,
    sqlCount: sql_enabled ? sql_count : 0,
    deCount: de_enabled ? de_count : 0,
  };
}

function parseBoolField(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  return undefined; // invalid
}

function parseCountField(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10) return undefined;
  return n;
}

// Validate a PUT /api/settings body. Returns { ok: true, settings } with
// normalized values, or { ok: false, error }.
export function validateSettingsUpdate(body) {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Settings body must be an object' };
  }
  const sql_enabled = parseBoolField(body.sql_enabled);
  const de_enabled = parseBoolField(body.de_enabled);
  const sql_count = parseCountField(body.sql_count);
  const de_count = parseCountField(body.de_count);
  if (sql_enabled === undefined) return { ok: false, error: 'sql_enabled must be a boolean' };
  if (de_enabled === undefined) return { ok: false, error: 'de_enabled must be a boolean' };
  if (sql_count === undefined)
    return { ok: false, error: 'sql_count must be an integer between 0 and 10' };
  if (de_count === undefined)
    return { ok: false, error: 'de_count must be an integer between 0 and 10' };

  const effSql = sql_enabled ? sql_count : 0;
  const effDe = de_enabled ? de_count : 0;
  if (effSql + effDe < 1) {
    return {
      ok: false,
      error: 'At least one track must be enabled with at least 1 question per day',
    };
  }
  return { ok: true, settings: { sql_enabled, de_enabled, sql_count, de_count } };
}

export function updateSettings(s) {
  rawSet('sql_enabled', s.sql_enabled ? '1' : '0');
  rawSet('de_enabled', s.de_enabled ? '1' : '0');
  rawSet('sql_count', String(s.sql_count));
  rawSet('de_count', String(s.de_count));
}

// Rotation offsets for the seed-bank fallback, so consecutive seed-generated
// days don't repeat problems when counts wrap around the bank.
export function getSeedOffsets() {
  return {
    sql: toInt(rawGet('seed_offset_sql'), 0),
    de: toInt(rawGet('seed_offset_de'), 0),
  };
}

export function setSeedOffsets(o) {
  rawSet('seed_offset_sql', String(o.sql));
  rawSet('seed_offset_de', String(o.de));
}
