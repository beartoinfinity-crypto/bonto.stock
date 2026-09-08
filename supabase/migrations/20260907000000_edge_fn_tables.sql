-- ============================================================================
-- Edge-function support tables for the CURRENT project (aqyaarnpmvvdzasjefje)
-- Run once in Dashboard -> SQL Editor.
--
-- Needed by: asymmetric-value-screener (avs_results),
--            social-sentiment (social_sentiment_cache),
--            stock-data (api_usage_log — optional, fn no-ops without it)
-- provider_config is NOT created: stock-data uses env secrets
-- (FINNHUB_API_KEY / TWELVE_DATA_API_KEY) instead.
-- ============================================================================

-- 1) AVS results (asymmetric-value-screener upserts here, dashboard reads)
create table if not exists avs_results (
  symbol text primary key,
  name text,
  sector text,
  cluster_count integer,
  cluster_value bigint,
  net_buy_value bigint,
  asset_value_score double precision,
  asset_value_note text,
  total_score double precision,
  classification text,
  computed_at timestamptz not null default now()
);
alter table avs_results enable row level security;
create policy "Allow all for anon" on avs_results
  for all using (true) with check (true);

-- 2) Social sentiment cache (social-sentiment fn dedupes/throttles here)
create table if not exists social_sentiment_cache (
  id text primary key,
  symbol text not null,
  action text,
  sentiment text,
  confirmation text,
  confidence integer,
  themes jsonb,
  sources jsonb,
  created_at timestamptz not null default now()
);
alter table social_sentiment_cache enable row level security;
create policy "Allow all for anon" on social_sentiment_cache
  for all using (true) with check (true);

-- 3) API usage log (optional telemetry; stock-data no-ops when missing)
create table if not exists api_usage_log (
  id bigint generated always as identity primary key,
  provider text not null,
  action text not null,
  symbol text,
  success boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);
alter table api_usage_log enable row level security;
create policy "Allow all for anon" on api_usage_log
  for all using (true) with check (true);
