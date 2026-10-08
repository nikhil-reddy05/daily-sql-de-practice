import db from './db.js';

const ORDER = ['foundation', 'intermediate', 'advanced'];

function bump(d) {
  const i = ORDER.indexOf(d);
  return ORDER[Math.min(i + 1, ORDER.length - 1)];
}

// Average score per track across all recorded topics (null when no data).
export function trackAverage(track) {
  const row = db
    .prepare(
      `SELECT SUM(attempts) AS a, SUM(total_score) AS s FROM topic_stats WHERE track = ?`
    )
    .get(track);
  if (!row || !row.a) return null;
  return row.s / row.a;
}

// Recommended difficulty for the next set on a track:
// avg >= 80 → advanced, >= 60 → intermediate, else foundation.
export function recommendedDifficulty(track) {
  const avg = trackAverage(track);
  if (avg == null) return 'foundation';
  if (avg >= 80) return 'advanced';
  if (avg >= 60) return 'intermediate';
  return 'foundation';
}

// Difficulty mix for a 2-problem set: [recommended, one notch harder].
// With no history this yields [foundation, intermediate] — the default.
export function difficultyMix(track) {
  const rec = recommendedDifficulty(track);
  return [rec, bump(rec)];
}

// Topics with avg < 60 over 2+ attempts — the generation prompt drills these.
export function weakTopics(limit = 6) {
  return db
    .prepare(
      `SELECT topic, track, attempts,
              CAST(total_score AS REAL) / attempts AS avg
       FROM topic_stats
       WHERE attempts >= 2 AND CAST(total_score AS REAL) / attempts < 60
       ORDER BY avg ASC
       LIMIT ?`
    )
    .all(limit);
}

// Titles of the most recent N challenges, to avoid repetition.
export function recentTitles(limit = 20) {
  return db
    .prepare(`SELECT title FROM challenges ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map((r) => r.title);
}

// Full topic table for the Progress view.
export function topicTable() {
  return db
    .prepare(
      `SELECT topic, track, attempts,
              CAST(total_score AS REAL) / attempts AS avg
       FROM topic_stats
       ORDER BY avg ASC`
    )
    .all();
}
