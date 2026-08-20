import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-password',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Edge functions that can be triggered manually from the panel
const RUNNABLE: Record<string, { label: string; body?: unknown }> = {
  'sync-stock-data': { label: 'Daily historical price sync' },
  'compute-screener': { label: 'Screener recompute' },
  'compute-tactical-history': { label: 'Tactical after-close history' },
  'sync-politician-trades': { label: 'Politician trades sync' },
  'sync-trump-trades': { label: 'Trump / OGE filings sync' },
  'asymmetric-value-screener': { label: 'Asymmetric Value Screener' },
};

const PROVIDERS = ['finnhub', 'twelvedata', 'yahoo', 'stooq'];

/* ---------- minimal cron next-run calculation (UTC) ---------- */
function expand(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? parseInt(stepRaw, 10) : 1;
    let lo = min, hi = max;
    if (range !== '*') {
      const bits = range.split('-');
      lo = parseInt(bits[0], 10);
      hi = bits[1] !== undefined ? parseInt(bits[1], 10) : (stepRaw ? max : lo);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
}

function nextRun(schedule: string): string | null {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5) return null;
  try {
    const mins = expand(f[0], 0, 59);
    const hours = expand(f[1], 0, 23);
    const doms = expand(f[2], 1, 31);
    const months = expand(f[3], 1, 12);
    const dows = expand(f[4], 0, 6).map((d) => (d === 7 ? 0 : d));
    const d = new Date();
    d.setUTCSeconds(0, 0);
    d.setUTCMinutes(d.getUTCMinutes() + 1);
    for (let i = 0; i < 366 * 24 * 60; i++) {
      const domWild = f[2] === '*';
      const dowWild = f[4] === '*';
      const dayOk = domWild && dowWild
        ? true
        : domWild
          ? dows.includes(d.getUTCDay())
          : dowWild
            ? doms.includes(d.getUTCDate())
            : doms.includes(d.getUTCDate()) || dows.includes(d.getUTCDay());
      if (
        mins.includes(d.getUTCMinutes()) &&
        hours.includes(d.getUTCHours()) &&
        months.includes(d.getUTCMonth() + 1) &&
        dayOk
      ) {
        return d.toISOString();
      }
      d.setUTCMinutes(d.getUTCMinutes() + 1);
    }
  } catch (_) {
    return null;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ADMIN_PASSWORD = Deno.env.get('ADMIN_PANEL_PASSWORD');

  try {
    const password =
      req.headers.get('x-admin-password') ||
      (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

    if (!ADMIN_PASSWORD) {
      return json({ error: 'Admin panel password is not configured' }, 503);
    }
    if (!password || password !== ADMIN_PASSWORD) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const payload = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action: string = payload.action ?? new URL(req.url).searchParams.get('action') ?? 'overview';
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (action === 'overview') {
      const [{ data: providers }, { data: jobs }] = await Promise.all([
        supabase.rpc('admin_provider_usage'),
        supabase.rpc('admin_cron_jobs'),
      ]);

      const { data: recent } = await supabase
        .from('api_usage_log')
        .select('provider, action, symbol, success, status_code, note, created_at')
        .order('created_at', { ascending: false })
        .limit(40);

      const activeSource = recent && recent.length > 0 ? recent.find((r) => r.success)?.provider ?? null : null;

      const cronJobs = ((jobs as Array<Record<string, unknown>>) ?? []).map((j) => ({
        ...j,
        next_run: j.active ? nextRun(String(j.schedule)) : null,
      }));

      return json({
        providers: providers ?? [],
        cronJobs,
        recent: recent ?? [],
        activeSource,
        runnable: Object.entries(RUNNABLE).map(([name, v]) => ({ name, label: v.label })),
        serverTime: new Date().toISOString(),
      });
    }

    if (action === 'run') {
      const name = String(payload.function ?? '');
      if (!RUNNABLE[name]) return json({ error: 'Unknown function' }, 400);
      const started = Date.now();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ manual: true, ...(payload.payload ?? {}) }),
      });
      const text = await res.text();
      return json({
        ok: res.ok,
        status: res.status,
        durationMs: Date.now() - started,
        response: text.slice(0, 4000),
      });
    }

    if (action === 'update_provider') {
      const provider = String(payload.provider ?? '');
      if (!PROVIDERS.includes(provider)) return json({ error: 'Unknown provider' }, 400);
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof payload.api_key === 'string' && payload.api_key.trim().length > 0) {
        update.api_key = payload.api_key.trim();
      }
      if (payload.clear_key === true) update.api_key = null;
      if (payload.daily_quota !== undefined) {
        update.daily_quota = payload.daily_quota === null || payload.daily_quota === '' ? null : Number(payload.daily_quota);
      }
      if (payload.monthly_quota !== undefined) {
        update.monthly_quota = payload.monthly_quota === null || payload.monthly_quota === '' ? null : Number(payload.monthly_quota);
      }
      if (typeof payload.enabled === 'boolean') update.enabled = payload.enabled;
      if (typeof payload.notes === 'string') update.notes = payload.notes.slice(0, 300);

      const { error } = await supabase.from('provider_config').upsert({ provider, ...update }, { onConflict: 'provider' });
      if (error) return json({ error: 'Failed to update provider' }, 500);
      return json({ ok: true });
    }

    if (action === 'toggle_job') {
      // Enable / disable a scheduled job is not exposed for safety
      return json({ error: 'Not supported' }, 400);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('admin-ops error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
