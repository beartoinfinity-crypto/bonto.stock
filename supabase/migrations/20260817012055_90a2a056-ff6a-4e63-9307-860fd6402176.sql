CREATE TABLE IF NOT EXISTS public.api_usage_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  action text not null default 'quote',
  symbol text,
  success boolean not null default true,
  status_code integer,
  note text,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS api_usage_log_provider_time_idx ON public.api_usage_log (provider, created_at DESC);
GRANT ALL ON public.api_usage_log TO service_role;
ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_usage_log_service_all" ON public.api_usage_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.provider_config (
  provider text primary key,
  api_key text,
  daily_quota integer,
  monthly_quota integer,
  enabled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.provider_config TO service_role;
ALTER TABLE public.provider_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provider_config_service_all" ON public.provider_config FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.provider_config (provider, daily_quota, monthly_quota, notes) VALUES
  ('finnhub', 86400, NULL, '60 requests/minute on free tier'),
  ('twelvedata', 800, NULL, '8 requests/minute, 800/day free tier'),
  ('yahoo', NULL, NULL, 'Keyless, unofficial - soft limits'),
  ('stooq', NULL, NULL, 'Keyless CSV endpoint - soft limits')
ON CONFLICT (provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_provider_usage()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
    SELECT p.provider,
           p.enabled,
           p.daily_quota,
           p.monthly_quota,
           (p.api_key IS NOT NULL AND length(p.api_key) > 0) AS has_key,
           p.notes,
           p.updated_at,
           coalesce(sum(CASE WHEN l.created_at > now() - interval '1 day' THEN 1 ELSE 0 END), 0)::int AS used_today,
           coalesce(sum(CASE WHEN l.created_at > now() - interval '30 days' THEN 1 ELSE 0 END), 0)::int AS used_month,
           coalesce(sum(CASE WHEN l.created_at > now() - interval '1 hour' THEN 1 ELSE 0 END), 0)::int AS used_hour,
           coalesce(sum(CASE WHEN l.success IS false AND l.created_at > now() - interval '1 day' THEN 1 ELSE 0 END), 0)::int AS errors_today,
           max(l.created_at) AS last_used_at
    FROM public.provider_config p
    LEFT JOIN public.api_usage_log l ON l.provider = p.provider
    GROUP BY p.provider, p.enabled, p.daily_quota, p.monthly_quota, p.api_key, p.notes, p.updated_at
    ORDER BY p.provider
  ) x;
$$;

CREATE OR REPLACE FUNCTION public.admin_cron_jobs()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron, extensions
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
    SELECT j.jobid, j.jobname, j.schedule, j.active,
           r.last_run, r.last_status, r.last_duration_ms
    FROM cron.job j
    LEFT JOIN LATERAL (
      SELECT d.start_time AS last_run, d.status AS last_status,
             (extract(epoch FROM (d.end_time - d.start_time)) * 1000)::int AS last_duration_ms
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
      ORDER BY d.start_time DESC
      LIMIT 1
    ) r ON true
    ORDER BY j.jobname
  ) x;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_usage() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_cron_jobs() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_provider_usage() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cron_jobs() TO service_role;