import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Popular stocks to sync daily
const POPULAR_STOCKS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'INTC', 'NFLX',
  'JPM', 'BAC', 'WFC', 'GS', 'V', 'MA', 'PYPL',
  'JNJ', 'PFE', 'UNH', 'MRK', 'ABBV', 'LLY',
  'XOM', 'CVX', 'COP',
  'DIS', 'NKE', 'SBUX', 'MCD', 'WMT', 'TGT', 'COST', 'HD',
  'BA', 'CAT', 'GE', 'MMM', 'HON', 'UPS',
  'KO', 'COKE', 'PEP', 'PG',
  'CRM', 'ORCL', 'ADBE', 'NOW', 'SNOW',
  'VZ', 'T', 'TMUS',
  'AMT', 'PLD',
  // Defense & Aerospace
  'LMT', 'RTX', 'NOC', 'GD',
  // Fintech & Growth
  'COIN', 'SOFI', 'SQ', 'PLTR', 'NET', 'CRWD', 'UBER',
  // Semiconductors
  'AVGO', 'TSM', 'QCOM', 'ARM',
  // Major ETFs
  'SPY', 'QQQ', 'DIA', 'IWM'
];

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Protect sync endpoint with a shared secret.
    // Require the secret to be sent via the Authorization header only — never
    // via URL query params, which get captured in access/CDN/browser logs.
    const authHeader = req.headers.get('Authorization') || '';
    const SYNC_SECRET = Deno.env.get('SYNC_SECRET');
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : '';

    if (SYNC_SECRET && bearerToken !== SYNC_SECRET) {
      console.warn('Unauthorized sync attempt');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const TWELVE_DATA_API_KEY = Deno.env.get('TWELVE_DATA_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TWELVE_DATA_API_KEY) {
      console.error('TWELVE_DATA_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Supabase credentials not configured');
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for bypassing RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const url = new URL(req.url);
    const symbolParam = url.searchParams.get('symbol');
    const mode = url.searchParams.get('mode') || 'incremental'; // 'incremental' or 'full'

    // If specific symbol provided, sync only that one
    const symbolsToSync = symbolParam ? [symbolParam.toUpperCase()] : POPULAR_STOCKS;

    console.log(`Starting ${mode} sync for ${symbolsToSync.length} stocks`);

    const results: { symbol: string; status: string; rowsAdded: number; error?: string }[] = [];

    for (const symbol of symbolsToSync) {
      try {
        console.log(`Syncing ${symbol}...`);

        // For incremental mode, get the latest date we have for this symbol
        let outputSize = 30; // Default: last 30 days for incremental
        
        if (mode === 'full') {
          outputSize = 2500; // Max available from Twelve Data free tier
        } else {
          // Check what's the latest date we have
          const { data: latestRecord } = await supabase
            .from('stock_price_history')
            .select('date')
            .eq('symbol', symbol)
            .order('date', { ascending: false })
            .limit(1)
            .single();

          if (latestRecord) {
            // Calculate days since last record
            const lastDate = new Date(latestRecord.date);
            const today = new Date();
            const daysDiff = Math.ceil((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            outputSize = Math.max(daysDiff + 5, 10); // Add buffer, minimum 10
            console.log(`${symbol}: Last record ${latestRecord.date}, fetching ${outputSize} days`);
          } else {
            // No data exists, do a full sync for this symbol
            outputSize = 2500;
            console.log(`${symbol}: No existing data, doing full sync`);
          }
        }

        // Fetch from Twelve Data
        const apiUrl = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=${outputSize}&apikey=${TWELVE_DATA_API_KEY}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.status === 'error' || data.code) {
          console.error(`API error for ${symbol}:`, data.message || data);
          results.push({ symbol, status: 'error', rowsAdded: 0, error: data.message || 'API error' });
          continue;
        }

        if (!data.values || data.values.length === 0) {
          console.warn(`No data returned for ${symbol}`);
          results.push({ symbol, status: 'no_data', rowsAdded: 0 });
          continue;
        }

        // Transform data for upsert
        const records = data.values.map((candle: TwelveDataCandle) => ({
          symbol,
          date: candle.datetime,
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
          volume: parseInt(candle.volume, 10) || 0,
        }));

        // Upsert data (insert or update on conflict)
        const { error: upsertError } = await supabase
          .from('stock_price_history')
          .upsert(records, { 
            onConflict: 'symbol,date',
            ignoreDuplicates: false 
          });

        if (upsertError) {
          console.error(`Upsert error for ${symbol}:`, upsertError);
          results.push({ symbol, status: 'error', rowsAdded: 0, error: upsertError.message });
          continue;
        }

        console.log(`${symbol}: Upserted ${records.length} records`);
        results.push({ symbol, status: 'success', rowsAdded: records.length });

        // Rate limiting: Twelve Data free tier has 8 requests/minute
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds between requests

      } catch (error) {
        console.error(`Error syncing ${symbol}:`, error);
        results.push({ 
          symbol, 
          status: 'error', 
          rowsAdded: 0, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    const summary = {
      totalSymbols: symbolsToSync.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'error').length,
      noData: results.filter(r => r.status === 'no_data').length,
      totalRowsAdded: results.reduce((sum, r) => sum + r.rowsAdded, 0),
      results,
    };

    console.log('Sync complete:', summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Sync failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
