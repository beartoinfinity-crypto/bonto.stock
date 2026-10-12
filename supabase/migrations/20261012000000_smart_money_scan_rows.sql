-- ============================================================================
-- smart_money_scan_rows — daily background Smart Money scan (edge fn)
--
-- Needed by: smart-money-scan (upserts; anon SELECT for the /smart-money page)
--
-- One row per (universe, symbol). The page reads the freshest row per symbol
-- so it opens instantly with zero browser API traffic; while the legs are
-- still filling in (first ~6 days after deploy) it falls back to its own
-- interactive scan for symbols the fn hasn't reached yet.
--
-- Run once in Dashboard -> SQL Editor (or `supabase db push`).
-- ============================================================================

create table if not exists smart_money_scan_rows (
  universe text not null default 'index',
  symbol text not null,
  name text,
  sector text,
  cap_tier text,
  price double precision,
  change_percent double precision,
  market_cap double precision,
  insider jsonb,          -- { score, buys, totalValue, distinctBuyers }
  institutional jsonb,    -- { score, holdings }
  congress jsonb,         -- { score, buys, sells, latestDate }
  squeeze jsonb,          -- { score, shortPercentOfFloat, shortRatio }
  score integer,
  classification text,
  insider_pending boolean not null default true,
  squeeze_loaded boolean not null default false,
  leg text,               -- last leg that touched this row: quotes|insider|weekly
  scanned_at timestamptz not null default now(),
  primary key (universe, symbol)
);

alter table smart_money_scan_rows enable row level security;

-- Page reads with the anon key; only the edge fn (service role) writes.
create policy "Allow select for anon" on smart_money_scan_rows
  for select using (true);

create index if not exists smart_money_scan_rows_universe_score_idx
  on smart_money_scan_rows (universe, score desc);

create index if not exists smart_money_scan_rows_scanned_at_idx
  on smart_money_scan_rows (scanned_at desc);
