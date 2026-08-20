
CREATE TABLE IF NOT EXISTS public.politician_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  politician text NOT NULL,
  transaction_date date NOT NULL,
  filing_date date,
  transaction_type text NOT NULL,
  amount_from numeric,
  amount_to numeric,
  asset_name text,
  owner_type text,
  position_held text,
  source text NOT NULL DEFAULT 'finnhub',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, politician, transaction_date, transaction_type, amount_from, amount_to)
);

CREATE INDEX IF NOT EXISTS politician_trades_transaction_date_idx
  ON public.politician_trades (transaction_date DESC);
CREATE INDEX IF NOT EXISTS politician_trades_filing_date_idx
  ON public.politician_trades (filing_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS politician_trades_symbol_idx
  ON public.politician_trades (symbol);
CREATE INDEX IF NOT EXISTS politician_trades_politician_idx
  ON public.politician_trades (politician);

ALTER TABLE public.politician_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Politician trades are publicly readable"
  ON public.politician_trades FOR SELECT
  TO public USING (true);

CREATE POLICY "Service role can insert politician trades"
  ON public.politician_trades FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update politician trades"
  ON public.politician_trades FOR UPDATE
  TO service_role USING (true) WITH CHECK (true);
