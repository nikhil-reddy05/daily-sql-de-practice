import { useEffect, useState } from 'react';
import { api, type Challenge, type TodaySet } from '../api';

function ChallengeCard({ c, onAttempted }: { c: Challenge; onAttempted: () => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refAnswer, setRefAnswer] = useState<string | null>(null);
  const last = c.attempts[0];

  async function submit() {
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.attempt(c.id, answer);
      if (r.message) setNotice(r.message);
      if (r.reviewError) setError('AI review failed: ' + r.reviewError + ' (answer saved)');
      setAnswer('');
      onAttempted();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    if (refAnswer !== null) {
      setRefAnswer(null);
      return;
    }
    try {
      const full = await api.challenge(c.id);
      setRefAnswer(full.reference_answer);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <h2>
        {c.track === 'sql' ? 'SQL' : 'DE'} · {c.title}
      </h2>
      <div className="meta">
        <span className={`pill ${c.track}`}>{c.track === 'sql' ? 'SQL' : 'Data Engineering'}</span>
        <span className={`pill ${c.difficulty}`}>{c.difficulty}</span>
        {c.topics.map((t) => (
          <span key={t} className="pill">
            {t}
          </span>
        ))}
      </div>
      <p>{c.statement}</p>
      {c.schema_sql && <pre className="schema">{c.schema_sql}</pre>}

      <details>
        <summary>Hints ({c.hints.length})</summary>
        <ol>
          {c.hints.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ol>
      </details>

      <textarea
        className="answer"
        placeholder={c.track === 'sql' ? 'Write your query here…' : 'Write your answer here…'}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <br />
      <button className="btn" onClick={submit} disabled={busy || !answer.trim()}>
        {busy ? 'Reviewing…' : 'Submit for review'}
      </button>
      <button className="btn ghost" style={{ marginLeft: 8 }} onClick={reveal}>
        {refAnswer !== null ? 'Hide reference answer' : 'Reveal reference answer'}
      </button>
      {refAnswer !== null && <pre className="improved">{refAnswer}</pre>}
      {error && <div className="error">{error}</div>}
      {notice && <div className="muted" style={{ marginTop: 8 }}>{notice}</div>}

      {last && last.score !== null && (
        <div className="review">
          <div className="score">{last.score}/100</div>
          <p>
            <strong>{last.verdict}</strong>
          </p>
          {last.strengths.length > 0 && (
            <>
              <div className="muted">Strengths</div>
              <ul>
                {last.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {last.gaps.length > 0 && (
            <>
              <div className="muted">Gaps</div>
              <ul>
                {last.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}
          {last.improved_answer && (
            <details open>
              <summary>Improved answer</summary>
              <pre className="improved">{last.improved_answer}</pre>
            </details>
          )}
        </div>
      )}
      {last && last.score === null && (
        <div className="muted" style={{ marginTop: 8 }}>
          Answer saved (no AI review — connect a provider in Setup for coach feedback).
        </div>
      )}
      {c.attempts.length > 1 && (
        <div className="muted" style={{ marginTop: 8 }}>
          {c.attempts.length} attempts on this problem.
        </div>
      )}
    </div>
  );
}

export default function Today() {
  const [set, setSet] = useState<TodaySet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);

  async function load() {
    try {
      setSet(await api.today());
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function regenerate() {
    if (regenBusy || !set) return;
    if (set.challenges.some((c) => c.attempts.length > 0)) {
      setError(
        "Today's set already has attempts — it can't be regenerated. New settings apply from tomorrow's set."
      );
      return;
    }
    if (!confirm('Replace today\u2019s set with a freshly generated one using your current settings?')) return;
    setRegenBusy(true);
    try {
      setSet(await api.regenerate());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRegenBusy(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!set) return <div className="muted">Loading today&apos;s set…</div>;

  const done = set.challenges.filter((c) => c.attempts.length > 0).length;

  return (
    <div>
      {!set.aiConfigured && (
        <div className="banner">
          No AI connected — today&apos;s problems come from the built-in seed bank and answers
          are saved without coach reviews. <strong>Sign in with ChatGPT</strong> above, or add
          an API key in <strong>Setup</strong>, for fresh AI-generated problems and reviews.
        </div>
      )}
      {set.planNotice && (
        <div className="banner">
          {set.planNotice.message}{' '}
          {set.planNotice.manageUrl && (
            <a href={set.planNotice.manageUrl} target="_blank" rel="noreferrer">
              Manage usage
            </a>
          )}
        </div>
      )}
      <div className="muted">
        {set.date_key} · {done}/{set.challenges.length} attempted · source: {set.source === 'seed' ? 'seed bank' : 'AI-generated'}
        <button className="btn ghost" style={{ marginLeft: 12, padding: '6px 12px' }} onClick={regenerate} disabled={regenBusy}>
          {regenBusy ? 'Regenerating…' : 'Regenerate set'}
        </button>
      </div>
      {set.challenges.map((c) => (
        <ChallengeCard key={c.id} c={c} onAttempted={load} />
      ))}
    </div>
  );
}
