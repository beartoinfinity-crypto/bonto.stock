-- Kadoa full-history support on public.politician_trades
-- Idempotent: creates the table if the prior migration never ran, then adds
-- Kadoa columns, indexes, RLS, and clears orphaned legacy rows.

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
  external_id text,
  metadata jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT politician_trades_source_external_id_key UNIQUE (source, external_id)
);

-- Natural key can collide across sources/filings; (source, external_id) is
-- the real upsert target. Drop the legacy constraint if present.
ALTER TABLE public.politician_trades DROP CONSTRAINT IF EXISTS politician_trades_natural_key;
ALTER TABLE public.politician_trades DROP CONSTRAINT IF EXISTS politician_trades_symbol_politician_transaction_date_transaction_type_amount_from_amount_to_key;

-- Upgrade path if an older table without the Kadoa columns exists.
ALTER TABLE public.politician_trades
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.politician_trades
  ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.politician_trades
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.politician_trades
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.politician_trades
  ADD COLUMN IF NOT EXISTS owner_type text;

DO $$ BEGIN
  ALTER TABLE public.politician_trades
    ADD CONSTRAINT politician_trades_source_external_id_key UNIQUE (source, external_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS politician_trades_transaction_date_idx
  ON public.politician_trades (transaction_date DESC);
CREATE INDEX IF NOT EXISTS politician_trades_filing_date_idx
  ON public.politician_trades (filing_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS politician_trades_symbol_idx
  ON public.politician_trades (symbol);
CREATE INDEX IF NOT EXISTS politician_trades_politician_idx
  ON public.politician_trades (politician);
CREATE INDEX IF NOT EXISTS politician_trades_source_idx
  ON public.politician_trades (source);
CREATE INDEX IF NOT EXISTS politician_trades_source_filing_idx
  ON public.politician_trades (source, filing_date DESC NULLS LAST, transaction_date DESC);

ALTER TABLE public.politician_trades ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Politician trades are publicly readable"
    ON public.politician_trades FOR SELECT
    TO public USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert politician trades"
    ON public.politician_trades FOR INSERT
    TO service_role WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can update politician trades"
    ON public.politician_trades FOR UPDATE
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can delete politician trades"
    ON public.politician_trades FOR DELETE
    TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clean slate: drop orphaned pre-Kadoa (default source 'finnhub') rows.
DELETE FROM public.politician_trades WHERE source = 'finnhub' OR source IS NULL;

CREATE OR REPLACE FUNCTION public.politician_trades_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS politician_trades_touch_updated_at ON public.politician_trades;
CREATE TRIGGER politician_trades_touch_updated_at
  BEFORE UPDATE ON public.politician_trades
  FOR EACH ROW EXECUTE FUNCTION public.politician_trades_touch_updated_at();
