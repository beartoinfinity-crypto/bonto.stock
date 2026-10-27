# StockPulse — Codebase Reference

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                    │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │useStockData│ │Politician │  │SocialSentimentCheck│    │
│  │  (hook)   │  │Trades.tsx │  │    (.tsx)          │    │
│  └─────┬─────┘  └────┬─────┘  └────────┬───────────┘    │
│        │              │                 │                │
│  ┌─────┴─────┐  ┌─────┴──────┐  ┌──────┴──────────┐    │
│  │ stockApi  │  │ localCron  │  │sentimentAnalysis │    │
│  └─────┬─────┘  └─────┬──────┘  └──────┬──────────┘    │
│        │              │                 │                │
│  ┌─────┴──────────────┴─────────────────┴───────────┐   │
│  │              storage.ts (Unified Write Layer)      │   │
│  │    → localStorage (instant)                        │   │
│  │    → SQLite via localDb.ts (backup)                │   │
│  │    → Supabase via supabaseDb.ts (cloud primary)    │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────┘
                           │ fetch() to /api/*
┌──────────────────────────┴──────────────────────────────┐
│  Express Server (index.js)                              │
│  /api/proxy          → CORS proxy with SSRF protection  │
│  /api/yahoo/crumb    → Yahoo Finance crumb (cached 30m) │
│  /api/finnhub/*      → Finnhub social sentiment         │
│  /api/google-trends  → Google Trends scraping           │
│  /api/politician-trades/unusualwhales  → UW page scrape │
│  /api/politician-trades/stockspill     → StockSpill DB  │
│  /api/politician-trades/opencabinet    → CSV parsing    │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

```
User selects stock
  → useStockData.fetchStockQuote()
    → stockApi.quoteFromYahoo()
      → /api/yahoo/crumb (server-side, cached)
      → Yahoo v8 chart API (direct or via /api/proxy)
      → Yahoo v10 quoteSummary (P/E, market cap, sector)
    → SQLite cache (localDb)
    → storage.setItem() → localStorage + Supabase (debounced)
  → useStockData.fetchHistoricalData()
    → fresh SQLite cache (bar-currency gate: newest bar ≤ 4 days old)
    → live: Yahoo v8 chart (10y) or Stooq CSV
    → Supabase cloud bars (stock_historical; primes the cache)
    → stale SQLite cache (last resort before synthetic)
  → stockData.generateSignals()
    → 8 strategy analysis → Signal[] returned to UI

Server cron job runs (Supabase Edge Functions, 24/7)
  → sync-stock-data (3 batched jobs, post-close) fills stock_quotes + stock_historical
  → sync-featured-trades / sync-politician-trades fill featured/congressional trade rows
  → simulate-ledger runs the simulated-traders day once per date
  → browser boot hydration (pullAll) + stockpulse-sync event update React Query caches → UI refreshes
```

## Core Modules

### `index.js` — Express Server (1227 lines)

Serves `dist/` SPA and provides server-side API endpoints.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/proxy?url=<encoded>` | CORS proxy. SSRF protection, 15s timeout. **Primary fetch path.** |
| `GET /api/yahoo/crumb` | Two-step Yahoo crumb (cookie + crumb). Cached 30 min. |
| `GET /api/yahoo/quote-summary?symbol=X&modules=A,B` | Yahoo v10 quoteSummary (crumb'd server-side). Used for per-symbol short-interest stats. |
| `GET /api/yahoo/batch-quote?symbols=A,B,C&fields=price,change,marketCap,name` | Batch quotes via Yahoo v7/finance/quote (max 50 symbols/call) — lets the Smart Money index universe (~500 symbols) fetch price/change/marketCap in ~10 requests instead of ~500. 10-min cache. |
| `GET /api/finnhub/sentiment?symbol=X` | Finnhub social sentiment. Requires `FINNHUB_API_KEY`. |
| `GET /api/google-trends?keyword=X` | Google Trends scraping. |
| `GET /api/politician-trades/unusualwhales?politician=X` | UW profile scrape, `__NEXT_DATA__` JSON parse. |
| `GET /api/politician-trades/stockspill?member_name=X` | StockSpill Supabase `congress_trades` (read-only). |
| `GET /api/politician-trades/opencabinet?politician=X` | OpenCabinet CSV parse (PapaParse), name + ticker filter. |
| `GET /api/politician-trades/kadoa?politician=X&limit=N` | Kadoa Congress Trading Monitor — **Supabase `politician_trades` first** (full backfilled history, `source='kadoa'`), GitHub static JSON fallback (`filers.json` → `filer/<id>.json` envelope `{filer,trades}`, or recent `trades.json` feed). 6h GitHub cache. |
| `GET /api/diag/opencabinet` | Diagnostic: Trump trade counts. |
| `GET /api/cboe/options?symbol=X` | CBOE delayed option-chain tape for `/flow` — normalized server-side (OCC symbol parse, dead rows dropped) from the >1.5 MB raw file. 10-min in-memory cache. |
| `GET /api/fred/observations?series=A,B&start=YYYY-MM-DD` | FRED macro series for `/macro` (up to 20 ids, server-held `FRED_API_KEY`, 15-min cache). 501 + setup hint when the key is unset. |
| `GET /api/edgar?url=<sec.gov URL>` | SEC EDGAR proxy for `/funds` — declared `User-Agent` (www.sec.gov 403s browser-spoofed UAs from cloud IPs), `sec.gov`-only host allowlist, 1h cache of immutable Archive files. |

### Cron architecture — server-side (primary) + browser (local only)

**Server-side (Supabase Edge Functions + pg_cron)** — data-production jobs run 24/7 in the cloud, no browser needed. Definitions in `supabase/functions/`, schedules in `supabase/schedules.sql` (pg_cron + pg_net):

| Function | Schedule | Action |
|----------|----------|--------|
| `sync-stock-data?batch=1` | Weekdays 22:00 UTC (6 AM HKT) | Yahoo quotes + 10y bars, index-universe batch 1/3 (~27 symbols) → `stock_quotes` / `stock_historical` |
| `sync-stock-data?batch=2` | Weekdays 23:00 UTC (7 AM HKT) | Batch 2/3 (~27 symbols) |
| `sync-stock-data?batch=3` | Tue–Sat 00:00 UTC (8 AM HKT) | Batch 3/3 (~26 symbols) |
| `sync-politician-trades` | Daily 07:00 UTC | Kadoa incremental → `politician_trades` (source=`kadoa`, meta-diff `stockpulse_kadoa_meta`) + CapitolExposed + CongressInvests → `stockpulse_kv` |
| `sync-featured-trades` | Daily 07:30 UTC | Trump (OpenCabinet + UW + Kadoa) + Pelosi (StockSpill + UW + Kadoa) → `politician_featured_trades` |
| `upsert-kadoa-trades` | Manual / local `scripts/backfill-kadoa.cjs` | One-time full Kadoa history backfill sink → `politician_trades` |
| `run-sql` | Manual / local `scripts/run-sql.cjs` | SQL runner while `supabase db push` is blocked by the CLI login-role bug |
| `simulate-ledger` | Weekdays 12:00 UTC | Simulated-traders day ONCE from cloud data (master matrix snapshot + cloud quotes) → `stockpulse_kv` ledger row. Write-protected per day; heals legacy conflicts. |
| `smart-money-scan?leg=quotes` | Daily 01:30 UTC | Batch quotes (500 symbols) + top-125 short interest + congress bulk → `smart_money_scan_rows` (index universe) |
| `smart-money-scan?leg=insider` | Daily 02:30 UTC | SEC Form 4 bucket of 85 stale/un-scanned symbols → full 500 coverage over ~6 runs, then self-maintains past the 30d TTL |
| `smart-money-scan?leg=weekly` | Mon 03:30 UTC | 13F (10 fast managers) → same table (quarterly filings, weekly refresh) |

The `smart-money-scan` legs write one row per (universe, symbol) in `public.smart_money_scan_rows` (migration `20261012000000`, RLS anon-SELECT, service-role upsert). `/smart-money` reads that table on mode switch (`edgeRest` in `SmartMoneyScreener`) so index modes open instantly with zero browser API traffic; the interactive **Run screen** button is unchanged for the curated 41 and manual re-runs. The Deno fn duplicates the pure scoring from `src/lib/smartMoney.ts` (Deno can't import browser TS) — thresholds must be changed in **both** files; membership (`universe.ts`) is generated by `node scripts/gen-deno-universe.cjs` after any `src/lib/indexMembers.ts` edit.

Stock sync covers the full 80-symbol index universe (S&P 500 ∪ NASDAQ-100, mirroring `masterAnalysis.ts` `INDEX_UNIVERSE_TICKERS`) split into 3 batches staggered across the 3 post-close hours to stay under Yahoo rate limits; batches pace fetches ~1.2s apart and finish by ~8:02 AM HKT. `simulate-ledger` mirrors the browser's `tradeSimulator` semantics (persona thresholds, 10% equity buys, -8%/+30% stops) with a Deno port of the tactical engine (`simulate-ledger/engine.ts`); the agent persona uses the bounded matrix-rating path (the browser's non-holding path). Universe input is the cloud `stockpulse_master_matrix` snapshot — which browser sessions still produce and push; if a browser hasn't pushed a fresh matrix, the sim uses the latest snapshot present.

**Browser cron (`src/lib/localCron.ts`)** — local-machine maintenance only:

| Job | Schedule | Action |
|-----|----------|--------|
| `archive-sqlite` | Daily 8:30 AM UTC | Flush pending SQLite writes |
| `pull-stock-data` | Weekdays 9 AM UTC | Supabase → local SQLite mirror |

Browsers read server-written rows via the existing boot hydration (`pullAll`) and sync events; no page reads changed.

Key: `proxyFetch()` chains server proxy → direct → CORS proxies (legacy).

### `src/lib/stockApi.ts` — Yahoo Finance (810 lines)

Fetch chain: `proxyFetch()` → server proxy first → direct → CORS proxies.

| Function | Purpose |
|----------|---------|
| `fetchStockQuote(symbol)` | cache → Finnhub quote → Yahoo v8 chart → Stooq CSV → mock |
| `fetchHistoricalData(symbol)` | 10y daily OHLCV. Fresh SQLite cache → Yahoo v8 → Stooq → **Supabase cloud bars** (`stock_historical`, primes the cache) → stale SQLite cache (better than synthetic) → synthetic |
| `getYahooCrumb()` | `/api/yahoo/crumb`, cached 30 min |
| `fetchQuoteSummary(symbol)` | Yahoo v10: P/E, market cap, sector |
| `localFundamentals(symbol)` | Curated fallback (name, sector, marketCap, pe) from `popularStocks`. Used when live `quoteSummary` returns null. |

**Fundamentals fallback chain:** `quoteFromYahoo`/`quoteFromStooq` try live `fetchQuoteSummary`, then fall back to `localFundamentals()`. The cached-quote return path in `fetchStockQuote` also self-heals stale/blank fundamentals by merging curated values. Custom symbols not in `popularStocks` will still show `Unknown/N/A/0` when the live endpoint is unreachable.

**Historical-bar cache freshness (bar-currency gate):** the SQLite historical cache (`localDb.getHistorical`) is a hit only if its newest bar is ≤4 calendar days old (`isDailyBarSeriesFresh`) — a 90-day-old *write* is worthless when the *data* ends weeks back. A stale series is a miss, so callers refetch (live → cloud). The stale series is still served as a last resort before synthetic bars (`getHistoricalDump`), labeled `error: "Cached bars end <date>"`.

**Fresh-quote speed (Master Matrix):** `fetchStockQuote` reads the local cache first, then (for uncached symbols) tries `quoteFromFinnhub` via the `/api/finnhub/quote` proxy — which rotates over the server `FINNHUB_API_KEY`/`FINNHUB_API_KEY_2` env keys plus any browser-saved `api_key`/`api_key_2` tokens — before falling back to Yahoo/Stooq. This makes fresh quote retrieval on the Master Matrix page much faster than Yahoo's slow/blocked endpoints. `useMasterMatrix.runAnalysis` also fetches in larger batches (6) with a shorter 120 ms delay between them.

### `src/lib/masterAnalysis.ts` — 12 Trading Masters (663 lines)

Rule-based engine (no AI/ML) implementing 12 investor strategies. Each master returns a verdict over a stock's historical bars.

| Export | Purpose |
|--------|---------|
| `analyzeStock(rows, symbol, options)` | Runs all 12 masters over daily OHLCV rows → `MasterResult[]` |
| `summarizeMasterResult(results)` | Aggregates verdicts → BUY/HOLD/WATCH/SELL+AVOID counts, score, action |
| `MasterId` / `MASTERS` | 12 named strategies (Buffett, Munger, Fisher, etc.) |
| `UniverseId` / `UNIVERSES` | `'sp500'` `'nasdaq100'` `'all'` plus `filterStocksByUniverse()` |
| `SP500_TICKERS` / `filterToSP500` | ~500 constituents |
| `NASDAQ100_TICKERS` / `filterToNASDAQ100` | ~100 constituents |
| `Verdict` | `BUY` / `HOLD` / `WATCH` / `SELL` / `AVOID` |

### `src/lib/tradingAgents.ts` — Trading Agents Engine (687 lines)

Rule-based reimplementation of the TradingAgents multi-agent workflow — **no AI/ML/LLM**. It runs a staged pipeline over a stock's quote + historical bars, reusing the existing analyzers (`generateSignals`, `analyzeStock`, `analyzeMarketConditions`, `calculateLiquidityConditions`, `fetchSentiment`), and returns a 5-tier final decision.

| Export | Purpose |
|--------|---------|
| `runTradingAgents(symbol, deps, stock)` → `TradingAgentsResult` | Async entry point; runs the whole pipeline |
| `TradingAgentsResult` | `analysts[]`, `researchPreview`, `debate[]`, `traderPlan`, `riskDebate[]`, `portfolio`, `final`, plus `marketCondition`/`liquidity`/`sentiment`/`forecast` |
| `AnalystReport` | Per-worker output: `bias`, `confidence`, `score` (-100..+100), `summary`, `evidence[]`, `keyMetric` |

Pipeline stages (mirror the Python framework): **1. Analyst Team** (technical, fundamentals, sentiment, market) → **2. Research Manager** (consensus synthesis) → **3. Researcher Debate** (bull vs bear researchers + a judge) → **4. Trader Agent** (action/entry/stop/target + confidence) → **5. Risk Management** (aggressive/conservative/neutral debaters) → **6. Portfolio Manager** (approve/reject + position weight) → **7. Final Decision** (Buy / Overweight / Hold / Underweight / Sell).

Key behavioral details of recent fixes (all rule-based):

- **Research Manager consensus** (`researchManager`): the `weighted` tilt is the **per-analyst confidence-weighted average** of each report's `score`, divided by the analyst count — so it sits truthfully on the −100..+100 scale and never overstates a tilt. `overallBias` uses `> 25 / < −25` thresholds on that average. The `spreadNotes` split line reports **all** analysts (`X bullish vs Y bearish, N neutral (of 4)`), so bullish+bearish+neutral always totals the analyst count.
- **Researcher Debate points** (`researcherDebate`): bull/bear researcher points are **relative share** (`bullStrength/(bullStrength+bearStrength)×100`, likewise bear), so bull+bear ≈ 100 rather than saturating at an arbitrary ×3 cap. The judge's points are `clamp(|net|, 0, 100)`. The Trader agent's `bullPts/bearPts > 45` guard is now a majority-share gate, while the judge still needs absolute `|net| > 20` to set direction.
- **Fundamentals analyst** (`fundamentalsAnalyst`): the headline reads `${bullCount}/${total} bulls vs ${bearCount} bears` and the summary is driven by the raw master **vote split** (`margin ≥ 2` bullish, `≤ −2` bearish, else lean/evenly-split), not solely by weighted bias. Masters run through the shared `masterAnalysis.ts` engine with `FUNDAMENTAL_MASTER_IDS` = `['buffett-graham','greenblatt','peter-lynch','munger','marks','templeton']`.
- **Portfolio Manager** (`portfolioManager`): exposes `sizingPersona` (a `PERSONA_CAP` map) and the decision panel shows `{persona} cap {base}% · position {n}%`; liquidity evidence uses `toFixed(2)`.

### `src/lib/peadAnalysis.ts` — PEAD Alpha Model (178 lines)

Rule-based TypeScript port of the ai-hedge-fund `pead.py` **Post-Earnings Announcement Drift** quant alpha model — **no AI/ML/LLM**. It scores a stock's drift signal from quarterly earnings surprises (BEAT / MISS).

| Export | Purpose |
|--------|---------|
| `computePEAD(symbol, quarterly, asOf, opts)` → `PEADResult` | Core view: picks the most recent non-INLINE surprise (point-in-time ≤ asOf), checks the drift window, returns a `signal` in [-1, +1] with `reasoning` and a chronological `history[]` |
| `classifySurprise(pct)` | ±N% band → `BEAT` / `MISS` / `INLINE` (default ±1%) |
| `surpriseToConviction(pct)` | Maps surprise magnitude to [-1, +1], saturating at ±25% |
| `parseQuarterEnd(period)` | "1Q2024" → `2024-03-31` (approximate filing point for the window check) |

Quarterly actuals/estimates come via `getEarningsSurprises` (in `stockApi.ts`), which hits the cached local sql.js metadata store first (24h TTL), then Yahoo quoteSummary `earnings` module (surprise % derived from actual−estimate), then **falls back to the Finnhub `/stock/earnings-surprises` endpoint** via the `/api/finnhub/earnings-surprises` server proxy (requires `FINNHUB_API_KEY`, same as the sentiment proxy). A fresh surprise (within the 45-day drift window) carries full conviction; a stale one still reports a residual lean; no surprise → abstain (0). **Currently unused:** the `/hedge-fund` page and its `hedge_fund/` port were removed in `25d418e`; the model and its fetch chain remain in the tree (unit-tested in `peadAnalysis.test.ts` / `stockApi.test.ts`) but no page imports them.

### `src/lib/supabaseHistory.ts` — Stored OHLCV (241 lines)

Pulls real daily bars from the **`stock_historical`** Supabase table (the 80-symbol index universe + legacy extras, 10y depth, refreshed nightly by the batched `sync-stock-data` edge functions) — the data source for Master Matrix snapshots and per-stock history backfill.

| Function | Purpose |
|----------|---------|
| `fetchStoredHistory()` | All symbols with bars (min-bar filtered), paginated `order=date.asc` |
| `fetchStoredHistoryForSymbol(symbol)` | Bars for one symbol, case-insensitive `symbol=eq.`. Also the cloud fallback in `fetchHistoricalData` when live providers fail. |

### Supabase config resolution (runtime, secret-free)

No Supabase credentials live in source. Browsers resolve them at runtime:
- Cloud Sync + stored history — `GET /api/sync-config` (Vercel env `SUPABASE_URL` / `SUPABASE_ANON_KEY`)
- Edge functions (stock-data news, analyze-news-sentiment, social-sentiment, asymmetric-value-screener) — `GET /api/edge-config` (Vercel env `EDGE_FN_URL` / `EDGE_FN_KEY` — public anon key of the current project `aqyaarnpmvvdzasjefje`)
- Local dev fallback: `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in the gitignored `.env`

### `src/hooks/useMasterMatrix.ts` — Master Matrix Hook (563 lines)

Central state for the Master Matrix and history pages.

| Concern | Detail |
|---------|--------|
| Universe | `universeId`/`setUniverseId` (`'sp500'`/`'nasdaq100'`/`'all'`); feeds `filterStocksByUniverse()` |
| Custom symbols | `customSymbols` persisted at `stockpulse_master_matrix_custom`; `addCustomSymbol`/`removeCustomSymbol` via `isValidSymbol` regex `/^[A-Za-z][A-Za-z0-9.\-]{0,5}$/`; synthetic `makeCustomStock()` |
| Matrix rows | `MatrixStockRow` incl. `sellCount` (SELL+AVOID count) |
| Snapshots | `DailySnapshot` incl. `source: 'live' \| 'supabase'`; accumulated per stock |
| History storage | localStorage key `stockpulse_master_matrix` (single source of truth for past snapshots) |
| Backfill | `loadMatrix` exported; standalone `backfillStockHistory(symbol, maxDays=365)` computes per-day analyses from stored bars and merges snapshots (replaces that date range, keeps others). Hook's `backfillHistory` is a thin wrapper |

### `src/hooks/useTradeLedger.ts` + `src/lib/tradeSimulator.ts` — Simulated Traders Ledger

New `/ledger` page ("Simulated Traders"). A cast of seven named personas, each bound to a distinct engine, buy/sell across a shared universe daily and record every transaction in a persisted ledger.

| Persona | Engine | Rule |
|---------|--------|------|
| Warren (value) | 12 Masters | BUY on strong consensus (≥4 buy votes & high strength), SELL on flip |
| Eleanor (wealth) | 12 Masters | Stricter — needs ~60% buy vote |
| Temple (contrarian) | 12 Masters (inverted) | Buys hated names (high SELL/AVOID), sells on recovery |
| Rosalind (inverted Eleanor) | 12 Masters (inverted) | Trades opposite Eleanor: sells when her wealth screen fades (SELL on `buyCount/12 ≥ 0.35`), buys when she would sit out (`sellCount ≥ 5`), no stop-loss |
| Nancy (momentum) | Matrix rank | Buys strong score + price above 20-SMA, sells when it falls below |
| Jerry (tactical) | `runEngine` | BUY on `entrySignal`, honors engine stops/targets + position size |
| Ada (agent) | `runTradingAgents` | BUY on Buy/Overweight + conviction |

- **Money model**: long-only, real-calendar, $100k cash each; 10% of equity per buy; fill at the **session's official close** (see pricing below); -8% stop / +30% target; no fees/margin.
- **Session-date semantics**: a day run simulates the **last completed session** — the newest synced `stock_historical` bar — and every fill carries that session's date with its **official close price**. By construction each fill lands inside that session's [low, high] range; holiday bars are re-dated to the prior session, and symbols with no fresh market data are untradeable (zero-price gate, persona holds). This replaces the old "run today at the day's quote" model where pre-open prints outside the day's range.
- **Pricing preference inside the sim**: session official close → fresh cloud quote board (`pullFreshCloudPrices`, 4-day staleness gate) → last Master-Matrix snapshot. Fresh market data always wins over the (possibly stale) matrix snapshot.
- **Signal sourcing**: the shared universe is restricted to the two tracked index universes — **S&P 500 ∪ NASDAQ-100** (`INDEX_UNIVERSE_TICKERS` / `isIndexTrackedSymbol()` in `masterAnalysis.ts`; a symbol that's in both, e.g. AAPL, counts once). Both universe sources are constrained to it: the Master Matrix's persisted top-50 cache (`stockpulse_masters_top50`, cached rows outside the indices are dropped) and the on-the-fly fallback that computes rows from `popularStocks` (which drops off-index names TSM, SOFI, SQ, HOOD, COKE) when the Matrix page was never visited. Tactical and Agent run their heavier engines on a bounded subset (`HEAVY_TOPN = 8` + current holdings) to keep each day cheap. Thresholds are tuned so each persona fires on a normal day (e.g. Value buys with N BUY votes, Momentum on Matrix score ≥5 + price above 20-SMA, Contrarian on the hated names).
- **History / price chain**: per-symbol history asks the live API first, then falls back to stored Supabase bars (`fetchStoredHistoryForSymbol` from `stock_historical`, the same RLS-public source the Master Matrix uses; the 80-symbol index universe has bars), then synthetic `generateHistoricalData` (which produces no tactical entry signals). So with the network down the ledger still trades off real stored bars.
- **Persistence**: `stockpulse_trade_ledger` (a `DOCUMENT_KEY`; NOT in the browser sync keys — the server is the only writer), shape `LedgerStore { accounts, trades, decisions, lastRunDate, prices }`.
- **Server-authoritative**: `simulate-ledger` (Supabase edge fn, pg_cron `0 12 * * 1-5` UTC) is the **only writer** of the ledger row. Browsers never push or merge the ledger (`ledgerMerge` union logic was removed); they **pull the cloud copy verbatim** (`pullLedger` adopts it when local is missing/stale). The `/ledger` page is a cloud viewer: auto-pulls on mount, shows a run-status badge (green "session N: fills/no fills — caught up" vs amber "session not simulated yet"), and re-runs via the **Re-run session** button → `POST /api/ledger/rerun` → the fn clears the latest simulated session and re-simulates atomically (goal: no manual local run buttons; reset lives on the server). It also re-pulls on the `stockpulse-sync` event and on tab `focus`/`visibilitychange` (60s throttle), and the local mirror write is quota-safe — so a stale or oversized localStorage copy can't pin the page to an old session.
- **Zero-price gate (shouldSell)**: `shouldSell` returns `null` when `!(s.price > 0)` — prevents stop-loss/take-profit/signal-flip sells on unverifiable symbols. Applied to both `tradeSimulator.ts` and `simulate-ledger/index.ts`.
- **NaN/Infinity buy guard**: buy loop skips when `!(available > 0) || !(s.price > 0) || !Number.isFinite(qty)` — prevents `Math.floor(Infinity/0)` → `Infinity` → serialized as `null` in JSON. Applied to both files.
- **Same-day round-trip prevention**: `soldToday` set in `runDayForPerson` tracks symbols sold during current session; buy loop skips them. Applied to both files.
- **Account rebuild from trades**: `pullLedger` in `supabaseDb.ts` runs `replayAccounts(healSameDayConflicts(trades))` before returning — cloud's stale account snapshot (null cash, ghost positions) no longer poisons the leaderboard. Edge fn also rebuilds accounts from trades before sim (line ~554) and after re-run strip (line ~568).
- **Decision log**: every symbol each persona evaluates each day is persisted in `decisions` (a `DailyDecisionLog` per persona+date), including **HOLDs** — recording action, price, strength/confidence, buy/sell vote counts, stop/target and a human-readable reason. Logs accumulate across days (a re-run replaces the same persona+date's entry, keeping older days).
- **View layer** (`src/lib/ledgerView.ts`, pure + unit-tested): `flatDecisions`/`distinctDates`, `filterTrades`/`filterDecisions` (persona, action, symbol, date, free-text search) and `sortTrades`/`sortDecisions`. The page renders a **global Decisions panel** (accumulated signals incl. HOLDs) and an **All Transactions table** (accumulated fills), each with a filter bar, live summary stats (BUY/SELL/HOLD counts; buys/sells, notional, realized P/L), and pagination (100/page) — making any day/persona/symbol auditable as history grows.
- **Trigger**: the server's `simulate-ledger` fn runs on schedule (Mon–Fri 12:00 UTC) — **write-protected**, one simulation per session (`{"ok":true,"simulated":false,"reason":"already simulated <date>"}` on re-fire). The browser's `simulateDay` mirrors the same semantics for offline/local use only. A `GET /api/ledger/status` probe reports `{ latestSession, lastRunDate, caughtUp, latestSessionFillCount }` without side effects (the old status endpoint used to fire a run — deprecated).
- **Write-protection**: `simulateDay` returns the ledger unchanged if `date` is already `lastRunDate`, so re-running the same day with different (live) prices can never fork the record. Mark-to-market leaderboard uses the last simulated day's `prices` snapshot — a fill records `price = prices[symbol]` for that same run, so **a freshly opened position is marked exactly at its cost on the day it's bought (0% P/L)** and only shows variation on later runs as the snapshot moves away from the entry. (Not a bug — e.g. a Contrarian persona that just bought shows +0.00% while older holders show drift.)
- **Live re-marking (leaderboard/positions)**: on page load the browser fetches live quotes for every open-position symbol and re-marks equity/P-L at current prices — then **retries every 60 s and on tab refocus** (a one-shot failure no longer freezes positions at the last snapshot), merging the 4-day-fresh cloud quote board for symbols the live providers miss. Only real provider quotes count (`isRealData` gate — curated mock prices never re-mark); the last day's snapshot is the offline fallback. The settled record is unchanged — fills and history stay at their day's prices.
- **Daily performance history**: each simulated day appends one `ledger.history` entry (`LedgerHistoryEntry`: date + per-persona mark-to-market equity + the day's prices) via `appendHistory` (union by date — a re-run replaces that day). The page renders a **Performance History** table (per-persona daily equity + P/L) and each persona tab shows a daily P/L summary (total/best/worst day). The server-side `simulate-ledger` fn records the same entry.
- **Validation**: `scripts/validate-ledger.cjs` audits fills against cloud bars (every fill inside its session's high–low, exact official close, own-session bar exists, no duplicate ids, qty×price==value, snapshot completeness) — exit 1 + violation details on failure. Run after each simulated day: `node scripts/validate-ledger.cjs`.
- Pure account math (`runDayForPerson`) is unit-tested (`tradeSimulator.test.ts`); signal sourcing lives in the hook.

### `src/lib/stockData.ts` — Analytics Engine (917 lines)

**No AI/ML.** Rule-based signals, template narratives.

8 strategies in `generateSignals()`: MA Crossover, RSI Momentum, MACD Momentum, Bollinger Position, Volume, Candle Patterns, S/R Break, Multi-TF RSI — **at most one signal per strategy** (an `emitted` set with an `emit()` helper drops duplicate pushes). Each returns `Signal` with direction, strength, confidence (0-100), entry/stop/target.

Signal quality guards: SMA200 claims only when `sma200` exists (else trend text omits the 200-SMA clause); MACD thresholds are percentages of price (`histPct = histogram / price`) rather than absolute values; Multi-TF RSI reasons must agree with its direction (rising below 50 → early-recovery hold, falling above 50 → fading-vs-exhausted distinction); Bollinger emits a squeeze hold when bandwidth is narrowing with no breakout yet.

Additional technical indicators exported from `stockData.ts`:
- `calculateKDJ(rows, period, signalPeriod)` → `{ K[], D[], J[] }` — Stochastic Oscillator with K/D/J lines
- `calculateSMA(rows, period)` → `{ date, value }[]` — Simple Moving Average
- `calculateRSI(rows, period)` → `{ date, value }[]` — Relative Strength Index
- `calculateMACD(rows, fast, slow, signal)` → `{ date, macd, signal, histogram }[]` — MACD

Forecasting: `generateForecast()` (trend + confidence bands), `generateMonteCarloPaths()` (GBM simulation, p10-p90).

### `src/lib/supabaseDb.ts` — Supabase Cloud (620 lines)

Tables: `stockpulse_kv`, `stock_quotes`, `stock_historical` (real OHLCV bars, read via `supabaseHistory.ts`), `politician_featured_trades`, `politician_trades` (Kadoa full history, `source='kadoa'`), `avs_results`, `social_sentiment_cache`, `api_usage_log`.

Key: `maybeSyncToSupabase(key)` debounced 3s push. `pullAll()` paginated 500/page. `pushFeaturedTrades()` chunked 100/batch. `pullFreshCloudPrices()` fetches the current cloud quote board for live marks. Removed ledger paths (ledger is server-authoritative): no `overwriteLedger`, no merge; `pullLedger` adopts the cloud copy verbatim and rebuilds accounts from trades via `replayAccounts(healSameDayConflicts(trades))`. Local mirror writes go through `safeLocalSet`/`writeLocal` (returns `false` instead of throwing), so an oversized ledger hitting the localStorage quota no longer makes `pullLedger` return `null` and freeze the viewer on a stale mirror.

### `src/lib/storage.ts` — Unified Write Layer (77 lines)

**Single entry point for ALL writes.** `setItem()` → localStorage (sync) + Supabase (debounced 3s) + SQLite (fire-and-forget). The localStorage leg is best-effort: a `QuotaExceededError` is caught and logged (`[Storage] localStorage write failed (quota?)`) so a full origin never aborts the Supabase/SQLite path.

### `src/hooks/useStockData.ts` — Main Hook (133 lines)

Returns `{ selectedStock, historicalData, signals, isLoading, isRealData, setSelectedStock, refetch }`. TanStack React Query with 1-min stale (quotes), 5-min (historical). Listens for `stockpulse-sync` cron events.

### `src/lib/syncKeys.ts` — Synced Keys (41 lines)

`CONFIG_KEYS`: watchlist, users, auth, admin auth, API config, lang, recent stocks, `/risk` holdings + benchmark + window.
`DOCUMENT_KEYS`: screener results, AVS results, politician trades, featured trades, cron history, alerts, market snapshot, `/book` positions. **`stockpulse_trade_ledger` is intentionally absent** — the ledger is server-authoritative (the `simulate-ledger` edge fn is its only writer); browsers pull it verbatim and never push/merge it.

---

## Pages

| Route | Page | Key Hook/Component |
|-------|------|--------------------|
| `/` | Index — Dashboard (278 lines) | `useStockData`; includes KDJIndicator with SMA crossover signals. Small viewports (<768px) auto-redirect to `/m` via `siteMode.mobileRedirectTarget()` (opt-out remembered in `stockpulse_use_full_site`) |
| `/masters` | TradingMasters — 12-investor analyzer (305 lines) | `analyzeStock` + `summarizeMasterResult`; verdict summary boxes (BUY/HOLD/WATCH/SELL-AVOID), per-master cards |
| `/trading-agents` | TradingAgentsPage — multi-agent report (554 lines) | `runTradingAgents`; analyst team, bull/bear debate, trader plan, risk committee, portfolio decision, final 5-tier rating |
| `/masters-matrix` | MasterMatrix — Top-50 matrix (542 lines) | `useMasterMatrix`; universe/custom-stock picker, rank, rows link to history |
| `/masters-matrix/:symbol` | StockHistory — Per-stock history (288 lines) | `useMasterMatrix`; 12-master verdicts per day, stats, "Backfill past year" |
| `/ledger` | TradeLedger — Simulated traders (730 lines) | `useTradeLedger` + `tradeSimulator` + `ledgerView`; 7-persona leaderboard (cash/positions split), positions, per-person trades, global accumulated Decisions panel + All Transactions table with filter bar, stats, pagination, run-status badge; cloud viewer — auto-pulls the server-simulated ledger, Re-run session button |
| `/tactical` | Tactical — Trade planner (706 lines) | `useTacticalHistory`, `tacticalEngine`; bar-by-bar replay with a full metric suite (Sharpe, Sortino, Calmar, max drawdown + duration, CAGR, profit factor, expectancy) computed from real fills |
| `/m` + `/m/:symbol` | MobileStock — Mobile view (517 lines) | Hub = `StockSearch` + popular list; detail = sticky price summary with Live/Simulated badge, Recharts touch chart (`touch-pan-y`, drag-to-scrub syncs header price + haptic via `useHapticFeedback`), timeframe pills (`?tf=`, 1M…5Y/All daily bars), key stats, `StockNews`, fixed action bar. Sets the full-site opt-out flag when leaving for `/` |
| `/risk` | PortfolioRisk — Risk screen (475 lines) | `portfolioRisk` — beta/correlation/vol/drawdown, sector HHI, stress scenario, growth-of-100; holdings from watchlist or manual, SPY/QQQ/DIA/IWM benchmark |
| `/commodities` | Commodities — Futures board (298 lines) | `commodities` — 30 verified futures symbols in 6 groups (batched live quotes), click row for industry exposure map (helps/squeezes) |
| `/book` | DeskBook — Desk book (356 lines) | `deskBook` — hand-kept lots with weighted-average cost merge, mark-to-market, day change, weights; persisted via syncKeys (`stockpulse_book_positions`) |
| `/flow` | OptionsFlow — Options tape (530 lines) | `optionsFlow` + `/api/cboe/options` — real CBOE delayed tape: put/call ratios, OI walls chart, max pain, ATM-straddle expected move, unusual activity, chain table; plus the `OptionsWheel` strategy panel fed by `fetchHistoricalData` under its own `['options-flow-historical', symbol]` cache key |
| `/funds` | Funds — 13F portfolios (323 lines) | `funds13f` via `/api/proxy` → SEC EDGAR (submissions → info-table XML): top holdings, % of portfolio, qoq share deltas, new/exited counts; 16 curated managers + custom CIK |
| `/macro` | Macro — FRED board (275 lines) | `macro` + `/api/fred/observations` — 12 curated FRED series, latest + YoY, windowed sparklines, category filter; setup notice when `FRED_API_KEY` unset |
| `/smart-money` | SmartMoneyScreener — Composite screener (630 lines) | `smartMoney` + `indexMembers` — universes: curated 41, S&P 500, NASDAQ-100, or the ~501-symbol union (mode Select). Default sort is signal score ↓; Score/Insider $/13F/Congress/Short/Price/Δ% headers sort asc/desc; a context line (`Showing 1–25 of N · sorted by X ↓`) plus the clickable `Top score` card (`SYM · score/100`) makes the leader easy to find, and rank 1 gets a `TOP` badge when sorted by score. Server pre-scan loading shows a spinner line. Scored 0–100 from four live signals: Form 4 insider buys (`/api/edgar`, bucketed ~100/run on index modes), 13F holdings of 10 fast-scan managers (funds13f reuse), congress trades (bulk monthly windows via `politician_trades` REST), Yahoo short % of float (lazy top-100 + on row expand). Batch quotes via `/api/yahoo/batch-quote` (~10 calls for 500 symbols). Filters, expandable breakdown, 24h scan + 30d insider caches. On `index` mode, loads the daily `smart-money-scan` pre-scan from `smart_money_scan_rows` (`mapScanDbRow`) so the page opens instantly with zero API traffic |
| `/screener` | Screener — Batch screen (605 lines) | `useScreenerData` |
| `/settings` | Settings — Config (788 lines) | Auth, watchlist, Supabase, DB ops |
| `/admin` | Admin — Cron mgmt (276 lines) | `localCron` jobs, run history |
| `/api-settings` | ApiSettings — API keys (299 lines) | Provider configs |
| `*` | NotFound — 404 (25 lines) | — |

## Components

| Component | Lines | Purpose |
|-----------|-------|---------|
| `PoliticianTrades.tsx` | 970 | 6-source politician trades — **Kadoa first** (Supabase `politician_trades` full history), then CapitolExposed, CongressInvests. Featured: Trump + Pelosi. Supabase cache. |
| `SocialSentimentCheck.tsx` | 405 | 10-source sentiment (Google News, StockTwits, Yahoo, ApeWisdom, SocialTickers, Finnhub, Adanos, MarketWatch, CNBC, Google Trends). Evidence-first: crowd vs financial-news bars with divergence, attention trend, price context, and real linked quotes/headlines with relative timestamps and tone labels. Keyword scoring, no AI. |
| `AsymmetricValueScreener.tsx` | 359 | Risk/reward scoring. Inside Screener. |
| `SectorHeatmap.tsx` | 58 | TradingView Stock Heatmap widget (sector-grouped S&P 500 performance map); drop-in replacement for the now-blocked Finviz hotlink. Inside Screener. |
| `ChartAnalyst.tsx` | 547 | Pattern recognition: S/R, trendlines, candle patterns. Verdict hero (Bullish/Bearish/Neutral, "n of 8 indicators bullish", 0–100 technical score, 8-segment meter, confidence) over flagged-first rows with `WATCH` chips and 2-line reasons, three timeframe forecast cards, and a data-basis footnote (`{symbol} · based on N daily closes through {date}`). Coherent hero: outlook bias derives from the same weighted short/mid/long forecast points. |
| `AlertPanel.tsx` | 339 | Price alert manager. |
| `MultiTimeframeRSI.tsx` | 260 | RSI(7/14/21) confluence display. Verdict hero (Oversold/Overbought crossover reads) with an honest `n/3 timeframes in an extreme zone` line, per-timeframe stance cards, hedged wording (no "high-probability reversal" claims), a 6-month chart, and a disclosure footnote. Signal confluence is stated from the stance cards, never a fabricated percentage. |
| `KDJIndicator.tsx` | 449 | Stochastic (K/D/J) + SMA20/SMA50 trend. Verdict hero (Bullish/Bearish/Mixed/Neutral, 0–100 technical score, 8-segment meter) derived by scoring short-term KDJ momentum and medium-term SMA trend **separately** so a KDJ-vs-trend conflict shows as `Mixed` instead of one side swallowing the other. Flagged-first indicator rows with `WATCH` chips and 2-line reasons, K/D/J chart, Zone/Momentum/Trend readout, and a disclosure footnote. |
| `PutCallRatio.tsx` | 138 | Put/call ratio **estimate** (not real options flow) modelled from price action + volatility, labeled `(est.)` in the header and disclosure. Ratio bar, trend vs prior-period proxy, and an honest interpretation that says the lean reflects the price trend it's derived from. No fabricated put/call volumes or implied trader behavior. |
| `LiquidityMonitor.tsx` | 145 | Bid/ask depth via `deriveOrderBook()`. Verdict hero (Abundant/Normal/Tightening/Critical, "n of 4 flagged", 0–100 score, 4-segment meter) over flagged-first rows with `FLAG` chips, `line-clamp-2` reasons and a single footnote. FX row labels the yield spread (`¥145.7 · 3.2% spread`). Enumerated labels via `t()`; counts/legend stay English. |
| `StockSearch.tsx` | 245 | Autocomplete search, 300ms debounce. |
| `StockMetrics.tsx` | 90 | P/E, market cap, 52-week range, volume. Graham intrinsic values now labeled with their growth assumption (`Intrinsic (0% growth)` vs `Intrinsic (7.5% growth est.)`) via i18n keys, so the 8.5×/23.5× multipliers are not unexplained. |
| `SignalPanel.tsx` | 301 | Trading Signals card for the 8 strategies. Verdict hero from `net = (buy − sell) / totalConfidence` (STRONG BUY/BUY/HOLD/SELL/STRONG SELL, `±20`/`±60` thresholds) with a 20-segment bipolar meter, one-line advice, and Strategies Aligned / Avg Confidence / Buy–Sell stats. Below: `n flagged · m neutral` header and a 400px scroll of signals sorted flagged-first — `FLAG`/`STRONG` chips, 2-line reason with tooltip (passing rows truncate), and `E:/SL:/TP:` levels. Stats are `useMemo` copies (no prop `signals.sort()`). Verdict/stats labels via `t()`; counts, advice, empty state and footnote stay hardcoded English. |
| `OptionsWheel.tsx` | 418 | Cash-secured-put → covered-call simulator. Black-Scholes premiums from 30-day realized vol × 1.15 (`r = 4.5%`), DTE/put-delta/cash sliders, put-vs-call tabs, suitability score over its factors, and a 7-check Alpaca wheel checklist (affordability, IV 20–60%, delta 0.20–0.35, DTE 30–45, put yield ≥12%, no strong downtrend, ≤50% cash concentration) that rolls up to STRONG FIT / ACCEPTABLE. Needs ≥60 bars, returns `null` otherwise. Mounted on `/flow`, not the home page. |
| `PriceChart.tsx` | 352 | Candlestick + volume, canvas rendering. |
| `ForecastSimulator.tsx` | 463 | Monte Carlo paths + percentile bands. Adds a plain-language result read ("Median path points about $X (…%) over N days, with 80% of paths between $A and $B") beneath the summary, and a Neutral icon on Bullish Paths instead of a warning triangle. |
| `StockNews.tsx` | 259 | Aggregated news headlines. |
| `Header.tsx` | 183 | Nav bar with links + search + dark mode (Market Open/10Y Data/5 Strategies labels removed). Includes the **Mobile** link to `/m` (icon-only below `sm`) and a **Research** dropdown (`RESEARCH_LINKS`: Risk, Commodities, Book, Options Flow, 13F Funds, Macro). |

## Remaining Lib Files

| File | Lines | Purpose |
|------|-------|---------|
| `tacticalEngine.ts` | 674 | Regime state machine, 3 entry weapons, position sizing, trailing exit, iceberg execution, `replayEngine()` backtest. |
| `backtestMetrics.ts` | 188 | Spec §2.4 metric suite from a replay's closed trades + bars: total return, CAGR, max drawdown + duration, volatility, Sharpe, Sortino, Calmar, win rate, profit factor, avg win/loss, expectancy. Mark-to-market equity curve (`buildEquityCurve`) includes the open position. Unit-tested in `backtestMetrics.test.ts`. |
| `tradingAgents.ts` | 687 | Rule-based reimplementation of the TradingAgents multi-agent workflow → 5-tier final rating. No AI/ML. |
| `peadAnalysis.ts` | 178 | PEAD (post-earnings drift) alpha model — surprise → drift conviction. Port of ai-hedge-fund `pead.py`. No AI/ML. Currently unused (see above). |
| `strategyRecommendation.ts` | 582 | Market condition analysis → strategy recommendation with confidence + suitability. |
| `stockScreener.ts` | 104 | `screenerStocks` list, filter types. |
| `useScreenerData.ts` | 355 | Fetches all screener stocks, runs recommendations, caches results. |
| `useTacticalHistory.ts` | 58 | In-browser tactical engine replay. No server calls. |
| `siteMode.ts` | 36 | Mobile auto-redirect decision: `<768px` viewport + no `stockpulse_use_full_site` flag → bounce `/` to `/m` (keeps `?symbol=`). Unit-tested in `siteMode.test.ts`. |
| `useHapticFeedback.ts` | 16 | `navigator.vibrate` wrapper for chart scrub feedback (no-ops where unsupported, e.g. iOS). |
| `edgeFn.ts` | 134 | Supabase Edge Function client. The `simulate-ledger` fn is the server-authoritative ledger writer — shares core logic with `tradeSimulator.ts`. |
| `localDb.ts` | 829 | sql.js WASM wrapper, IndexedDB persistence. Historical cache has a bar-currency gate (`isDailyBarSeriesFresh`): newest bar must be ≤ 4 days old or the series is a miss. |
| `portfolioRisk.ts` | 266 | `/risk` math: daily returns, Pearson correlation, beta, annualized vol, weights, drawdown (`maxDrawdownStats`), sector HHI, stress + growth curve. Unit-tested. |
| `commodities.ts` | 281 | `/commodities` universe: 30 verified futures symbols (Yahoo `F` tickers) in 6 groups + per-symbol industry exposure map (helps/squeezes). Unit-tested. |
| `deskBook.ts` | 171 | `/book` math: lot upsert with weighted-average cost merge, validation, mark-to-market P&L, sort helpers. Unit-tested. |
| `optionsFlow.ts` | 278 | `/flow` analytics: put/call ratios, OI walls, max pain, ATM-straddle expected move (×0.85 rule of thumb), unusual activity (vol ≥ 2× OI), chain rows. Unit-tested. |
| `funds13f.ts` | 213 | `/funds` EDGAR handling: submissions → 13F-HR picks, info-table file selection, XML parse (DOMParser), portfolio aggregation + qoq deltas, value-scale heuristic (dollars post-2023). Unit-tested. |
| `macro.ts` | 152 | `/macro` series metadata (12 FRED ids), observation parsing (`.` → null), latest + YoY summarize, window slice, unit-aware formatters. Unit-tested. |
| `sentimentAnalysis.ts` | 1012 | Home-page sentiment: 10 source fetchers emit `items` (text/url/publishedAt/score/label) + `kind` (`social`/`news`/`attention`); RSS/JSON parsing, entity decode, symbol-relevance filter, recency weighting, crowd-vs-news `GroupScore`s, divergence + agreement, attention info, ranked real key quotes, short data-grounded summary. Attention sources are excluded from directional weighting. Pure helpers (`toneOf`, `isRelevantToSymbol`, `computeGroupScores`, `detectDivergence`, `computeAgreement`, `rankKeyQuotes`, `aggregateSources`) unit-tested (13 tests). No AI. |
| `smartMoney.ts` | 929 | `/smart-money` screener: universes (curated 41 / S&P 500 / NASDAQ-100 / union via `universeForMode`), pure scoring (insider 25 / 13F 25 / congress 20 / squeeze 30), Form 4 XML parser (ported from AVS edge fn, `edgarPrimaryDocPath` strips xsl viewer prefix), paced EDGAR fetchers via `/api/edgar`, bulk congress (monthly windows, 1000-row cap-safe bisection), batch quotes via `/api/yahoo/batch-quote`, cap-tier derivation from live marketCap, 13F issuer-name matching, bucketed 4-stage scan orchestration (index modes scan ~100 Form 4s/run, lazy top-100 short interest) with progress + soft-fail stages, plus `mapScanDbRow` (a `smart_money_scan_rows` DB row → UI row) and `serverScanForMode` (projects the server's `universe='index'` rows onto a mode's symbols — index/S&P 500/NASDAQ-100 are served from one pre-scan, curated stays local). Unit-tested (45 tests). |
| `indexMembers.ts` | 605 | Full S&P 500 (488 after junk filtering) + NASDAQ-100 (85) membership for the Option B index universes — `IndexMember`, `SP500_MEMBERS`, `NASDAQ100_MEMBERS`, `buildIndexUnion()` (deduped union, ~501 unique symbols). Generated from public S&P constituents + curated NDX set; share-class tickers normalized to hyphen form (BRK-B). |

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Supabase primary | Cloud-first; localStorage is sync cache |
| Server proxy | CORS + SSRF protection, single caching point |
| No AI/ML | Rule-based signals, template narratives |
| Matrix history localStorage-only | Master Matrix daily snapshots live in `stockpulse_master_matrix` (localStorage), NOT via `storage.ts`/Supabase. Deliberate — past daily snapshots are user-local. Don't "fix" into cloud sync. Supabase feeds them (`stock_historical` bars + backfill), it doesn't store them |
| Stored-bars universe | The 80-symbol index universe has `stock_historical` bars (10y depth, refreshed nightly in batches); outer-universe rows fall back to live/`supabase`-tagged snapshots |
| Browser cron | Data-production is server-side (Supabase Edge Functions); browsers keep only local-maintenance jobs — the hosted Express server (Vercel) is always on |
| Three-tier fetch | Server proxy → direct → CORS proxies (legacy) |
| SQLite backup | Survives Supabase outages, offline-capable |
| PapaParse | Handles unquoted fields with commas (RFC 4180) |
| Ledger server-authoritative | `simulate-ledger` edge fn is the ONLY writer; browsers pull verbatim — prevents forked/corrupted cloud ledger from multiple writers |
| Account rebuild from trades | `pullLedger` + edge fn both run `replayAccounts()` to rebuild accounts from trades — prevents stale/null accounts from poisoning the leaderboard |
| Edge fn builds sync | `tradeSimulator.ts` (browser) and `simulate-ledger/index.ts` (edge fn) share core buy/sell logic; fixes must be applied to both files and both must be deployed |
| Mobile auto-redirect | Phones open the dedicated `/m` view instead of the desktop dashboard (`/` redirects at <768px). Opting into the full site ("Full site" button / "Full analysis") sets `stockpulse_use_full_site` in localStorage so the user isn't bounced back; the choice is per-device and only reset by clearing site data |
