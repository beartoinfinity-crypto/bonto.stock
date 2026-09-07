-- ============================================================================
-- Server-side schedules for the StockPulse Edge Functions
--
-- CURRENTLY LIVE on project aqyaarnpmvvdzasjefje (4 active jobs).
--
-- Prerequisites:
--   1. Functions deployed with --no-verify-jwt (see DEPLOY.md):
--        npx.cmd supabase functions deploy <fn> --no-verify-jwt
--   2. CRON_SECRET set:  npx.cmd supabase secrets set CRON_SECRET=...
--   3. Extensions enabled (Dashboard -> Database -> Extensions):
--        pg_cron, pg_net
--
-- Fill in <CRON_SECRET> below, then run this whole file in
-- Dashboard -> SQL Editor. Functions are deployed with JWT verification OFF,
-- so the x-cron-secret header alone authenticates each call.
--
-- NOTE: pg_net waits only 5s for a response. sync-stock-data (~60s) will show
-- a "Timeout of 5000 ms" in net._http_response — the function still completes.
-- Verify by data freshness (see DEPLOY.md), not by recorded status codes.
-- ============================================================================

-- ── Stock data: index universe (S&P 500 ∪ NASDAQ-100, 80 symbols) ──────────
-- Split into 3 batches, staggered after the US trading close (4pm ET) to stay
-- clear of Yahoo rate limits. Each batch syncs ~27 symbols (quotes + 10y bars).
select cron.schedule(
  'stockpulse-sync-stock-data-batch-1',
  '0 22 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/sync-stock-data?batch=1',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'stockpulse-sync-stock-data-batch-2',
  '0 23 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/sync-stock-data?batch=2',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'stockpulse-sync-stock-data-batch-3',
  '0 0 * * 2-6',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/sync-stock-data?batch=3',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Politician trades: 07:00 UTC Mon-Fri ───────────────────────────────────
select cron.schedule(
  'stockpulse-sync-politician-trades',
  '0 7 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/sync-politician-trades',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Featured trades (Trump + Pelosi): 07:30 UTC daily ──────────────────────
select cron.schedule(
  'stockpulse-sync-featured-trades',
  '30 7 * * *',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/sync-featured-trades',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Simulate traders ledger: 12:00 UTC Mon-Fri ─────────────────────────────
-- (the previous evening's 22:00-00:00 stock batches already refreshed prices,
--  so the sim trades at the latest close; 12:00 UTC = pre-open US)
select cron.schedule(
  'stockpulse-simulate-ledger',
  '0 12 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/simulate-ledger',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verify / manage ────────────────────────────────────────────────────────
select jobname, schedule, active from cron.job;   -- expect 6 active jobs

-- Recreate (unschedule first, then re-run the block above):
-- select cron.unschedule('stockpulse-sync-stock-data-batch-1');
-- select cron.unschedule('stockpulse-sync-stock-data-batch-2');
-- select cron.unschedule('stockpulse-sync-stock-data-batch-3');
-- select cron.unschedule('stockpulse-sync-politician-trades');
-- select cron.unschedule('stockpulse-sync-featured-trades');
-- select cron.unschedule('stockpulse-simulate-ledger');
-- Legacy name from the pre-batch setup:
-- select cron.unschedule('stockpulse-sync-stock-data');

-- Manual fire (returns a request id; check ~30s later — see DEPLOY.md):
-- select id, status_code, content from net._http_response where id = <id>;

-- Data-freshness verification (ground truth, immune to the 5s pg_net timeout):
--   Stock batches (22/23/00 UTC): select symbol, updated_at from stock_quotes order by updated_at desc limit 3;
--     — after all 3 batches: select count(*) from stock_quotes;  -- expect ~80
--   07:00 job: select updated_at from stockpulse_kv where key = 'stockpulse_politician_trades';
--   07:30 job: select count(*), max(updated_at) from politician_featured_trades;
--   12:00 job: select updated_at, value::jsonb ->> 'lastRunDate' from stockpulse_kv
--                where key = 'stockpulse_trade_ledger';
