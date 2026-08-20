
-- Fix stock_price_history: restrict INSERT/UPDATE to service_role only
DROP POLICY "Service role can insert stock prices" ON public.stock_price_history;
DROP POLICY "Service role can update stock prices" ON public.stock_price_history;

CREATE POLICY "Service role can insert stock prices"
  ON public.stock_price_history FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update stock prices"
  ON public.stock_price_history FOR UPDATE
  TO service_role
  USING (true);

-- Fix screener_results: restrict INSERT/UPDATE to service_role only
DROP POLICY "Service role can insert screener results" ON public.screener_results;
DROP POLICY "Service role can update screener results" ON public.screener_results;

CREATE POLICY "Service role can insert screener results"
  ON public.screener_results FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update screener results"
  ON public.screener_results FOR UPDATE
  TO service_role
  USING (true);
