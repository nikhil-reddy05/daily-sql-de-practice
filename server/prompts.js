// Prompt builders + strict validation for AI-generated content.

const DIFFICULTIES = ['foundation', 'intermediate', 'advanced'];

export function buildGenerationPrompt({ mix, weakTopics, avoidTitles, counts = { sql: 2, de: 2 } }) {
  const total = counts.sql + counts.de;
  const parts = [];
  if (counts.sql > 0) parts.push(`${counts.sql} SQL`);
  if (counts.de > 0) parts.push(`${counts.de} data-engineering scenario`);
  const weak =
    weakTopics.length > 0
      ? `The user is weak on these topics (average score < 60 over 2+ attempts) — make sure at least one question drills each: ${weakTopics
          .map((w) => `${w.topic} (${w.track})`)
          .join(', ')}.`
      : 'No weak topics yet — cover a balanced mix of topics.';
  const avoid =
    avoidTitles.length > 0
      ? `Do NOT reuse these recent titles/scenarios (rephrase-free zone): ${avoidTitles.join(' | ')}.`
      : '';
  const mixLine =
    [
      counts.sql > 0
        ? `- SQL: ${counts.sql} problem(s) at difficulties: ${mix.sql.join(', ')}.`
        : null,
      counts.de > 0
        ? `- Data engineering: ${counts.de} problem(s) at difficulties: ${mix.de.join(', ')}.`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

  return `You are an expert data-engineering interview coach. Create exactly ${total} ORIGINAL practice problems: ${parts.join(' and ')}.

Rules:
- SQL problems target PostgreSQL 15 syntax. Data-engineering problems are scenario/design questions (pipelines, Spark, Airflow, modeling, streaming, data quality).
- Use original wording. Do NOT copy recognizable HackerRank or LeetCode problems.
- Difficulty mix:
${mixLine}
- ${weak}
- ${avoid}
- Each SQL problem needs a small schema_sql (table definitions).
- Each problem needs exactly 3 progressive hints (hint 1 nudges, hint 2 is concrete, hint 3 nearly gives it away).
- Each problem needs a short rubric (what a great answer demonstrates) and a reference_answer (model solution).

Respond with valid JSON only, exactly this shape:
{
  "sql": [ exactly ${counts.sql} SQL problem object(s) ],
  "de": [ exactly ${counts.de} data-engineering problem object(s) ]
}
SQL problem object:
{"title": "...", "difficulty": "foundation|intermediate|advanced", "topics": ["..."],
 "statement": "...", "schema_sql": "...", "hints": ["...", "...", "..."],
 "rubric": "...", "reference_answer": "..."}
Data-engineering problem object: same shape but WITHOUT "schema_sql".`;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateProblem(p, track) {
  if (typeof p !== 'object' || p === null) throw new Error(`Invalid ${track} problem: not an object`);
  for (const f of ['title', 'statement', 'rubric', 'reference_answer']) {
    if (!isNonEmptyString(p[f])) throw new Error(`Invalid ${track} problem "${p.title || '?'}": missing ${f}`);
  }
  if (!DIFFICULTIES.includes(p.difficulty)) {
    throw new Error(`Invalid ${track} problem "${p.title}": bad difficulty`);
  }
  if (!Array.isArray(p.topics) || p.topics.length === 0 || !p.topics.every(isNonEmptyString)) {
    throw new Error(`Invalid ${track} problem "${p.title}": topics must be a non-empty string array`);
  }
  if (!Array.isArray(p.hints) || p.hints.length < 3 || !p.hints.every(isNonEmptyString)) {
    throw new Error(`Invalid ${track} problem "${p.title}": need at least 3 hints`);
  }
  if (track === 'sql' && !isNonEmptyString(p.schema_sql)) {
    throw new Error(`Invalid sql problem "${p.title}": missing schema_sql`);
  }
  return {
    title: p.title.trim(),
    difficulty: p.difficulty,
    topics: p.topics.map((t) => t.trim()),
    statement: p.statement.trim(),
    schema_sql: track === 'sql' ? p.schema_sql.trim() : null,
    hints: p.hints.map((h) => h.trim()),
    rubric: p.rubric.trim(),
    reference_answer: p.reference_answer.trim(),
  };
}

// Strictly validate the generation payload; throws on any shape problem.
// counts = { sql: n, de: n } — each track must contain exactly n problems.
export function validateGeneration(obj, counts = { sql: 2, de: 2 }) {
  if (typeof obj !== 'object' || obj === null) throw new Error('Generation payload is not an object');
  for (const track of ['sql', 'de']) {
    const want = counts[track] ?? 0;
    if (!Array.isArray(obj[track]) || obj[track].length !== want) {
      throw new Error(`Generation payload must contain exactly ${want} "${track}" problem(s)`);
    }
  }
  return {
    sql: obj.sql.map((p) => validateProblem(p, 'sql')),
    de: obj.de.map((p) => validateProblem(p, 'de')),
  };
}

export function buildReviewPrompt({ challenge, answer }) {
  const schema = challenge.schema_sql ? `Schema:\n${challenge.schema_sql}\n\n` : '';
  return `You are a strict but encouraging data-engineering interview coach. Review the candidate's answer below.

Problem (${challenge.track.toUpperCase()}, ${challenge.difficulty}): ${challenge.title}
${schema}Statement: ${challenge.statement}

Candidate's answer:
${answer}

Score the answer 0-100 against this rubric: ${challenge.rubric || 'correctness, completeness, and clarity'}.
- verdict: one short sentence (e.g. "Strong answer, minor gap on ...").
- strengths: 1-3 short bullet phrases.
- gaps: 1-3 short bullet phrases (empty array if none).
- improved_answer: a corrected / model-quality version of the answer (for SQL, a working query; keep it concise).

Respond with valid JSON only, exactly this shape:
{"score": 85, "verdict": "...", "strengths": ["..."], "gaps": ["..."], "improved_answer": "..."}`;
}

export function validateReview(obj) {
  if (typeof obj !== 'object' || obj === null) throw new Error('Review payload is not an object');
  const score = Number(obj.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Review payload has invalid score (must be 0-100)');
  }
  if (!isNonEmptyString(obj.verdict)) throw new Error('Review payload missing verdict');
  if (!isNonEmptyString(obj.improved_answer)) throw new Error('Review payload missing improved_answer');
  const strArr = (v) => (Array.isArray(v) ? v.filter(isNonEmptyString).map((s) => s.trim()) : []);
  return {
    score: Math.round(score),
    verdict: obj.verdict.trim(),
    strengths: strArr(obj.strengths),
    gaps: strArr(obj.gaps),
    improved_answer: obj.improved_answer.trim(),
  };
}
