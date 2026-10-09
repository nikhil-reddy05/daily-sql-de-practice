export interface Attempt {
  id: number;
  answer: string;
  score: number | null;
  verdict: string | null;
  strengths: string[];
  gaps: string[];
  improved_answer: string | null;
  created_at: string;
}

export interface Challenge {
  id: number;
  ordinal: number;
  track: 'sql' | 'de';
  title: string;
  difficulty: 'foundation' | 'intermediate' | 'advanced';
  topics: string[];
  statement: string;
  schema_sql: string | null;
  hints: string[];
  rubric: string | null;
  attempts: Attempt[];
}

export interface TodaySet {
  date_key: string;
  source: 'ai' | 'ai-plan' | 'ai-key' | 'seed';
  aiConfigured: boolean;
  planNotice?: { type: string; message: string; manageUrl?: string };
  auth: { signedIn: boolean; planScopeGranted: boolean; planPaused: boolean };
  challenges: Challenge[];
}

export interface AuthMe {
  signedIn: boolean;
  planScopeGranted: boolean;
  planPaused: boolean;
  user: { id: number; name: string | null; email: string | null; picture: string | null } | null;
}

export interface PracticeSettings {
  sql_enabled: boolean;
  de_enabled: boolean;
  sql_count: number;
  de_count: number;
}

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  baseUrlConfigured: boolean;
  keyConfigured: boolean;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  today: () => req<TodaySet>('/api/today'),
  regenerate: () =>
    req<TodaySet>('/api/today/regenerate', { method: 'POST' }),
  challenge: (id: number) => req<Challenge & { reference_answer: string }>(`/api/challenges/${id}`),
  attempt: (id: number, answer: string) =>
    req<{
      aiConfigured: boolean;
      review: { score: number; verdict: string; strengths: string[]; gaps: string[]; improved_answer: string } | null;
      reviewError: string | null;
      message?: string;
      attempt: Attempt;
    }>(`/api/challenges/${id}/attempt`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
  progress: () =>
    req<{
      streak: number;
      settings: PracticeSettings;
      recommended: {
        sql: { difficulty: string; average: number | null };
        de: { difficulty: string; average: number | null };
      };
      weakTopics: { topic: string; track: string; attempts: number; avg: number }[];
      topics: { topic: string; track: string; attempts: number; avg: number }[];
      last14: { date_key: string; completed: number; attempts: number }[];
      aiConfigured: boolean;
    }>('/api/progress'),
  history: () =>
    req<{ days: { date_key: string; completed: number; challenges: number; attempts: number }[] }>(
      '/api/history'
    ),
  aiStatus: () => req<AiStatus>('/api/ai/status'),
  aiTest: () => req<{ ok: boolean; message: string }>('/api/ai/test', { method: 'POST' }),
  settings: () => req<PracticeSettings>('/api/settings'),
  updateSettings: (s: PracticeSettings) =>
    req<PracticeSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  authMe: () => req<AuthMe>('/api/auth/me'),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
};
