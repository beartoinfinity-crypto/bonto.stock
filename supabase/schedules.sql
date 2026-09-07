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

-- ── Stock data: 06:00 UTC Mon-Fri ──────────────────────────────────────────
select cron.schedule(
  'stockpulse-sync-stock-data',
  '0 6 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/sync-stock-data',
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
-- (after the 06:00 quotes sync so the sim trades at the day's fresh prices)
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
select jobname, schedule, active from cron.job;   -- expect 4 active jobs

-- Recreate (unschedule first, then re-run the block above):
-- select cron.unschedule('stockpulse-sync-stock-data');
-- select cron.unschedule('stockpulse-sync-politician-trades');
-- select cron.unschedule('stockpulse-sync-featured-trades');
-- select cron.unschedule('stockpulse-simulate-ledger');

-- Manual fire (returns a request id; check ~30s later — see DEPLOY.md):
-- select id, status_code, content from net._http_response where id = <id>;

-- Data-freshness verification (ground truth, immune to the 5s pg_net timeout):
--   06:00 job: select symbol, updated_at from stock_quotes order by updated_at desc limit 3;
--   07:00 job: select updated_at from stockpulse_kv where key = 'stockpulse_politician_trades';
--   07:30 job: select count(*), max(updated_at) from politician_featured_trades;
--   12:00 job: select updated_at, value::jsonb ->> 'lastRunDate' from stockpulse_kv
--                where key = 'stockpulse_trade_ledger';
