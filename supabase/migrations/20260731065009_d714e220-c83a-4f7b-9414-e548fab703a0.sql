CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('avs-weekly-refresh') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avs-weekly-refresh');

SELECT cron.schedule(
  'avs-weekly-refresh',
  '30 8 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://qwezfxdfaistnabwqols.supabase.co/functions/v1/asymmetric-value-screener',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3ZXpmeGRmYWlzdG5hYndxb2xzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNDQxMzQsImV4cCI6MjA4NDYyMDEzNH0.aJMjxcRdvaSEHkVZziruVSpwh7aYkrD8GyOD7hpFZFE"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);