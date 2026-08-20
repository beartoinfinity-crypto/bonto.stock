// Thin wrapper for Supabase edge function calls
// Used only by features that still require server-side computation
// (social-sentiment, asymmetric-value-screener)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function isEdgeFnAvailable(): boolean {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

function baseHeaders(extra?: Record<string, string>) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

export async function edgeFn<T = unknown>(
  functionName: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ data: T | null; error: string | null }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { data: null, error: 'Edge functions not configured (no Supabase URL/key in .env)' };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: baseHeaders(headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) {
      const msg = typeof json === 'string' ? json : json?.error || json?.message || `HTTP ${res.status}`;
      return { data: null, error: msg };
    }
    return { data: json as T, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function edgeFnRaw(
  functionName: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ data: unknown; error: string | null; ok: boolean; status: number; durationMs: number }> {
  const start = Date.now();
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { data: null, error: 'Edge functions not configured', ok: false, status: 0, durationMs: 0 };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: baseHeaders(headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    return { data: json, error: res.ok ? null : `HTTP ${res.status}`, ok: res.ok, status: res.status, durationMs: Date.now() - start };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error', ok: false, status: 0, durationMs: Date.now() - start };
  }
}
