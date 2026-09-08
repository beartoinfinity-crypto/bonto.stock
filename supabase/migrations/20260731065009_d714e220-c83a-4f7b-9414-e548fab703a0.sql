CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('avs-weekly-refresh') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avs-weekly-refresh');

SELECT cron.schedule(
  'avs-weekly-refresh',
  '30 8 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/asymmetric-value-screener',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxeWFhcm5wbXZ2ZHphc2plZmplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NTI5NDUsImV4cCI6MjA4NDEyODk0NX0.jRnq1lbI3WBfjuwnOFtL9W9PG5LJt3tBCr_TO3uMQOA"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);