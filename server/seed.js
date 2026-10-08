import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(readFileSync(join(here, '..', 'data', 'seed-bank.json'), 'utf8'));

const sqlBank = bank.filter((e) => e.track === 'sql');
const deBank = bank.filter((e) => e.track === 'de');

// 4 rotating day-sets of 2 SQL + 2 DE, in bank order.
const SETS = [
  { sql: [0, 1], de: [0, 1] },
  { sql: [2, 3], de: [2, 3] },
  { sql: [4, 5], de: [4, 5] },
  { sql: [6, 7], de: [6, 7] },
];

const EPOCH = '2026-10-08';

function daysSinceEpoch(dateKey) {
  const ms = Date.parse(dateKey + 'T00:00:00Z') - Date.parse(EPOCH + 'T00:00:00Z');
  return Math.floor(ms / 86400000);
}

export function seedSetFor(dateKey) {
  const idx = ((daysSinceEpoch(dateKey) % SETS.length) + SETS.length) % SETS.length;
  const set = SETS[idx];
  const problems = [
    ...set.sql.map((i) => sqlBank[i]),
    ...set.de.map((i) => deBank[i]),
  ];
  return problems.map((p, ordinal) => ({
    date_key: dateKey,
    ordinal,
    track: p.track,
    title: p.title,
    difficulty: p.difficulty,
    topics: p.topics,
    statement: p.statement,
    schema_sql: p.schema_sql,
    hints: p.hints,
    rubric: p.rubric,
    reference_answer: p.reference_answer,
  }));
}
