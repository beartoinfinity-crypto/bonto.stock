CREATE TABLE IF NOT EXISTS public.social_sentiment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  action text NOT NULL DEFAULT 'HOLD',
  sentiment text NOT NULL,
  confirmation text NOT NULL,
  confidence numeric NOT NULL,
  themes jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'ai',
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_sentiment_cache_symbol_action_unique UNIQUE (symbol, action)
);

CREATE INDEX IF NOT EXISTS idx_social_sentiment_cache_symbol
  ON public.social_sentiment_cache (symbol);

CREATE INDEX IF NOT EXISTS idx_social_sentiment_cache_computed_at
  ON public.social_sentiment_cache (computed_at DESC);

ALTER TABLE public.social_sentiment_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_sentiment_cache_public_read"
  ON public.social_sentiment_cache;
CREATE POLICY "social_sentiment_cache_public_read"
  ON public.social_sentiment_cache
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "social_sentiment_cache_service_insert"
  ON public.social_sentiment_cache;
CREATE POLICY "social_sentiment_cache_service_insert"
  ON public.social_sentiment_cache
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "social_sentiment_cache_service_update"
  ON public.social_sentiment_cache;
CREATE POLICY "social_sentiment_cache_service_update"
  ON public.social_sentiment_cache
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);