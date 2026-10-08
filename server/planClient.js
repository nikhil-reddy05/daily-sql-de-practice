// Plan-backed AI calls: POST https://api.openai.com/v1/responses with the
// USER's ChatGPT access token. Plan usage requires store:false AND stream:true,
// so this client parses the SSE stream and assembles text from
// response.output_text.delta events.

import { ensureFreshTokens, isPlanPaused } from './auth.js';
import { extractJson } from './ai.js';

export const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

export class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlanError';
    this.code = code; // cap_reached | not_eligible | invalid_user | request_failed
  }
}

// Pure + testable: fold one SSE data payload into the accumulator.
export function foldSseEvent(acc, data) {
  let evt;
  try {
    evt = JSON.parse(data);
  } catch {
    return acc; // ignore malformed frames
  }
  const type = evt.type || '';
  if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
    acc.text += evt.delta;
  } else if (type === 'response.failed') {
    const code =
      evt.response?.error?.code || evt.error?.code || evt.code || 'unknown';
    acc.failedCode = code;
  } else if (type === 'response.incomplete') {
    acc.incomplete = true;
  }
  return acc;
}

// Pure + testable: assemble full text from a raw SSE body.
export function assembleSse(bodyText) {
  const acc = { text: '', failedCode: null, incomplete: false };
  for (const chunk of bodyText.split('\n\n')) {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (t.startsWith('data:')) foldSseEvent(acc, t.slice(5).trim());
    }
  }
  return acc;
}

// Pure + testable: map an HTTP error from the Responses API to a PlanError.
export function mapPlanHttpError(status, body) {
  const code =
    body?.error?.code || body?.code || (typeof body?.error === 'string' ? body.error : null);
  const message = body?.error?.message || body?.message || `HTTP ${status}`;
  if (status === 429 && code === 'subscription_sharing_usage_limit_exceeded') {
    return new PlanError(
      'cap_reached',
      `ChatGPT plan cap reached for this app. Manage usage: ${MANAGE_USAGE_URL}`
    );
  }
  if (status === 403 && code === 'subscription_sharing_user_not_eligible') {
    return new PlanError(
      'not_eligible',
      'This ChatGPT account is not eligible for plan-backed API usage (Plus/Pro required). Use an API key instead.'
    );
  }
  if (status === 401 && code === 'subscription_sharing_invalid_user') {
    return new PlanError('invalid_user', 'ChatGPT session invalid — please sign in again.');
  }
  return new PlanError('request_failed', `Plan request failed: ${message}`);
}

async function readSseStream(res, onFailed) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const acc = { text: '', failedCode: null, incomplete: false };
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        const t = line.trim();
        if (t.startsWith('data:')) {
          if (t.slice(5).trim() === '[DONE]') continue;
          foldSseEvent(acc, t.slice(5).trim());
          if (acc.failedCode && onFailed) onFailed(acc.failedCode);
        }
      }
    }
    if (acc.failedCode) break;
  }
  return acc;
}

export function planModel() {
  return (process.env.AI_MODEL || '').trim() || 'gpt-5-mini';
}

export async function planComplete(
  prompt,
  { json = false, userId, timeoutMs = 120000, fetchImpl = fetch } = {}
) {
  if (isPlanPaused(userId)) {
    throw new PlanError('cap_reached', 'Plan usage is paused after hitting the cap. Try again later.');
  }
  const { accessToken } = await ensureFreshTokens(userId, fetchImpl);

  const body = {
    model: planModel(),
    input: [{ role: 'user', content: prompt }],
    store: false,
    stream: true,
  };
  if (json) body.text = { format: { type: 'json_object' } };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new PlanError('request_failed', 'Plan request timed out');
    throw new PlanError('request_failed', `Plan request failed: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
    throw mapPlanHttpError(res.status, parsed);
  }

  const acc = await readSseStream(res, (code) => {
    throw mapPlanHttpError(429, { error: { code } });
  });
  if (acc.failedCode) throw mapPlanHttpError(429, { error: { code: acc.failedCode } });
  if (!acc.text) throw new PlanError('request_failed', 'Plan returned an empty response');
  return json ? extractJson(acc.text) : acc.text;
}
