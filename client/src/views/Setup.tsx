import { useEffect, useState } from 'react';
import { api, SQL_DIALECTS, type AiStatus, type PracticeSettings } from '../api';

function TrackRow({
  label,
  hint,
  enabled,
  count,
  saving,
  onToggle,
  onCount,
}: {
  label: string;
  hint: string;
  enabled: boolean;
  count: number;
  saving: boolean;
  onToggle: () => void;
  onCount: (n: number) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <div>
          <strong>{label}</strong>
        </div>
        <div className="muted">{hint}</div>
      </div>
      <div className="setting-controls">
        <div className="stepper" aria-disabled={!enabled}>
          <button
            className="btn ghost small"
            disabled={saving || !enabled || count <= 0}
            onClick={() => onCount(count - 1)}
            aria-label={`Fewer ${label} questions`}
          >
            −
          </button>
          <span className="val">{enabled ? `${count}/day` : 'off'}</span>
          <button
            className="btn ghost small"
            disabled={saving || !enabled || count >= 10}
            onClick={() => onCount(count + 1)}
            aria-label={`More ${label} questions`}
          >
            +
          </button>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label={`Toggle ${label}`}
          className={`toggle${enabled ? ' on' : ''}`}
          disabled={saving}
          onClick={onToggle}
        >
          <span className="knob" />
        </button>
      </div>
    </div>
  );
}

export default function Setup({ onAuthChange }: { onAuthChange: () => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PracticeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenMsg, setRegenMsg] = useState<string | null>(null);

  function refresh() {
    api
      .aiStatus()
      .then((s) => {
        setStatus(s);
        onAuthChange();
      })
      .catch((e) => setError(e.message));
  }

  useEffect(refresh, []);
  useEffect(() => {
    api.settings().then(setSettings).catch((e) => setError(e.message));
  }, []);

  async function saveSettings(next: PracticeSettings) {
    const prev = settings;
    setSettings(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      setSettings(await api.updateSettings(next));
    } catch (e: any) {
      setError(e.message);
      if (prev) setSettings(prev); // revert on validation failure
    } finally {
      setSaving(false);
    }
  }

  async function regenNow() {
    setRegenBusy(true);
    setRegenMsg(null);
    try {
      await api.regenerate();
      setRegenMsg("Today's set was regenerated with your current settings.");
    } catch (e: any) {
      setRegenMsg(e.message);
    } finally {
      setRegenBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setTest(null);
    try {
      setTest(await api.aiTest());
    } catch (e: any) {
      setTest({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  }

  const plan = (status as any)?.plan;

  return (
    <div>
      <div className="card">
        <h2>Practice settings</h2>
        {settings ? (
          <>
            <TrackRow
              label="SQL"
              hint={settings.sql_enabled ? `Query problems (${settings.sql_dialect})` : 'Query problems'}
              enabled={settings.sql_enabled}
              count={settings.sql_count}
              saving={saving}
              onToggle={() => saveSettings({ ...settings, sql_enabled: !settings.sql_enabled })}
              onCount={(n) => saveSettings({ ...settings, sql_count: n })}
            />
            <div className="setting-row" style={settings.sql_enabled ? undefined : { opacity: 0.35 }}>
              <div>
                <div>
                  <strong>SQL dialect</strong>
                </div>
              </div>
              <div className="setting-controls">
                <select
                  className="select"
                  value={settings.sql_dialect}
                  disabled={saving || !settings.sql_enabled}
                  onChange={(e) => saveSettings({ ...settings, sql_dialect: e.target.value })}
                  aria-label="SQL dialect"
                >
                  {SQL_DIALECTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              Applies to AI-generated questions; the built-in seed bank is
              PostgreSQL-flavored.
            </p>
            <TrackRow
              label="Data engineering"
              hint="Pipeline / Spark / Airflow scenarios"
              enabled={settings.de_enabled}
              count={settings.de_count}
              saving={saving}
              onToggle={() => saveSettings({ ...settings, de_enabled: !settings.de_enabled })}
              onCount={(n) => saveSettings({ ...settings, de_count: n })}
            />
            <p className="muted">
              Changes apply from tomorrow&apos;s set. Use the button below to apply them to
              today&apos;s set right now.
            </p>
            <button className="btn ghost" onClick={regenNow} disabled={regenBusy}>
              {regenBusy ? 'Regenerating…' : "Regenerate today's set"}
            </button>
            {regenMsg && (
              <div className="muted" style={{ marginTop: 8 }}>
                {regenMsg}
              </div>
            )}
          </>
        ) : (
          <div className="muted">Loading settings…</div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h2>Option 1 — Sign in with ChatGPT (recommended)</h2>
        <p className="muted">
          No API key needed. Sign in with your ChatGPT account and all AI calls run against
          your own Plus/Pro subscription quota — usage counts against your ChatGPT plan.
          You control a per-app weekly cap in ChatGPT; if the cap is hit, the app pauses
          plan-backed requests and tells you.
        </p>
        <p className="muted">
          <a className="btn" href="/api/auth/login" style={{ textDecoration: 'none' }}>
            Sign in with ChatGPT
          </a>
        </p>
        {plan && (
          <table className="stats">
            <tbody>
              <tr>
                <td>Signed in</td>
                <td>{plan.signedIn ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <td>Plan usage granted</td>
                <td>{plan.planScopeGranted ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <td>Model</td>
                <td>{plan.model}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Option 2 — API key fallback</h2>
        <p className="muted">
          Don&apos;t have Plus/Pro, or prefer keys? Set these in <code>.env</code> and restart
          the server. See <code>.env.example</code> and the README for all four providers
          (OpenAI, Anthropic, Ollama, OpenRouter).
        </p>
        {error && <div className="error">{error}</div>}
        {status && (
          <table className="stats">
            <tbody>
              <tr>
                <td>API key configured</td>
                <td>{status.configured ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <td>Provider</td>
                <td>{status.provider ?? '—'}</td>
              </tr>
              <tr>
                <td>Model</td>
                <td>{status.model ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        )}
        <button className="btn" onClick={runTest} disabled={busy}>
          {busy ? 'Testing…' : 'Test API-key connection'}
        </button>
        {test && (
          <div className={test.ok ? 'muted' : 'error'} style={{ marginTop: 8 }}>
            {test.ok ? '✓ ' : '✗ '}{test.message}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Notes</h2>
        <ul className="muted">
          <li>Plan usage requires a ChatGPT Plus or Pro subscription.</li>
          <li>The weekly per-app cap is configured by you inside ChatGPT, not here.</li>
          <li>Tokens are encrypted at rest. Set <code>TOKENS_KEY</code> in <code>.env</code> for a stable key.</li>
          <li>Without either option, the app still works — daily sets rotate through the built-in 16-problem seed bank.</li>
        </ul>
      </div>
    </div>
  );
}
