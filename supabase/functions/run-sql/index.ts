// deno-lint-ignore-file no-explicit-any
// SQL runner for migrations/schedules while `supabase db push` is blocked
// by the CLI login-role bug. Invoke with x-cron-secret. Body: { sql: string }

function jsonRes(body: unknown, status = 200) {
  // pg count()/bigint come back as BigInt — JSON.stringify throws on them.
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true;
  return req.headers.get('x-cron-secret') === secret;
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  const sql = typeof body?.sql === 'string' ? body.sql : '';
  if (!sql) return jsonRes({ ok: false, error: 'missing sql' }, 400);
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) return jsonRes({ ok: false, error: 'SUPABASE_DB_URL not set' }, 500);
  try {
    const { Client } = await import('https://deno.land/x/postgres@v0.17.0/mod.ts');
    const client = new Client(url);
    await client.connect();
    let rows: unknown[] = [];
    try {
      // queryArray supports multi-statement scripts (pg_cron + SELECTs).
      const result = await client.queryArray(sql);
      rows = (result.rows as unknown[]) ?? [];
    } finally {
      await client.end().catch(() => {});
    }
    return jsonRes({ ok: true, rows, rowCount: Array.isArray(rows) ? rows.length : null });
  } catch (e) {
    return jsonRes({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
