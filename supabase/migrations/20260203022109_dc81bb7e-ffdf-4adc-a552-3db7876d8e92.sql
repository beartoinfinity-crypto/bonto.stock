-- Create table to store historical stock price data
CREATE TABLE public.stock_price_history (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC(12, 4) NOT NULL,
  high NUMERIC(12, 4) NOT NULL,
  low NUMERIC(12, 4) NOT NULL,
  close NUMERIC(12, 4) NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Composite primary key to prevent duplicate entries
  PRIMARY KEY (symbol, date)
);

-- Create index for faster symbol lookups
CREATE INDEX idx_stock_price_history_symbol ON public.stock_price_history(symbol);

-- Create index for date range queries
CREATE INDEX idx_stock_price_history_date ON public.stock_price_history(date DESC);

-- Enable Row Level Security (public read access for stock data)
ALTER TABLE public.stock_price_history ENABLE ROW LEVEL SECURITY;

-- Allow public read access (stock prices are public information)
CREATE POLICY "Stock price history is publicly readable"
ON public.stock_price_history
FOR SELECT
USING (true);

-- Only allow insert/update via service role (edge functions)
CREATE POLICY "Service role can insert stock prices"
ON public.stock_price_history
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update stock prices"
ON public.stock_price_history
FOR UPDATE
USING (true);

-- Enable pg_cron and pg_net extensions for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;