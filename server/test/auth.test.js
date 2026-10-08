import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  buildAuthorizeUrlParams,
  pkcePair,
  validateIdToken,
  refreshAccessToken,
  ISSUER,
  DYNAMIC_CLIENT_ID,
  SCOPES,
  RESOURCE,
  AUTHORIZE_URL,
} from '../auth.js';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---- authorize URL builder ----

test('authorize URL carries scopes, PKCE S256, resource, loopback redirect', () => {
  const built = buildAuthorizeUrlParams({
    clientId: DYNAMIC_CLIENT_ID,
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
    hostId: 'host-123',
  });
  const u = new URL(built.url);
  assert.equal(u.origin + u.pathname, AUTHORIZE_URL);
  const q = u.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), 'dynamic_agent_client');
  assert.equal(q.get('redirect_uri'), 'http://127.0.0.1:3000/api/auth/callback');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('agent_name_hint'), 'Daily SQL & DE Practice');
  assert.equal(q.get('ext_agent_host_id'), 'host-123');
  assert.equal(q.get('resource'), RESOURCE);
  assert.equal(q.get('resource'), 'https://api.openai.com/v1');
  // every requested scope present
  for (const s of SCOPES.split(' ')) {
    assert.ok(q.get('scope').split(' ').includes(s), `missing scope ${s}`);
  }
  assert.ok(q.get('scope').includes('chatgpt.tokens.use.direct'));
  // PKCE: challenge is S256 of verifier
  const expected = b64url(createHash('sha256').update(built.codeVerifier).digest());
  assert.equal(built.codeChallenge, expected);
  assert.equal(q.get('code_challenge'), expected);
  assert.ok(built.state.length >= 20 && built.nonce.length >= 20);
});

test('pkcePair challenge matches S256(verifier)', () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(challenge, b64url(createHash('sha256').update(verifier).digest()));
  assert.ok(verifier.length >= 43);
});

// ---- id_token validation (mocked JWKS) ----

function makeToken({ payload, kid, privateKey }) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey));
  return `${h}.${p}.${sig}`;
}

function jwksFetch(publicJwk) {
  return async () => ({ ok: true, json: async () => ({ keys: [publicJwk] }) });
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-kid';
  jwk.alg = 'RS256';
  return { publicJwk: jwk, privateKey };
}

const basePayload = () => ({
  iss: ISSUER,
  aud: DYNAMIC_CLIENT_ID,
  sub: 'user_123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  nonce: 'nonce-abc',
  email: 'test@example.com',
  name: 'Test User',
});

test('validateIdToken accepts a properly signed token', async () => {
  const { publicJwk, privateKey } = keypair();
  const token = makeToken({ payload: basePayload(), kid: 'test-kid', privateKey });
  const claims = await validateIdToken(
    token,
    { expectedAud: DYNAMIC_CLIENT_ID, expectedNonce: 'nonce-abc' },
    jwksFetch(publicJwk)
  );
  assert.equal(claims.sub, 'user_123');
  assert.equal(claims.email, 'test@example.com');
});

test('validateIdToken rejects wrong audience', async () => {
  const { publicJwk, privateKey } = keypair();
  const token = makeToken({ payload: basePayload(), kid: 'test-kid', privateKey });
  await assert.rejects(
    validateIdToken(token, { expectedAud: 'other_client', expectedNonce: 'nonce-abc' }, jwksFetch(publicJwk)),
    /aud/
  );
});

test('validateIdToken rejects expired token', async () => {
  const { publicJwk, privateKey } = keypair();
  const payload = { ...basePayload(), exp: Math.floor(Date.now() / 1000) - 10 };
  const token = makeToken({ payload, kid: 'test-kid', privateKey });
  await assert.rejects(
    validateIdToken(token, { expectedAud: DYNAMIC_CLIENT_ID, expectedNonce: 'nonce-abc' }, jwksFetch(publicJwk)),
    /expired/
  );
});

test('validateIdToken rejects nonce mismatch', async () => {
  const { publicJwk, privateKey } = keypair();
  const token = makeToken({ payload: basePayload(), kid: 'test-kid', privateKey });
  await assert.rejects(
    validateIdToken(token, { expectedAud: DYNAMIC_CLIENT_ID, expectedNonce: 'wrong' }, jwksFetch(publicJwk)),
    /nonce/
  );
});

test('validateIdToken rejects tampered signature', async () => {
  const { publicJwk, privateKey } = keypair();
  const token = makeToken({ payload: basePayload(), kid: 'test-kid', privateKey });
  const tampered = token.slice(0, -4) + 'AAAA';
  await assert.rejects(
    validateIdToken(tampered, { expectedAud: DYNAMIC_CLIENT_ID, expectedNonce: 'nonce-abc' }, jwksFetch(publicJwk)),
    /signature/
  );
});

// ---- refresh ----

test('refreshAccessToken returns body on success', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600 }),
  });
  const body = await refreshAccessToken({ refreshToken: 'old-rt', clientId: DYNAMIC_CLIENT_ID }, fetchImpl);
  assert.equal(body.access_token, 'new-at');
});

test('refreshAccessToken surfaces invalid_grant with code', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => JSON.stringify({ error: 'invalid_grant' }),
  });
  await assert.rejects(
    refreshAccessToken({ refreshToken: 'dead-rt', clientId: DYNAMIC_CLIENT_ID }, fetchImpl),
    (err) => err.code === 'invalid_grant'
  );
});
