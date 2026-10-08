import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../crypto.js';
import { seedSetFor } from '../seed.js';
import { recommendedDifficulty } from '../adaptive.js';

// Use an env key so tests never touch the persisted config key.
process.env.TOKENS_KEY = 'test-only-key-do-not-use';

test('encryptToken/decryptToken round-trip', () => {
  const ct = encryptToken('secret-token-value');
  assert.notEqual(ct, 'secret-token-value');
  assert.equal(decryptToken(ct), 'secret-token-value');
});

test('seed rotation: 4 distinct day-sets in bank order', () => {
  const s0 = seedSetFor('2026-10-08');
  const s1 = seedSetFor('2026-10-09');
  const s3 = seedSetFor('2026-10-11');
  const s4 = seedSetFor('2026-10-12'); // wraps to set 0
  for (const s of [s0, s1, s3, s4]) {
    assert.equal(s.length, 4);
    assert.equal(s.filter((p) => p.track === 'sql').length, 2);
    assert.equal(s.filter((p) => p.track === 'de').length, 2);
  }
  assert.deepEqual(
    s0.map((p) => p.title),
    s4.map((p) => p.title)
  );
  assert.notDeepEqual(
    s0.map((p) => p.title),
    s1.map((p) => p.title)
  );
  assert.equal(s0[0].title, 'Top Earners Per Department');
  assert.equal(s0[2].track, 'de');
});

test('recommendedDifficulty defaults to foundation with no history', () => {
  // Read-only check against a fresh DB state for unknown track averages;
  // with no attempts recorded, both tracks default to foundation.
  assert.equal(recommendedDifficulty('sql'), 'foundation');
  assert.equal(recommendedDifficulty('de'), 'foundation');
});
