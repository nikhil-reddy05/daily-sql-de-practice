import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Progress() {
  const [p, setP] = useState<Awaited<ReturnType<typeof api.progress>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.progress().then(setP).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!p) return <div className="muted">Loading progress…</div>;

  const maxAttempts = Math.max(1, ...p.last14.map((d) => d.attempts));

  return (
    <div>
      <div className="row">
        <div className="card">
          <div className="muted">Current streak</div>
          <div className="streak">{p.streak} day{p.streak === 1 ? '' : 's'}</div>
        </div>
        <div className="card">
          <div className="muted">Recommended difficulty</div>
          <div>
            SQL:{' '}
            {p.settings.sql_enabled ? (
              <>
                <strong>{p.recommended.sql.difficulty}</strong>
                {p.recommended.sql.average !== null && (
                  <span className="muted"> (avg {p.recommended.sql.average.toFixed(0)})</span>
                )}
              </>
            ) : (
              <span className="muted">disabled</span>
            )}
          </div>
          <div>
            Data Eng:{' '}
            {p.settings.de_enabled ? (
              <>
                <strong>{p.recommended.de.difficulty}</strong>
                {p.recommended.de.average !== null && (
                  <span className="muted"> (avg {p.recommended.de.average.toFixed(0)})</span>
                )}
              </>
            ) : (
              <span className="muted">disabled</span>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Last 14 days</h2>
        <div className="hist">
          {p.last14.map((d) => (
            <div
              key={d.date_key}
              className={`bar${d.completed > 0 ? ' done' : ''}`}
              style={{ height: 8 + (d.attempts / maxAttempts) * 72 }}
              title={`${d.date_key}: ${d.attempts} attempts`}
            />
          ))}
        </div>
        <div className="muted">Green = practiced that day. Bar height = attempts.</div>
      </div>

      {p.weakTopics.length > 0 && (
        <div className="card">
          <h2>Weak topics (being drilled)</h2>
          <table className="stats">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Track</th>
                <th>Avg</th>
              </tr>
            </thead>
            <tbody>
              {p.weakTopics.map((t) => (
                <tr key={t.topic}>
                  <td>{t.topic}</td>
                  <td>{t.track}</td>
                  <td>{t.avg.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Topic scores</h2>
        {p.topics.length === 0 ? (
          <div className="muted">
            No scored attempts yet. {p.aiConfigured ? 'Submit an answer to start building your profile.' : 'Connect an AI provider in Setup to get scored reviews.'}
          </div>
        ) : (
          <table className="stats">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Track</th>
                <th>Attempts</th>
                <th>Avg score</th>
              </tr>
            </thead>
            <tbody>
              {p.topics.map((t) => (
                <tr key={t.topic}>
                  <td>{t.topic}</td>
                  <td>{t.track}</td>
                  <td>{t.attempts}</td>
                  <td>{t.avg.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
