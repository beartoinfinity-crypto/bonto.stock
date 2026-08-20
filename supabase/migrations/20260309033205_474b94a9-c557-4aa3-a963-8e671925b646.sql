
-- Table to store pre-computed screener results (updated daily after market close)
CREATE TABLE public.screener_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  signal_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(symbol)
);

-- Enable RLS
ALTER TABLE public.screener_results ENABLE ROW LEVEL SECURITY;

-- Anyone can read screener results
CREATE POLICY "Screener results are publicly readable"
  ON public.screener_results FOR SELECT
  USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can insert screener results"
  ON public.screener_results FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update screener results"
  ON public.screener_results FOR UPDATE
  USING (true);

-- Index for fast lookup
CREATE INDEX idx_screener_results_symbol ON public.screener_results(symbol);
CREATE INDEX idx_screener_results_computed_at ON public.screener_results(computed_at);
