import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory rate limiter (per-instance).
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'Service misconfigured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);
    const symbolParam = url.searchParams.get('symbol')?.toUpperCase().trim();
    const politicianParam = url.searchParams.get('politician')?.trim();
    const side = url.searchParams.get('side')?.toUpperCase().trim(); // BUY | SELL

    // Validate symbol if provided.
    if (symbolParam && !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(symbolParam)) {
      return new Response(JSON.stringify({ error: 'Invalid symbol format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (side && !['BUY', 'SELL'].includes(side)) {
      return new Response(JSON.stringify({ error: 'Invalid side' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (politicianParam && politicianParam.length > 80) {
      return new Response(JSON.stringify({ error: 'Invalid politician' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let q = supabase
      .from('politician_trades')
      .select('symbol, politician, transaction_date, filing_date, transaction_type, amount_from, amount_to, asset_name, owner_type, position_held, source')
      .order('transaction_date', { ascending: false })
      .order('filing_date', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (symbolParam) q = q.eq('symbol', symbolParam);
    if (politicianParam) q = q.ilike('politician', `%${politicianParam}%`);
    if (side) q = q.eq('transaction_type', side);

    const { data, error } = await q;
    if (error) {
      console.error('DB error:', error);
      return new Response(JSON.stringify({ error: 'Query failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = (data || []).map((r) => ({
      ...r,
      amount_from: r.amount_from === null ? null : Number(r.amount_from),
      amount_to: r.amount_to === null ? null : Number(r.amount_to),
    }));

    return new Response(JSON.stringify({ count: rows.length, trades: rows }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Data-Source': 'database',
      },
    });
  } catch (e) {
    console.error('politician-trades error', e);
    return new Response(JSON.stringify({ error: 'Unable to process request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
