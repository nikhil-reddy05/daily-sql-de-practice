// Token encryption at rest + session signing.
// TOKENS_KEY: from env (any string; hashed to 32 bytes). If missing, a random
// key is generated once and stored in the local config table — data/app.db must
// then be kept safe, and deleting it makes stored OAuth tokens unreadable.
// SESSION_SECRET: from env, else generated + stored locally. Both warn loudly.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { configGet, configSet } from './db.js';

let warnedTokensKey = false;
let warnedSessionSecret = false;

function tokensKey() {
  if (process.env.TOKENS_KEY && process.env.TOKENS_KEY.trim()) {
    return createHash('sha256').update(process.env.TOKENS_KEY.trim()).digest();
  }
  let hex = configGet('tokens_key');
  if (!hex) {
    hex = randomBytes(32).toString('hex');
    configSet('tokens_key', hex);
    warnedTokensKey = true;
  }
  return Buffer.from(hex, 'hex');
}

function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return process.env.SESSION_SECRET.trim();
  }
  let s = configGet('session_secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    configSet('session_secret', s);
    warnedSessionSecret = true;
  }
  return s;
}

export function cryptoBootWarnings() {
  // Touch both so generation happens once at boot, then warn.
  tokensKey();
  sessionSecret();
  if (warnedTokensKey) {
    console.warn(
      '\n⚠️  SECURITY: TOKENS_KEY is not set — a random encryption key was generated and stored ' +
        'in data/app.db. Your ChatGPT OAuth tokens are encrypted, but anyone with data/app.db can ' +
        'decrypt them. Set TOKENS_KEY in .env for a stable key.\n'
    );
  }
  if (warnedSessionSecret) {
    console.warn(
      '\n⚠️  SECURITY: SESSION_SECRET is not set — a random secret was generated and stored in ' +
        'data/app.db. Set SESSION_SECRET in .env for production use.\n'
    );
  }
}

export function encryptToken(plain) {
  const key = tokensKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptToken(payload) {
  const key = tokensKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Session cookie value: "<userId>.<hex hmac>"
export function signSession(userId) {
  const h = createHmac('sha256', sessionSecret()).update(String(userId)).digest('hex');
  return `${userId}.${h}`;
}

export function verifySession(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return null;
  const userId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(userId)) return null;
  const expected = createHmac('sha256', sessionSecret()).update(userId).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? Number(userId) : null;
}
