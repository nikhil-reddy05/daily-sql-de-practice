// "Sign in with ChatGPT" — official OpenAI DevDay (Sept 2026) open-source flow.
// The user signs in with their ChatGPT account; AI calls then run against their
// own Plus/Pro subscription quota. No API key needed. Self-serve, local-first.
//
// Endpoints (https://auth.openai.com):
//   authorize: https://auth.openai.com/api/accounts/authorize
//   token:     https://auth.openai.com/api/accounts/oauth/token
//   jwks:      https://auth.openai.com/.well-known/jwks.json

import { createHash, createPublicKey, createVerify, randomBytes, randomUUID } from 'node:crypto';
import db, { configGet, configSet } from './db.js';
import { encryptToken, decryptToken, signSession, verifySession } from './crypto.js';

export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';
export const OPENID_CONFIG_URL = 'https://auth.openai.com/.well-known/openid-configuration';

export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const AGENT_NAME_HINT = 'Daily SQL & DE Practice';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const RESOURCE = 'https://api.openai.com/v1';

// In-memory pending OAuth states (server-side, keyed by state, 10-min expiry).
const pending = new Map();

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkcePair() {
  const verifier = b64url(randomBytes(32)); // 43 chars
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function getHostId() {
  let id = configGet('ext_agent_host_id');
  if (!id) {
    id = randomUUID();
    configSet('ext_agent_host_id', id);
  }
  return id;
}

export function getClientId() {
  return configGet('oauth_client_id') || DYNAMIC_CLIENT_ID;
}

export function redirectUri(port, appUrl) {
  const base = (appUrl || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/api/auth/callback`;
  return `http://127.0.0.1:${port}/api/auth/callback`;
}

// Pure + testable: builds the authorize URL from explicit inputs.
export function buildAuthorizeUrlParams({ clientId, redirectUri, hostId }) {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    agent_name_hint: AGENT_NAME_HINT,
    ext_agent_host_id: hostId,
  });
  return {
    url: `${AUTHORIZE_URL}?${params.toString()}`,
    state,
    nonce,
    codeVerifier: verifier,
    codeChallenge: challenge,
  };
}

export function buildAuthorizeUrl({ port, appUrl }) {
  const built = buildAuthorizeUrlParams({
    clientId: getClientId(),
    redirectUri: redirectUri(port, appUrl),
    hostId: getHostId(),
  });
  pending.set(built.state, {
    codeVerifier: built.codeVerifier,
    nonce: built.nonce,
    redirectUri: redirectUri(port, appUrl),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return built.url;
}

function consumePending(state) {
  const p = pending.get(state);
  if (p) pending.delete(state);
  if (!p || p.expiresAt < Date.now()) return null;
  return p;
}

async function postForm(url, params, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const err = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(`Token request failed: ${err}`);
  }
  return body;
}

// Public client: no client_secret.
export async function exchangeCode({ code, codeVerifier, redirectUri, clientId }, fetchImpl = fetch) {
  return postForm(
    TOKEN_URL,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    },
    fetchImpl
  );
}

export async function refreshAccessToken({ refreshToken, clientId }, fetchImpl = fetch) {
  const body = await postForm(
    TOKEN_URL,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
    fetchImpl
  );
  const err = (body.error || '').toString();
  if (err === 'invalid_grant') {
    const e = new Error('Refresh token rejected (invalid_grant)');
    e.code = 'invalid_grant';
    throw e;
  }
  return body;
}

let jwksCache = null;
let jwksCacheAt = 0;

async function getJwks(fetchImpl = fetch) {
  if (jwksCache && Date.now() - jwksCacheAt < 3600 * 1000) return jwksCache;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status})`);
  jwksCache = await res.json();
  jwksCacheAt = Date.now();
  return jwksCache;
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export async function validateIdToken(idToken, { expectedAud, expectedNonce }, fetchImpl = fetch) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  const [h, p, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch {
    throw new Error('Malformed id_token claims');
  }
  if (payload.iss !== ISSUER) throw new Error(`Bad id_token iss: ${payload.iss}`);
  if (payload.aud !== expectedAud) throw new Error(`Bad id_token aud: ${payload.aud}`);
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw new Error('id_token expired');
  }
  if (payload.nonce !== expectedNonce) throw new Error('id_token nonce mismatch');

  const jwks = await getJwks(fetchImpl);
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('id_token signed by unknown key');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = createVerify('RSA-SHA256')
    .update(`${h}.${p}`)
    .verify(key, b64urlDecode(sig));
  if (!ok) throw new Error('id_token signature invalid');
  return payload;
}

function openaiSub(claims, clientId) {
  // Key on issuer + client_id + sub, NOT email alone.
  return `${ISSUER}|${clientId}|${claims.sub}`;
}

function persistTokens(userId, tokenBody) {
  const updates = [];
  if (tokenBody.access_token) {
    updates.push(['access_token', encryptToken(tokenBody.access_token)]);
    const expiresIn = Number(tokenBody.expires_in) || 3600;
    updates.push(['token_expires_at', String(Math.floor(Date.now() / 1000) + expiresIn - 60)]);
  }
  if (tokenBody.refresh_token) {
    updates.push(['refresh_token', encryptToken(tokenBody.refresh_token)]);
  }
  if (tokenBody.scope && typeof tokenBody.scope === 'string') {
    const granted = tokenBody.scope.split(/\s+/).includes('chatgpt.tokens.use.direct');
    updates.push(['plan_scope_granted', granted ? '1' : '0']);
  }
  // A real client id (oaiapp_...) may be issued — persist and use from now on.
  if (tokenBody.client_id && /^oaiapp_/.test(tokenBody.client_id)) {
    configSet('oauth_client_id', tokenBody.client_id);
  }
  if (updates.length === 0) return;
  const set = updates.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(
    ...updates.map(([, v]) => v),
    userId
  );
}

export async function handleCallback({ code, state, port, appUrl }, fetchImpl = fetch) {
  const p = consumePending(state);
  if (!p) throw new Error('Invalid or expired OAuth state — please try signing in again.');
  const clientId = getClientId();
  const tokenBody = await exchangeCode(
    { code, codeVerifier: p.codeVerifier, redirectUri: p.redirectUri, clientId },
    fetchImpl
  );
  if (!tokenBody.id_token) throw new Error('Token response did not include an id_token');
  const claims = await validateIdToken(
    tokenBody.id_token,
    { expectedAud: clientId, expectedNonce: p.nonce },
    fetchImpl
  );
  const sub = openaiSub(claims, clientId);

  let user = db.prepare(`SELECT * FROM users WHERE openai_sub = ?`).get(sub);
  if (!user) {
    const info = db
      .prepare(
        `INSERT INTO users (openai_sub, name, email, picture) VALUES (?, ?, ?, ?)`
      )
      .run(sub, claims.name || null, claims.email || null, claims.picture || null);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(info.lastInsertRowid));
  } else {
    db.prepare(
      `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email),
        picture = COALESCE(?, picture), updated_at = datetime('now') WHERE id = ?`
    ).run(claims.name || null, claims.email || null, claims.picture || null, user.id);
  }
  persistTokens(user.id, tokenBody);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function getSessionUser(req) {
  const cookies = parseCookies(req);
  const userId = verifySession(cookies.sid);
  if (!userId) return null;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  return user || null;
}

export function setSessionCookie(res, userId) {
  res.setHeader(
    'Set-Cookie',
    `sid=${signSession(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function clearUserTokens(userId) {
  db.prepare(
    `UPDATE users SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL,
     plan_scope_granted = 0, updated_at = datetime('now') WHERE id = ?`
  ).run(userId);
}

export function disconnectUser(userId) {
  clearUserTokens(userId);
}

// Refresh the access token when expired (~1h lifetime). Throws with
// code='invalid_grant' when the refresh token is rejected (user must re-sign).
export async function ensureFreshTokens(userId, fetchImpl = fetch) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!user || !user.refresh_token) {
    const e = new Error('No stored credentials — please sign in again.');
    e.code = 'invalid_grant';
    throw e;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (user.access_token && user.token_expires_at && user.token_expires_at > nowSec + 60) {
    return { accessToken: decryptToken(user.access_token), user };
  }
  try {
    const body = await refreshAccessToken(
      { refreshToken: decryptToken(user.refresh_token), clientId: getClientId() },
      fetchImpl
    );
    persistTokens(userId, body);
    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    return { accessToken: decryptToken(fresh.access_token), user: fresh };
  } catch (err) {
    if (err.code === 'invalid_grant' || /invalid_grant/.test(err.message || '')) {
      clearUserTokens(userId);
      const e = new Error('Session expired — please sign in with ChatGPT again.');
      e.code = 'invalid_grant';
      throw e;
    }
    throw err;
  }
}

// Plan-usage pause after hitting the weekly cap (per user, in-memory).
const planPausedUntil = new Map();
export function pausePlan(userId, ms = 3600 * 1000) {
  planPausedUntil.set(userId, Date.now() + ms);
}
export function isPlanPaused(userId) {
  const until = planPausedUntil.get(userId);
  if (!until) return false;
  if (until < Date.now()) {
    planPausedUntil.delete(userId);
    return false;
  }
  return true;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    planScopeGranted: user.plan_scope_granted === 1,
    signedIn: !!user.access_token,
  };
}

// Optional boot-time validation against the OIDC discovery document.
export async function validateOpenIdConfiguration() {
  try {
    const res = await fetch(OPENID_CONFIG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    if (doc.issuer !== ISSUER) {
      console.warn(`⚠️  OpenID discovery issuer mismatch: ${doc.issuer}`);
    } else {
      console.log('✓ OpenAI OpenID configuration validated (issuer https://auth.openai.com)');
    }
  } catch (err) {
    console.warn(`⚠️  Could not validate OpenAI OpenID configuration at boot: ${err.message}`);
  }
}
