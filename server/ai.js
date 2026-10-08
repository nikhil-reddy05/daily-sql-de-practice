// Bring-your-own-AI layer.
// Providers: openai | anthropic | custom (any OpenAI-compatible endpoint).
// Env: AI_PROVIDER, AI_API_KEY, AI_MODEL (optional), AI_BASE_URL (optional,
// required for custom). The key is NEVER exposed via /api/ai/status.

const GENERATION_TIMEOUT_MS = 90000;
const TEST_TIMEOUT_MS = 30000;

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  custom: 'llama3.1',
};

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const baseUrl = (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
  const model = (process.env.AI_MODEL || '').trim() || DEFAULT_MODELS[provider] || '';
  return { provider, apiKey, baseUrl, model };
}

export function isConfigured() {
  const { provider, apiKey, baseUrl } = aiConfig();
  if (!['openai', 'anthropic', 'custom'].includes(provider)) return false;
  if (!apiKey) return false;
  if (provider === 'custom' && !baseUrl) return false;
  return true;
}

// Public status shape — never includes the key.
export function aiStatus() {
  const { provider, apiKey, baseUrl, model } = aiConfig();
  return {
    configured: isConfigured(),
    provider: provider || null,
    model: model || null,
    baseUrlConfigured: baseUrl.length > 0,
    keyConfigured: apiKey.length > 0,
  };
}

function baseFor(provider, baseUrl) {
  if (baseUrl) return baseUrl;
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  return '';
}

async function postJson(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`AI request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Pull a JSON object out of model text (tolerates code fences / prose).
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not contain a JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function chat(prompt, { json = false, timeoutMs = GENERATION_TIMEOUT_MS } = {}) {
  const { provider, apiKey, baseUrl, model } = aiConfig();
  if (!['openai', 'anthropic', 'custom'].includes(provider)) {
    throw new Error('AI_PROVIDER must be one of: openai, anthropic, custom');
  }
  if (!apiKey) throw new Error('AI_API_KEY is not set');
  const base = baseFor(provider, baseUrl);
  if (!base) throw new Error('AI_BASE_URL is required when AI_PROVIDER=custom');

  if (provider === 'anthropic') {
    const content =
      prompt + (json ? '\n\nRespond with valid JSON only. No markdown fences, no commentary.' : '');
    const data = await postJson(
      `${base}/v1/messages`,
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 4096, messages: [{ role: 'user', content }] },
      timeoutMs
    );
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (!text) throw new Error('AI returned an empty response');
    return json ? extractJson(text) : text;
  }

  // openai + custom (OpenAI-compatible chat completions)
  const body = { model, messages: [{ role: 'user', content: prompt }] };
  if (json) body.response_format = { type: 'json_object' };
  const data = await postJson(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${apiKey}` },
    body,
    timeoutMs
  );
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('AI returned an empty response');
  return json ? extractJson(text) : text;
}

export async function testConnection() {
  try {
    const out = await chat('Reply with exactly this JSON and nothing else: {"pong": true}', {
      json: true,
      timeoutMs: TEST_TIMEOUT_MS,
    });
    if (out && out.pong === true) return { ok: true, message: 'Connection OK — the model replied correctly.' };
    return { ok: true, message: 'Connected, but the ping reply had an unexpected shape.' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
