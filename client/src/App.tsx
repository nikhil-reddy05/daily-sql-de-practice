import { useEffect, useState } from 'react';
import Today from './views/Today';
import Progress from './views/Progress';
import Setup from './views/Setup';
import { api, type AuthMe } from './api';

type Tab = 'today' | 'progress' | 'setup';

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [auth, setAuth] = useState<AuthMe | null>(null);

  useEffect(() => {
    api.authMe().then(setAuth).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    if (q.get('auth') === 'ok' || q.get('auth') === 'error') {
      api.authMe().then(setAuth).catch(() => {});
      if (q.get('auth') === 'error') {
        alert('Sign-in failed: ' + (q.get('msg') || 'unknown error'));
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function logout() {
    await api.logout().catch(() => {});
    setAuth(await api.authMe().catch(() => null));
  }

  return (
    <div className="app">
      <header className="top">
        <h1>Daily SQL &amp; DE Practice</h1>
        <nav className="tabs">
          <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>
            Today
          </button>
          <button className={tab === 'progress' ? 'active' : ''} onClick={() => setTab('progress')}>
            Progress
          </button>
          <button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>
            Setup
          </button>
        </nav>
      </header>

      <div className="authbar">
        {!auth?.signedIn ? (
          <a className="btn" href="/api/auth/login">
            Sign in with ChatGPT
          </a>
        ) : (
          <div className="userinfo">
            {auth.user?.picture && <img src={auth.user.picture} alt="" className="avatar" />}
            <span>{auth.user?.name || auth.user?.email || 'ChatGPT user'}</span>
            {auth.planScopeGranted && !auth.planPaused && (
              <span className="pill plan">Using your ChatGPT plan</span>
            )}
            {auth.planPaused && <span className="pill paused">Plan cap reached</span>}
            <a
              className="muted"
              href="https://chatgpt.com/settings/usage"
              target="_blank"
              rel="noreferrer"
            >
              Manage usage
            </a>
            <button className="btn ghost small" onClick={logout}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {tab === 'today' && <Today />}
      {tab === 'progress' && <Progress />}
      {tab === 'setup' && <Setup onAuthChange={() => api.authMe().then(setAuth).catch(() => {})} />}
    </div>
  );
}
