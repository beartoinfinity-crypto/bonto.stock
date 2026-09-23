// deno-lint-ignore-file no-explicit-any
// Thin upsert sink for the local Kadoa backfill orchestrator
// (scripts/backfill-kadoa.cjs). Receives pre-mapped politician_trades rows
// and writes them in chunks. Auth: x-cron-secret.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CHUNK = 200;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true;
  return req.headers.get('x-cron-secret') === secret;
}

Deno.serve(async (req) => {
  try {
    if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => null);
    const rows = Array.isArray(body) ? body : body?.rows;
    const counts = !Array.isArray(body) ? body?.counts : undefined;
    const hasCounts = counts && typeof counts === 'object' && !Array.isArray(counts);
    if (!Array.isArray(rows)) {
      return jsonRes({ ok: false, error: 'expected { rows: [...] }' }, 400);
    }
    // Meta-only finalization: empty rows + counts is valid.
    if (rows.length === 0 && !hasCounts) {
      return jsonRes({ ok: false, error: 'expected { rows: [...] }' }, 400);
    }
    if (rows.length > 5000) {
      return jsonRes({ ok: false, error: 'batch too large (max 5000)' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let written = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('politician_trades')
        .upsert(chunk, { onConflict: 'source,external_id' });
      if (error) {
        for (const row of chunk) {
          const { error: rowErr } = await supabase
            .from('politician_trades')
            .upsert([row], { onConflict: 'source,external_id' });
          if (rowErr) skipped++;
          else written++;
        }
        continue;
      }
      written += chunk.length;
    }

    // Optional meta counts to merge into stockpulse_kadoa_meta
    if (hasCounts) {
      const { data: metaRow } = await supabase
        .from('stockpulse_kv')
        .select('value')
        .eq('key', 'stockpulse_kadoa_meta')
        .maybeSingle();
      let merged: Record<string, number> = {};
      try {
        merged = metaRow?.value ? JSON.parse(metaRow.value)?.counts ?? {} : {};
      } catch { /* fresh */ }
      merged = { ...merged, ...(counts as Record<string, number>) };
      await supabase.from('stockpulse_kv').upsert({
        key: 'stockpulse_kadoa_meta',
        value: JSON.stringify({ counts: merged, at: Date.now() }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }

    return jsonRes({ ok: true, received: rows.length, written, skipped });
  } catch (e) {
    return jsonRes({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
