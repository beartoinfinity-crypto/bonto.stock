// Thin wrapper for Supabase edge function calls
// Used by features that need server-side computation (stock-data news,
// analyze-news-sentiment, social-sentiment, asymmetric-value-screener).
//
// Config resolution (secrets must never be baked into the committed dist
// bundle — GitHub push protection blocks that):
//   1. GET /api/edge-config — EDGE_FN_URL / EDGE_FN_KEY env vars on Render
//      (configure once, every browser gets it; the key is the public anon key)
//   2. VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — local dev only
//      (gitignored .env)
// The promise is cached; failures clear the cache so the next call retries.

interface EdgeFnConfig {
  url: string;
  key: string;
}

let edgeConfigPromise: Promise<EdgeFnConfig | null> | null = null;

function edgeConfigFromEnv(): EdgeFnConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  return url && key ? { url, key } : null;
}

function fetchEdgeConfig(): Promise<EdgeFnConfig | null> {
  if (!edgeConfigPromise) {
    edgeConfigPromise = (async () => {
      try {
        const res = await fetch('/api/edge-config');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.url && cfg.anonKey) return { url: cfg.url, key: cfg.anonKey } as EdgeFnConfig;
        }
      } catch { /* server unreachable / cold start — retry next call */ }
      edgeConfigPromise = null; // don't cache failures
      return edgeConfigFromEnv();
    })();
  }
  return edgeConfigPromise;
}

let resolvedConfig: EdgeFnConfig | null = null;

async function getConfig(): Promise<EdgeFnConfig | null> {
  if (!resolvedConfig) resolvedConfig = await fetchEdgeConfig();
  return resolvedConfig;
}

export async function isEdgeFnAvailable(): Promise<boolean> {
  return (await getConfig()) !== null;
}

function baseHeaders(key: string, extra?: Record<string, string>) {
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

export async function edgeFn<T = unknown>(
  functionName: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ data: T | null; error: string | null }> {
  const cfg = await getConfig();
  if (!cfg) {
    return { data: null, error: 'Edge functions not configured (set EDGE_FN_URL / EDGE_FN_KEY on Render, or VITE_SUPABASE_* in local .env)' };
  }
  try {
    const res = await fetch(`${cfg.url}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: baseHeaders(cfg.key, headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) {
      const msg = typeof json === 'string' ? json
        : (json as { error?: string; message?: string })?.error
          || (json as { error?: string; message?: string })?.message
          || `HTTP ${res.status}`;
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
  const cfg = await getConfig();
  if (!cfg) {
    return { data: null, error: 'Edge functions not configured', ok: false, status: 0, durationMs: 0 };
  }
  try {
    const res = await fetch(`${cfg.url}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: baseHeaders(cfg.key, headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = text; }
    return { data: json, error: res.ok ? null : `HTTP ${res.status}`, ok: res.ok, status: res.status, durationMs: Date.now() - start };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error', ok: false, status: 0, durationMs: Date.now() - start };
  }
}

/** Direct REST helper for edge-function-adjacent tables (e.g. avs_results).
 *  Uses the same runtime-resolved config. */
export async function edgeRest<T = unknown>(tablePath: string): Promise<T | null> {
  const cfg = await getConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${tablePath}`, {
      headers: baseHeaders(cfg.key),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
