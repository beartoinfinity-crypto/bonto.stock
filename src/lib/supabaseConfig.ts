// supabaseConfig.ts — public, read-only Supabase credentials for the app's
// stock-data project. Committed deliberately so the deployed Render bundle can
// read public.stock_price_history / stock_quotes without build-time .env vars.
//
// These are PUBLIC anon credentials (RLS protects the data for anon reads of
// the tables that expose them). This is the same pattern already used for the
// StockSpill congress-trades project in index.js. Never put a service-role key
// here.

export const SUPABASE_STOCK_PROJECT_URL = 'https://qwezfxdfaistnabwqols.supabase.co';

export const SUPABASE_STOCK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3ZXpmeGRmYWlzdG5hYndxb2xzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNDQxMzQsImV4cCI6MjA4NDYyMDEzNH0.aJMjxcRdvaSEHkVZziruVSpwh7aYkrD8GyOD7hpFZFE';
