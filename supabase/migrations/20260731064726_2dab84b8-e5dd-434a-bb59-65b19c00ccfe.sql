CREATE TABLE public.avs_results (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT,
  price NUMERIC,
  market_cap NUMERIC,
  insider_count INTEGER NOT NULL DEFAULT 0,
  insider_value NUMERIC NOT NULL DEFAULT 0,
  insider_score NUMERIC NOT NULL DEFAULT 0,
  nav_per_share NUMERIC,
  tangible_nav_per_share NUMERIC,
  nav_discount NUMERIC,
  pb_ratio NUMERIC,
  cash_to_mcap NUMERIC,
  value_score NUMERIC NOT NULL DEFAULT 0,
  momentum_score NUMERIC NOT NULL DEFAULT 0,
  total_score NUMERIC NOT NULL DEFAULT 0,
  classification TEXT,
  confidence TEXT,
  details JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.avs_results TO anon;
GRANT SELECT ON public.avs_results TO authenticated;
GRANT ALL ON public.avs_results TO service_role;

ALTER TABLE public.avs_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read AVS results" ON public.avs_results FOR SELECT USING (true);
CREATE POLICY "Service role manages AVS results" ON public.avs_results FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_avs_total_score ON public.avs_results (total_score DESC);