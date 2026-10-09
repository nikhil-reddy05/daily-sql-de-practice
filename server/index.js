import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { chat, isConfigured, aiStatus } from './ai.js';
import {
  buildGenerationPrompt,
  buildReviewPrompt,
  validateGeneration,
  validateReview,
} from './prompts.js';
import {
  difficultyMixN,
  recommendedDifficulty,
  weakTopics,
  recentTitles,
  topicTable,
  trackAverage,
} from './adaptive.js';
import { seedSetFor, seedTitles, SEED_BANK_SIZES } from './seed.js';
import {
  getSettings,
  validateSettingsUpdate,
  updateSettings,
  getSeedOffsets,
  setSeedOffsets,
} from './settings.js';
import {
  buildAuthorizeUrl,
  handleCallback,
  getSessionUser,
  setSessionCookie,
  clearSessionCookie,
  clearUserTokens,
  disconnectUser,
  pausePlan,
  isPlanPaused,
  publicUser,
  redirectUri,
  validateOpenIdConfiguration,
} from './auth.js';
import { planComplete, planModel, PlanError, MANAGE_USAGE_URL } from './planClient.js';
import { cryptoBootWarnings } from './crypto.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || '';

cryptoBootWarnings();
validateOpenIdConfiguration();

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rowToChallenge(row) {
  return {
    id: row.id,
    ordinal: row.ordinal,
    track: row.track,
    title: row.title,
    difficulty: row.difficulty,
    topics: JSON.parse(row.topics || '[]'),
    statement: row.statement,
    schema_sql: row.schema_sql,
    hints: JSON.parse(row.hints || '[]'),
    rubric: row.rubric,
  };
}

function getAttempts(challengeId) {
  return db
    .prepare(
      `SELECT id, answer, score, verdict, strengths, gaps, improved_answer, created_at
       FROM attempts WHERE challenge_id = ? ORDER BY id DESC`
    )
    .all(challengeId)
    .map((a) => ({
      ...a,
      strengths: a.strengths ? JSON.parse(a.strengths) : [],
      gaps: a.gaps ? JSON.parse(a.gaps) : [],
    }));
}

function getDay(dateKey) {
  const rows = db
    .prepare(`SELECT * FROM challenges WHERE date_key = ? ORDER BY ordinal ASC`)
    .all(dateKey);
  return rows.map((r) => ({ ...rowToChallenge(r), attempts: getAttempts(r.id) }));
}

function insertChallenge(c) {
  const info = db
    .prepare(
      `INSERT INTO challenges
       (date_key, ordinal, track, title, difficulty, topics, statement, schema_sql, hints, rubric, reference_answer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      c.date_key,
      c.ordinal,
      c.track,
      c.title,
      c.difficulty,
      JSON.stringify(c.topics),
      c.statement,
      c.schema_sql,
      JSON.stringify(c.hints),
      c.rubric,
      c.reference_answer
    );
  return Number(info.lastInsertRowid);
}

// Unified AI routing: ChatGPT plan (signed-in user) → API-key fallback → none.
// Returns { data, via: 'plan'|'key'|null, planNotice? }.
async function aiCompleteJson(prompt, req) {
  const user = getSessionUser(req);
  const planReady =
    user && user.access_token && user.plan_scope_granted === 1 && !isPlanPaused(user.id);

  if (planReady) {
    try {
      const data = await planComplete(prompt, { json: true, userId: user.id });
      return { data, via: 'plan' };
    } catch (err) {
      if (err instanceof PlanError) {
        if (err.code === 'cap_reached') pausePlan(user.id);
        if (err.code === 'invalid_user') clearUserTokens(user.id);
        const notice = {
          type: err.code,
          message: err.message,
          manageUrl: err.code === 'cap_reached' ? MANAGE_USAGE_URL : undefined,
        };
        // Fall through to API-key fallback if available.
        if (isConfigured()) {
          try {
            const data = await chat(prompt, { json: true });
            return { data, via: 'key', planNotice: notice };
          } catch {
            return { data: null, via: null, planNotice: notice };
          }
        }
        return { data: null, via: null, planNotice: notice };
      }
      throw err;
    }
  }

  if (isConfigured()) {
    const data = await chat(prompt, { json: true });
    return { data, via: 'key' };
  }
  return { data: null, via: null };
}

async function generateWithAI(dateKey, req) {
  const s = getSettings();
  const counts = { sql: s.sqlCount, de: s.deCount };
  if (counts.sql + counts.de < 1) throw new Error('No questions enabled in settings');
  const mix = { sql: difficultyMixN('sql', counts.sql), de: difficultyMixN('de', counts.de) };
  // Only drill weak topics on tracks that are actually enabled.
  const weak = weakTopics().filter((w) =>
    w.track === 'sql' ? s.sql_enabled : s.de_enabled
  );
  const prompt = buildGenerationPrompt({
    mix,
    weakTopics: weak,
    avoidTitles: recentTitles(20),
    counts,
    dialect: s.sql_dialect,
  });
  let lastErr = null;
  let planNotice;
  // Two attempts: retry once on validation failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await aiCompleteJson(prompt, req);
    if (r.planNotice) planNotice = r.planNotice;
    if (!r.data) {
      lastErr = new Error('No AI provider available');
      break;
    }
    try {
      const validated = validateGeneration(r.data, counts);
      const problems = [
        ...validated.sql.map((p) => ({ ...p, track: 'sql' })),
        ...validated.de.map((p) => ({ ...p, track: 'de' })),
      ];
      problems.forEach((p, ordinal) => insertChallenge({ ...p, date_key: dateKey, ordinal }));
      const src = r.via === 'plan' ? 'ai-plan' : 'ai-key';
      recordDaySource(dateKey, src);
      return { source: src, planNotice };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('AI generation failed');
}

function generateFromSeed(dateKey) {
  const s = getSettings();
  const counts = { sql: s.sqlCount, de: s.deCount };
  const offsets = getSeedOffsets();
  seedSetFor(dateKey, counts, offsets).forEach((c) => insertChallenge(c));
  // Advance the rotation offsets so the next seed-generated day continues
  // where this one left off instead of repeating problems.
  setSeedOffsets({
    sql: (offsets.sql + counts.sql) % Math.max(1, SEED_BANK_SIZES.sql),
    de: (offsets.de + counts.de) % Math.max(1, SEED_BANK_SIZES.de),
  });
  recordDaySource(dateKey, 'seed');
  return 'seed';
}

async function ensureToday(dateKey, req) {
  const existing = getDay(dateKey);
  if (existing.length > 0) {
    return { challenges: existing, source: detectSource(dateKey), planNotice: undefined };
  }
  let source = 'seed';
  let planNotice;
  try {
    const r = await generateWithAI(dateKey, req);
    source = r.source;
    planNotice = r.planNotice;
  } catch (err) {
    console.error('AI generation failed, falling back to seed bank:', err.message);
    source = generateFromSeed(dateKey);
  }
  return { challenges: getDay(dateKey), source, planNotice };
}

function recordDaySource(dateKey, source) {
  db.prepare(
    `INSERT INTO day_sources (date_key, source) VALUES (?, ?)
     ON CONFLICT(date_key) DO UPDATE SET source = excluded.source`
  ).run(dateKey, source);
}

function detectSource(dateKey) {
  const row = db.prepare(`SELECT source FROM day_sources WHERE date_key = ?`).get(dateKey);
  if (row) return row.source;
  // Legacy fallback for sets generated before source tracking: if every
  // title comes from the seed bank, call it 'seed'.
  const rows = db.prepare(`SELECT title FROM challenges WHERE date_key = ?`).all(dateKey);
  if (rows.length === 0) return 'seed';
  const seed = new Set(seedTitles());
  return rows.every((r) => seed.has(r.title)) ? 'seed' : 'ai';
}

function refreshPracticeDay(dateKey) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT a.challenge_id) AS n
       FROM attempts a JOIN challenges c ON c.id = a.challenge_id
       WHERE c.date_key = ?`
    )
    .get(dateKey);
  db.prepare(
    `INSERT INTO practice_days (date_key, completed) VALUES (?, ?)
     ON CONFLICT(date_key) DO UPDATE SET completed = excluded.completed`
  ).run(dateKey, row.n);
}

function authState(req) {
  const user = getSessionUser(req);
  return {
    signedIn: !!user?.access_token,
    planScopeGranted: user?.plan_scope_granted === 1,
    planPaused: user ? isPlanPaused(user.id) : false,
    user: publicUser(user && user.access_token ? user : null),
  };
}

// ---- Auth (Sign in with ChatGPT) ----

app.get('/api/auth/login', (req, res) => {
  try {
    const url = buildAuthorizeUrl({ port: PORT, appUrl: APP_URL });
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`Could not start sign-in: ${err.message}`);
  }
});

app.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) throw new Error(`Sign-in failed: ${error_description || error}`);
    if (!code || !state) throw new Error('Missing code/state in callback');
    const user = await handleCallback({
      code: String(code),
      state: String(state),
      port: PORT,
      appUrl: APP_URL,
    });
    setSessionCookie(res, user.id);
    res.redirect('/?auth=ok');
  } catch (err) {
    console.error('OAuth callback failed:', err.message);
    res.redirect(`/?auth=error&msg=${encodeURIComponent(err.message)}`);
  }
});

app.get('/api/auth/me', (req, res) => {
  res.json(authState(req));
});

app.post('/api/auth/logout', (req, res) => {
  const user = getSessionUser(req);
  if (user) disconnectUser(user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---- AI status (legacy API-key status + plan auth) ----

app.get('/api/ai/status', (req, res) => {
  const s = aiStatus();
  const a = authState(req);
  res.json({
    ...s,
    plan: {
      signedIn: a.signedIn,
      planScopeGranted: a.planScopeGranted,
      planPaused: a.planPaused,
      model: planModel(),
      user: a.user,
    },
  });
});

app.post('/api/ai/test', async (req, res) => {
  const { testConnection } = await import('./ai.js');
  res.json(await testConnection());
});

// ---- Practice settings ----

app.get('/api/settings', (req, res) => {
  const s = getSettings();
  res.json({
    sql_enabled: s.sql_enabled,
    de_enabled: s.de_enabled,
    sql_count: s.sql_count,
    de_count: s.de_count,
    sql_dialect: s.sql_dialect,
  });
});

app.put('/api/settings', (req, res) => {
  const v = validateSettingsUpdate(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  updateSettings(v.settings);
  const s = getSettings();
  res.json({
    sql_enabled: s.sql_enabled,
    de_enabled: s.de_enabled,
    sql_count: s.sql_count,
    de_count: s.de_count,
    sql_dialect: s.sql_dialect,
  });
});

// ---- Daily set ----

app.get('/api/today', async (req, res) => {
  try {
    const dateKey = localDateKey();
    const { challenges, source, planNotice } = await ensureToday(dateKey, req);
    const a = authState(req);
    res.json({
      date_key: dateKey,
      source,
      aiConfigured: isConfigured() || a.signedIn,
      planNotice,
      auth: { signedIn: a.signedIn, planScopeGranted: a.planScopeGranted, planPaused: a.planPaused },
      challenges,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/today/regenerate', async (req, res) => {
  try {
    const dateKey = localDateKey();
    // Never wipe work in progress: block regeneration once any attempt exists.
    const attemptCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM attempts a
         JOIN challenges c ON c.id = a.challenge_id
         WHERE c.date_key = ?`
      )
      .get(dateKey).n;
    if (attemptCount > 0) {
      return res.status(400).json({
        error:
          "Today's set already has attempts — it can't be regenerated. Your new settings will apply from tomorrow's set.",
      });
    }
    const ids = db.prepare(`SELECT id FROM challenges WHERE date_key = ?`).all(dateKey).map((r) => r.id);
    for (const id of ids) db.prepare(`DELETE FROM attempts WHERE challenge_id = ?`).run(id);
    db.prepare(`DELETE FROM challenges WHERE date_key = ?`).run(dateKey);
    const { challenges, source, planNotice } = await ensureToday(dateKey, req);
    const a = authState(req);
    res.json({
      date_key: dateKey,
      source,
      aiConfigured: isConfigured() || a.signedIn,
      planNotice,
      auth: { signedIn: a.signedIn, planScopeGranted: a.planScopeGranted, planPaused: a.planPaused },
      challenges,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Challenges & attempts ----

app.get('/api/challenges/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Challenge not found' });
  res.json({ ...rowToChallenge(row), reference_answer: row.reference_answer, attempts: getAttempts(row.id) });
});

app.post('/api/challenges/:id/attempt', async (req, res) => {
  const row = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Challenge not found' });
  const answer = (req.body?.answer || '').toString().trim();
  if (!answer) return res.status(400).json({ error: 'Answer is required' });

  const info = db.prepare(`INSERT INTO attempts (challenge_id, answer) VALUES (?, ?)`).run(row.id, answer);
  const attemptId = Number(info.lastInsertRowid);

  let review = null;
  let reviewError = null;
  let planNotice;
  let via = null;

  try {
    const r = await aiCompleteJson(buildReviewPrompt({ challenge: rowToChallenge(row), answer }), req);
    via = r.via;
    planNotice = r.planNotice;
    if (r.data) {
      review = validateReview(r.data);
      db.prepare(
        `UPDATE attempts SET score = ?, verdict = ?, strengths = ?, gaps = ?, improved_answer = ?
         WHERE id = ?`
      ).run(
        review.score,
        review.verdict,
        JSON.stringify(review.strengths),
        JSON.stringify(review.gaps),
        review.improved_answer,
        attemptId
      );
      for (const topic of rowToChallenge(row).topics) {
        db.prepare(
          `INSERT INTO topic_stats (topic, track, attempts, total_score) VALUES (?, ?, 1, ?)
           ON CONFLICT(topic) DO UPDATE SET
             attempts = attempts + 1,
             total_score = total_score + excluded.total_score`
        ).run(topic, row.track, review.score);
      }
    }
  } catch (err) {
    reviewError = err.message;
  }

  const aiAvailable = via !== null;
  refreshPracticeDay(row.date_key);
  const attempt = db.prepare(`SELECT * FROM attempts WHERE id = ?`).get(attemptId);
  res.json({
    aiConfigured: aiAvailable,
    via,
    review,
    reviewError,
    planNotice,
    message: aiAvailable
      ? undefined
      : 'No AI available — your answer was saved. Sign in with ChatGPT or add an API key (see Setup) for coach reviews.',
    attempt: {
      ...attempt,
      strengths: attempt.strengths ? JSON.parse(attempt.strengths) : [],
      gaps: attempt.gaps ? JSON.parse(attempt.gaps) : [],
    },
  });
});

// ---- Progress & history ----

function completedOn(dateKey) {
  const row = db.prepare(`SELECT completed FROM practice_days WHERE date_key = ?`).get(dateKey);
  return row ? row.completed : 0;
}

function shiftDate(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

app.get('/api/progress', (req, res) => {
  const today = localDateKey();
  let streak = 0;
  let cursor = completedOn(today) > 0 ? today : shiftDate(today, -1);
  while (completedOn(cursor) > 0) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const dk = shiftDate(today, -i);
    const attempts = db
      .prepare(
        `SELECT COUNT(*) AS n FROM attempts a JOIN challenges c ON c.id = a.challenge_id WHERE c.date_key = ?`
      )
      .get(dk).n;
    days.push({ date_key: dk, completed: completedOn(dk), attempts });
  }

  res.json({
    streak,
    settings: (() => {
      const s = getSettings();
      return {
        sql_enabled: s.sql_enabled,
        de_enabled: s.de_enabled,
        sql_count: s.sql_count,
        de_count: s.de_count,
        sql_dialect: s.sql_dialect,
      };
    })(),
    recommended: {
      sql: { difficulty: recommendedDifficulty('sql'), average: trackAverage('sql') },
      de: { difficulty: recommendedDifficulty('de'), average: trackAverage('de') },
    },
    weakTopics: weakTopics(),
    topics: topicTable(),
    last14: days,
    aiConfigured: isConfigured() || !!getSessionUser(req)?.access_token,
  });
});

app.get('/api/history', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.date_key, p.completed,
              (SELECT COUNT(*) FROM challenges c WHERE c.date_key = p.date_key) AS challenges,
              (SELECT COUNT(*) FROM attempts a JOIN challenges c ON c.id = a.challenge_id WHERE c.date_key = p.date_key) AS attempts
       FROM practice_days p ORDER BY p.date_key DESC LIMIT 60`
    )
    .all();
  res.json({ days: rows });
});

// ---- Static client ----

const publicDir = join(here, 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(publicDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('API running. Build the client with `npm run build` from the repo root.'));
}

app.listen(PORT, () => {
  console.log(`daily-sql-de-practice listening on http://localhost:${PORT}`);
  console.log(`Sign-in callback: ${redirectUri(PORT, APP_URL)}`);
});
