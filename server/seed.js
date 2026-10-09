import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(readFileSync(join(here, '..', 'data', 'seed-bank.json'), 'utf8'));

const sqlBank = bank.filter((e) => e.track === 'sql');
const deBank = bank.filter((e) => e.track === 'de');

export const SEED_BANK_SIZES = { sql: sqlBank.length, de: deBank.length };

export function seedTitles() {
  return bank.map((e) => e.title);
}

function pick(bankArr, n, offset) {
  const out = [];
  if (bankArr.length === 0) return out;
  for (let i = 0; i < n; i++) out.push(bankArr[(offset + i) % bankArr.length]);
  return out;
}

// Build a seed set for a date: counts = { sql: n, de: n } problems per track,
// offsets = { sql, de } rotation offsets (persisted by the caller) so that
// consecutive seed-generated days don't repeat problems when counts wrap
// around the bank.
export function seedSetFor(dateKey, counts = { sql: 2, de: 2 }, offsets = { sql: 0, de: 0 }) {
  const problems = [
    ...pick(sqlBank, counts.sql, offsets.sql),
    ...pick(deBank, counts.de, offsets.de),
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
