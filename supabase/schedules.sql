-- ============================================================================
-- Server-side schedules for the StockPulse Edge Functions
--
-- Prerequisites:
--   1. Functions deployed (see scripts/deploy-edge-functions.ps1)
--   2. Extensions enabled (Dashboard -> Database -> Extensions):
--        pg_cron, pg_net   (usually pre-enabled on new projects)
--
-- Fill in the three placeholders below, then run this whole file in
-- Dashboard -> SQL Editor.
--
--   <PROJECT_REF>      abc123.supabase.co  ->  abc123
--   <ANON_KEY>         Dashboard -> Settings -> API -> anon public
--                          (JWT verification ON)  -- OR --
--                      deploy with --no-verify-jwt and keep any dummy token;
--                      prefer keeping JWT on and using the anon key.
--   <CRON_SECRET>      value from `supabase secrets set CRON_SECRET=...`
-- ============================================================================

-- ── Stock data: 06:00 UTC Mon-Fri ──────────────────────────────────────────
select cron.schedule(
  'stockpulse-sync-stock-data',
  '0 6 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-stock-data',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
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
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-politician-trades',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Featured trades (Trump + Pelosi): 07:30 UTC daily ────────────────────────
select cron.schedule(
  'stockpulse-sync-featured-trades',
  '30 7 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-featured-trades',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Simulate traders ledger: 12:00 UTC Mon-Fri ───────────────────────────────
-- (after the 06:00 quotes sync so the sim trades at the day's fresh prices)
select cron.schedule(
  'stockpulse-simulate-ledger',
  '0 12 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/simulate-ledger',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verify / manage ────────────────────────────────────────────────────────
select jobname, schedule, active from cron.job;              -- list jobs
select cron.unschedule('stockpulse-sync-stock-data');        -- remove one
select cron.unschedule('stockpulse-sync-politician-trades'); -- remove other
select cron.unschedule('stockpulse-sync-featured-trades');
select cron.unschedule('stockpulse-simulate-ledger');

-- Recent runs (status codes: 200 = ok)
select runid, job_pid, status, return_message, start_time
from cron.job_run_details
order by start_time desc limit 20;
