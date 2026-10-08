import { useEffect, useState } from 'react';
import { api, type AiStatus } from '../api';

export default function Setup({ onAuthChange }: { onAuthChange: () => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
