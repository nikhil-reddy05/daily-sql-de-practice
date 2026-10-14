import { createServer, request } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import db from '../db.js';
import { DYNAMIC_CLIENT_ID, ISSUER, JWKS_URL, TOKEN_URL } from '../auth.js';
import { startServer } from '../index.js';
import { getSeedOffsets } from '../settings.js';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signedIdToken({ nonce, privateKey }) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'security-test', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: ISSUER,
      aud: DYNAMIC_CLIENT_ID,
      sub: 'security-test-user',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce,
      email: 'security@example.test',
    })
  );
  const signature = b64url(createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey));
  return `${header}.${payload}.${signature}`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.once('error', reject);
    req.end();
  });
}

test('loopback server rejects foreign browser mutations and side-effecting Today requests', async () => {
  let providerCalls = 0;
  const provider = createServer((req, res) => {
    providerCalls += 1;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'mocked provider failure' }));
  });
  const providerPort = await listen(provider);
  const previousAi = {
    provider: process.env.AI_PROVIDER,
    key: process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL,
  };
  process.env.AI_PROVIDER = 'custom';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = `http://127.0.0.1:${providerPort}`;

  const instance = await startServer({
    port: 0,
    appUrl: 'http://127.0.0.1:5173',
    startup: { cryptoBootWarnings: () => {}, validateOidc: false },
  });
  const address = instance.server.address();
  const origin = `http://127.0.0.1:${instance.port}`;
  const foreignOrigin = 'https://evil.example';
  const settings = {
    sql_enabled: true,
    de_enabled: true,
    sql_count: 2,
    de_count: 2,
    sql_dialect: 'PostgreSQL 15',
  };

  try {
    assert.equal(address.address, '127.0.0.1');

    const deniedToday = await fetch(`${origin}/api/today`, {
      headers: { Origin: foreignOrigin, 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(deniedToday.status, 403);
    assert.deepEqual(await deniedToday.json(), { error: 'Forbidden' });
    assert.equal(providerCalls, 0, 'a denied Today request must not call a provider');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM day_sources').get().n, 0);

    const beforeSettings = await (await fetch(`${origin}/api/settings`)).json();
    const deniedSettings = await fetch(`${origin}/api/settings`, {
      method: 'PUT',
      headers: { Origin: foreignOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, sql_count: 5 }),
    });
    assert.equal(deniedSettings.status, 403);
    assert.deepEqual(await (await fetch(`${origin}/api/settings`)).json(), beforeSettings);

    // A header-less local CLI remains supported, but a browser declaring a
    // cross-site context cannot use that fallback.
    const cliSettings = await fetch(`${origin}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, sql_count: 3 }),
    });
    assert.equal(cliSettings.status, 200);
    const metadataDenied = await fetch(`${origin}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ ...settings, sql_count: 4 }),
    });
    assert.equal(metadataDenied.status, 403);
    assert.equal((await (await fetch(`${origin}/api/settings`)).json()).sql_count, 3);
    const sameOriginSettings = await fetch(`${origin}/api/settings`, {
      method: 'PUT',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(settings),
    });
    assert.equal(sameOriginSettings.status, 200);
    // Vite preserves the browser Origin while proxying to the canonical Host.
    const viteProxySettings = await fetch(`${origin}/api/settings`, {
      method: 'PUT',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-site',
      },
      body: JSON.stringify(settings),
    });
    assert.equal(viteProxySettings.status, 200);

    const today = await fetch(`${origin}/api/today`, {
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(today.status, 200);
    const set = await today.json();
    assert.equal(set.source, 'seed');
    assert.equal(providerCalls, 1, 'the allowed Today request reaches the mocked provider once');
    assert.ok(set.challenges.length > 0);

    const attemptsBefore = db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n;
    const offsetsBefore = getSeedOffsets();
    const foreignAttempt = await fetch(`${origin}/api/challenges/${set.challenges[0].id}/attempt`, {
      method: 'POST',
      headers: { Origin: foreignOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'SELECT 1' }),
    });
    assert.equal(foreignAttempt.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n, attemptsBefore);

    for (const path of ['/api/today/regenerate', '/api/ai/test', '/api/auth/logout']) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { Origin: foreignOrigin, 'Content-Type': 'application/json' },
      });
      assert.equal(response.status, 403, `${path} must reject a foreign Origin`);
      assert.deepEqual(await response.json(), { error: 'Forbidden' });
    }
    assert.deepEqual(getSeedOffsets(), offsetsBefore);
    assert.equal(providerCalls, 1, 'denied routes must not trigger further provider calls');

    const rebinding = await rawGet(instance.port, '/api/today', {
      Host: 'evil.example',
      Origin: origin,
    });
    assert.equal(rebinding.status, 403);
    assert.deepEqual(JSON.parse(rebinding.body), { error: 'Forbidden' });
    assert.equal(providerCalls, 1);

    const noCors = await fetch(`${origin}/api/settings`);
    assert.equal(noCors.headers.get('access-control-allow-origin'), null);

    // OAuth returns from a cross-site top-level navigation, so its callback is
    // intentionally exempt from the generic unsafe/browser-origin rule while
    // still completing state/PKCE validation. No real provider is contacted.
    const login = await fetch(`${origin}/api/auth/login`, { redirect: 'manual' });
    const authorize = new URL(login.headers.get('location'));
    const state = authorize.searchParams.get('state');
    const nonce = authorize.searchParams.get('nonce');
    assert.ok(state && nonce);
    assert.equal(authorize.searchParams.get('redirect_uri'), 'http://127.0.0.1:5173/api/auth/callback');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: 'jwk' });
    publicJwk.kid = 'security-test';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url === TOKEN_URL) {
        return {
          ok: true,
          text: async () => JSON.stringify({ id_token: signedIdToken({ nonce, privateKey }) }),
        };
      }
      if (url === JWKS_URL) return { ok: true, json: async () => ({ keys: [publicJwk] }) };
      throw new Error(`unexpected mocked OAuth request: ${url}`);
    };
    try {
      const callback = await rawGet(
        instance.port,
        `/api/auth/callback?code=mock-code&state=${encodeURIComponent(state)}`,
        { 'Sec-Fetch-Site': 'cross-site' }
      );
      assert.equal(callback.status, 302);
      assert.equal(callback.headers.location, '/?auth=ok');
      assert.match(callback.headers['set-cookie'][0], /^sid=/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await instance.close();
    await close(provider);
    if (previousAi.provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousAi.provider;
    if (previousAi.key === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAi.key;
    if (previousAi.baseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previousAi.baseUrl;
  }
});
