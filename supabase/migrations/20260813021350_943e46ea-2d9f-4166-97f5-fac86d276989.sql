CREATE TABLE public.tactical_action_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  lookback integer NOT NULL,
  last_bar_date date,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (symbol, lookback)
);

CREATE INDEX tactical_action_history_symbol_idx ON public.tactical_action_history (symbol, lookback);

GRANT SELECT ON public.tactical_action_history TO anon;
GRANT SELECT ON public.tactical_action_history TO authenticated;
GRANT ALL ON public.tactical_action_history TO service_role;

ALTER TABLE public.tactical_action_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tactical action history is publicly readable"
  ON public.tactical_action_history FOR SELECT USING (true);

CREATE POLICY "Service role can insert tactical action history"
  ON public.tactical_action_history FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update tactical action history"
  ON public.tactical_action_history FOR UPDATE TO service_role USING (true) WITH CHECK (true);