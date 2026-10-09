import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../crypto.js';
import { seedSetFor, SEED_BANK_SIZES } from '../seed.js';
import { recommendedDifficulty, difficultyMixN } from '../adaptive.js';
import { validateSettingsUpdate } from '../settings.js';
import { validateGeneration, buildGenerationPrompt } from '../prompts.js';

// Use an env key so tests never touch the persisted config key.
process.env.TOKENS_KEY = 'test-only-key-do-not-use';

test('encryptToken/decryptToken round-trip', () => {
  const ct = encryptToken('secret-token-value');
  assert.notEqual(ct, 'secret-token-value');
  assert.equal(decryptToken(ct), 'secret-token-value');
});

test('seedSetFor: default 2+2 in bank order', () => {
  const s = seedSetFor('2026-10-08', { sql: 2, de: 2 }, { sql: 0, de: 0 });
  assert.equal(s.length, 4);
  assert.equal(s.filter((p) => p.track === 'sql').length, 2);
  assert.equal(s.filter((p) => p.track === 'de').length, 2);
  assert.equal(s[0].title, 'Top Earners Per Department');
  assert.equal(s[2].track, 'de');
  assert.deepEqual(
    s.map((p, i) => p.ordinal),
    [0, 1, 2, 3]
  );
});

test('seedSetFor: variable counts and SQL-only mode', () => {
  const s = seedSetFor('2026-10-08', { sql: 3, de: 0 }, { sql: 0, de: 0 });
  assert.equal(s.length, 3);
  assert.ok(s.every((p) => p.track === 'sql'));
});

test('seedSetFor: offsets rotate and wrap around the bank', () => {
  const n = SEED_BANK_SIZES.sql; // 8
  const a = seedSetFor('2026-10-08', { sql: 2, de: 0 }, { sql: 0, de: 0 });
  const b = seedSetFor('2026-10-09', { sql: 2, de: 0 }, { sql: 2, de: 0 });
  assert.notDeepEqual(a.map((p) => p.title), b.map((p) => p.title));
  // Wrapping: 10 requested from a bank of 8 → first 8 then first 2 again.
  const w = seedSetFor('2026-10-10', { sql: 10, de: 0 }, { sql: 0, de: 0 });
  assert.equal(w.length, 10);
  assert.deepEqual(
    w.slice(0, n).map((p) => p.title),
    a.concat(seedSetFor('x', { sql: 6, de: 0 }, { sql: 2, de: 0 })).map((p) => p.title)
  );
  assert.equal(w[8].title, a[0].title);
  assert.equal(w[9].title, a[1].title);
});

test('recommendedDifficulty defaults to foundation with no history', () => {
  // Read-only check against a fresh DB state for unknown track averages;
  // with no attempts recorded, both tracks default to foundation.
  assert.equal(recommendedDifficulty('sql'), 'foundation');
  assert.equal(recommendedDifficulty('de'), 'foundation');
});

test('difficultyMixN: variable-length mixes', () => {
  assert.deepEqual(difficultyMixN('sql', 0), []);
  assert.deepEqual(difficultyMixN('sql', 1), ['foundation']);
  assert.deepEqual(difficultyMixN('sql', 2), ['foundation', 'intermediate']);
  assert.deepEqual(difficultyMixN('sql', 3), ['foundation', 'intermediate', 'foundation']);
});

test('validateSettingsUpdate: accepts valid bodies', () => {
  const ok = validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 2, de_count: 2, sql_dialect: 'PostgreSQL 15' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.settings, { sql_enabled: true, de_enabled: true, sql_count: 2, de_count: 2, sql_dialect: 'PostgreSQL 15' });
  // SQL-only mode
  const sqlOnly = validateSettingsUpdate({ sql_enabled: true, de_enabled: false, sql_count: 3, de_count: 0, sql_dialect: 'Snowflake' });
  assert.equal(sqlOnly.ok, true);
  // String coercions from form-style bodies
  const str = validateSettingsUpdate({ sql_enabled: '1', de_enabled: '0', sql_count: '5', de_count: '0', sql_dialect: 'MySQL 8' });
  assert.equal(str.ok, true);
  assert.deepEqual(str.settings, { sql_enabled: true, de_enabled: false, sql_count: 5, de_count: 0, sql_dialect: 'MySQL 8' });
});

test('validateSettingsUpdate: accepts every whitelisted dialect', () => {
  for (const d of ['PostgreSQL 15', 'MySQL 8', 'SQL Server (T-SQL)', 'Snowflake', 'Google BigQuery', 'SQLite']) {
    const r = validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 2, de_count: 2, sql_dialect: d });
    assert.equal(r.ok, true, `dialect ${d} should be accepted`);
    assert.equal(r.settings.sql_dialect, d);
  }
});

test('validateSettingsUpdate: rejects invalid bodies', () => {
  const base = { sql_dialect: 'PostgreSQL 15' };
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 11, de_count: 2, ...base }).ok, false);
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: -1, de_count: 2, ...base }).ok, false);
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 2.5, de_count: 2, ...base }).ok, false);
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 'x', de_count: 2, ...base }).ok, false);
  // both tracks disabled
  assert.equal(validateSettingsUpdate({ sql_enabled: false, de_enabled: false, sql_count: 2, de_count: 2, ...base }).ok, false);
  // both counts zero
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 0, de_count: 0, ...base }).ok, false);
  // enabled track with zero count and everything else off
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: false, sql_count: 0, de_count: 0, ...base }).ok, false);
  // missing fields
  assert.equal(validateSettingsUpdate({ sql_enabled: true }).ok, false);
  // not an object
  assert.equal(validateSettingsUpdate(null).ok, false);
  // unknown dialect
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 2, de_count: 2, sql_dialect: 'Oracle 21c' }).ok, false);
  // missing dialect
  assert.equal(validateSettingsUpdate({ sql_enabled: true, de_enabled: true, sql_count: 2, de_count: 2 }).ok, false);
});

test('validateGeneration: enforces per-track counts', () => {
  const mk = (n, track) =>
    Array.from({ length: n }, (_, i) => ({
      title: `${track} ${i}`,
      difficulty: 'foundation',
      topics: ['t'],
      statement: 's',
      ...(track === 'sql' ? { schema_sql: 'create table x;' } : {}),
      hints: ['h1', 'h2', 'h3'],
      rubric: 'r',
      reference_answer: 'a',
    }));
  const good = validateGeneration({ sql: mk(3, 'sql'), de: mk(1, 'de') }, { sql: 3, de: 1 });
  assert.equal(good.sql.length, 3);
  assert.equal(good.de.length, 1);
  // disabled track → empty array required
  const sqlOnly = validateGeneration({ sql: mk(2, 'sql'), de: [] }, { sql: 2, de: 0 });
  assert.equal(sqlOnly.de.length, 0);
  assert.throws(() => validateGeneration({ sql: mk(2, 'sql'), de: mk(1, 'de') }, { sql: 2, de: 0 }));
  assert.throws(() => validateGeneration({ sql: mk(1, 'sql'), de: [] }, { sql: 2, de: 0 }));
});

test('buildGenerationPrompt: requests exact per-track counts', () => {
  const p = buildGenerationPrompt({
    mix: { sql: ['foundation', 'intermediate', 'foundation'], de: [] },
    weakTopics: [],
    avoidTitles: [],
    counts: { sql: 3, de: 0 },
  });
  assert.ok(p.includes('exactly 3 ORIGINAL'));
  assert.ok(p.includes('"sql": [ exactly 3 SQL problem object(s) ]'));
  assert.ok(p.includes('"de": [ exactly 0 data-engineering problem object(s) ]'));
  assert.ok(p.includes('PostgreSQL 15')); // default dialect
});

test('buildGenerationPrompt: honors the selected dialect', () => {
  const base = {
    mix: { sql: ['foundation', 'intermediate'], de: [] },
    weakTopics: [],
    avoidTitles: [],
    counts: { sql: 2, de: 0 },
  };
  const snow = buildGenerationPrompt({ ...base, dialect: 'Snowflake' });
  assert.ok(snow.includes('Snowflake'));
  assert.ok(snow.includes('Snowflake syntax ONLY'));
  assert.ok(!snow.includes('PostgreSQL 15'), 'must not hardcode PostgreSQL when another dialect is chosen');
  const def = buildGenerationPrompt(base);
  assert.ok(def.includes('PostgreSQL 15 syntax ONLY'));
});
