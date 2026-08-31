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
    → Yahoo v8 chart (10y) or Stooq CSV
    → SQLite cache
  → stockData.generateSignals()
    → 8 strategy analysis → Signal[] returned to UI

Cron job runs (background)
  → stockApi for 20 popular stocks
  → supabaseDb.pushStockData()
  → dispatches stockpulse-sync event
  → useStockData invalidates React Query caches → UI refreshes
```

## Core Modules

### `index.js` — Express Server (437 lines)

Serves `dist/` SPA and provides server-side API endpoints.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/proxy?url=<encoded>` | CORS proxy. SSRF protection, 15s timeout. **Primary fetch path.** |
| `GET /api/yahoo/crumb` | Two-step Yahoo crumb (cookie + crumb). Cached 30 min. |
| `GET /api/finnhub/sentiment?symbol=X` | Finnhub social sentiment. Requires `FINNHUB_API_KEY`. |
| `GET /api/google-trends?keyword=X` | Google Trends scraping. |
| `GET /api/politician-trades/unusualwhales?politician=X` | UW profile scrape, `__NEXT_DATA__` JSON parse. |
| `GET /api/politician-trades/stockspill?member_name=X` | StockSpill Supabase `congress_trades` (read-only). |
| `GET /api/politician-trades/opencabinet?politician=X` | OpenCabinet CSV parse (PapaParse), name + ticker filter. |
| `GET /api/diag/opencabinet` | Diagnostic: Trump trade counts. |

### `src/lib/localCron.ts` — Browser Cron (681 lines)

Five jobs, run while a tab is open:

| Job | Schedule | Action |
|-----|----------|--------|
| `sync-stock-data` | Weekdays 6 AM UTC | Yahoo/Stooq quotes → Supabase |
| `sync-politician-trades` | Weekdays 7 AM UTC | CapitolExposed + CongressInvests → Supabase |
| `sync-featured-trades` | Daily 8 AM UTC | Trump (OpenCabinet + UW) + Pelosi (StockSpill + UW) → Supabase |
| `archive-sqlite` | Daily 8:30 AM UTC | Flush pending SQLite writes |
| `pull-stock-data` | Weekdays 9 AM UTC | Supabase → local SQLite |

Key: `proxyFetch()` chains server proxy → direct → CORS proxies (legacy).

### `src/lib/stockApi.ts` — Yahoo Finance (364 lines)

Fetch chain: `proxyFetch()` → server proxy first → direct → CORS proxies.

| Function | Purpose |
|----------|---------|
| `fetchStockQuote(symbol)` | Yahoo v8 chart → Stooq CSV → mock |
| `fetchHistoricalData(symbol)` | 10y daily OHLCV. Yahoo v8 → Stooq → synthetic |
| `getYahooCrumb()` | `/api/yahoo/crumb`, cached 30 min |
| `fetchQuoteSummary(symbol)` | Yahoo v10: P/E, market cap, sector |
| `localFundamentals(symbol)` | Curated fallback (name, sector, marketCap, pe) from `popularStocks`. Used when live `quoteSummary` returns null. |

**Fundamentals fallback chain:** `quoteFromYahoo`/`quoteFromStooq` try live `fetchQuoteSummary`, then fall back to `localFundamentals()`. The cached-quote return path in `fetchStockQuote` also self-heals stale/blank fundamentals by merging curated values. Custom symbols not in `popularStocks` will still show `Unknown/N/A/0` when the live endpoint is unreachable.

### `src/lib/masterAnalysis.ts` — 12 Trading Masters (594 lines)

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

### `src/lib/tradingAgents.ts` — Trading Agents Engine (573 lines)

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

### `src/lib/supabaseHistory.ts` — Stored OHLCV (158 lines)

Pulls real daily bars from the **`stock_price_history`** Supabase table (32 covered S&P 500 stocks, ~81k bars through 2026-08-27, ~2,643 bars/symbol) — the data source for Master Matrix snapshots and per-stock history backfill. *Distinct from `stock_historical` (same data intent, different table).*

| Function | Purpose |
|----------|---------|
| `fetchStoredHistory()` | All symbols with bars (min-bar filtered), paginated `order=date.asc` |
| `fetchStoredHistoryForSymbol(symbol)` | Bars for one symbol, case-insensitive `symbol=eq.` |

### `src/lib/supabaseConfig.ts` — Committed Config (11 lines)

Public, committed anon `supabaseUrl`/`supabaseKey` (project `qwezfxdfaistnabwqols`) + project ref. `.env` is gitignored; this file is the deployment source.

### `src/hooks/useMasterMatrix.ts` — Master Matrix Hook (511 lines)

Central state for the Master Matrix and history pages.

| Concern | Detail |
|---------|--------|
| Universe | `universeId`/`setUniverseId` (`'sp500'`/`'nasdaq100'`/`'all'`); feeds `filterStocksByUniverse()` |
| Custom symbols | `customSymbols` persisted at `stockpulse_master_matrix_custom`; `addCustomSymbol`/`removeCustomSymbol` via `isValidSymbol` regex `/^[A-Za-z][A-Za-z0-9.\-]{0,5}$/`; synthetic `makeCustomStock()` |
| Matrix rows | `MatrixStockRow` incl. `sellCount` (SELL+AVOID count) |
| Snapshots | `DailySnapshot` incl. `source: 'live' \| 'supabase'`; accumulated per stock |
| History storage | localStorage key `stockpulse_master_matrix` (single source of truth for past snapshots) |
| Backfill | `loadMatrix` exported; standalone `backfillStockHistory(symbol, maxDays=365)` computes per-day analyses from stored bars and merges snapshots (replaces that date range, keeps others). Hook's `backfillHistory` is a thin wrapper |

### `src/lib/syncKeys.ts` — Synced Keys (31 lines)

### `src/lib/stockData.ts` — Analytics Engine (866 lines)

**No AI/ML.** Rule-based signals, template narratives.

8 strategies in `generateSignals()`: MA Crossover, RSI Momentum, MACD Momentum, Bollinger Position, Volume, Candle Patterns, S/R Break, Multi-TF RSI. Each returns `Signal` with direction, strength, confidence (0-100), entry/stop/target.

Forecasting: `generateForecast()` (trend + confidence bands), `generateMonteCarloPaths()` (GBM simulation, p10-p90).

### `src/lib/supabaseDb.ts` — Supabase Cloud (453 lines)

Tables: `stockpulse_kv`, `stock_quotes`, `stock_historical`, `stock_price_history` (real OHLCV bars, read via `supabaseHistory.ts`), `politician_featured_trades`.

Key: `maybeSyncToSupabase(key)` debounced 3s push. `pullAll()` paginated 500/page. `pushFeaturedTrades()` chunked 100/batch.

### `src/lib/storage.ts` — Unified Write Layer (70 lines)

**Single entry point for ALL writes.** `setItem()` → localStorage (sync) + Supabase (debounced 3s) + SQLite (fire-and-forget).

### `src/hooks/useStockData.ts` — Main Hook (126 lines)

Returns `{ selectedStock, historicalData, signals, isLoading, isRealData, setSelectedStock, refetch }`. TanStack React Query with 1-min stale (quotes), 5-min (historical). Listens for `stockpulse-sync` cron events.

### `src/lib/syncKeys.ts` — Synced Keys (31 lines)

`CONFIG_KEYS`: watchlist, users, auth, admin auth, API config, lang, recent stocks.
`DOCUMENT_KEYS`: screener results, AVS results, politician trades, featured trades, cron history, alerts, market snapshot.

---

## Pages

| Route | Page | Key Hook/Component |
|-------|------|--------------------|
| `/` | Index — Dashboard (891 lines) | `useStockData` |
| `/masters` | TradingMasters — 12-investor analyzer (281 lines) | `analyzeStock` + `summarizeMasterResult`; verdict summary boxes (BUY/HOLD/WATCH/SELL-AVOID), per-master cards |
| `/trading-agents` | TradingAgentsPage — multi-agent report (391 lines) | `runTradingAgents`; analyst team, bull/bear debate, trader plan, risk committee, portfolio decision, final 5-tier rating |
| `/masters-matrix` | MasterMatrix — Top-50 matrix (521 lines) | `useMasterMatrix`; universe/custom-stock picker, rank, rows link to history |
| `/masters-matrix/:symbol` | StockHistory — Per-stock history (275 lines) | `useMasterMatrix`; 12-master verdicts per day, stats, "Backfill past year" |
| `/tactical` | Tactical — Trade planner (662 lines) | `useTacticalHistory`, `tacticalEngine` |
| `/screener` | Screener — Batch screen (604 lines) | `useScreenerData` |
| `/settings` | Settings — Config (767 lines) | Auth, watchlist, Supabase, DB ops |
| `/admin` | Admin — Cron mgmt (255 lines) | `localCron` jobs, run history |
| `/api-settings` | ApiSettings — API keys (265 lines) | Provider configs |
| `*` | NotFound — 404 (24 lines) | — |

## Components

| Component | Lines | Purpose |
|-----------|-------|---------|
| `PoliticianTrades.tsx` | 809 | 5-source politician trades (UW, StockSpill, OpenCabinet, CapitolExposed, CongressInvests). Featured: Trump + Pelosi. Supabase cache. |
| `SocialSentimentCheck.tsx` | 210 | 10-source sentiment (Google News, StockTwits, Yahoo, ApeWisdom, SocialTickers, Finnhub, Reddit, MarketWatch, CNBC, Google Trends). Keyword scoring, no AI. |
| `AsymmetricValueScreener.tsx` | 326 | Risk/reward scoring. Inside Screener. |
| `SectorHeatmap.tsx` | 262 | Sector performance heatmap. Inside Screener. |
| `ChartAnalyst.tsx` | 589 | Pattern recognition: S/R, trendlines, candle patterns. |
| `AlertPanel.tsx` | 280 | Price alert manager. |
| `MultiTimeframeRSI.tsx` | 138 | RSI(7/14/21) confluence display. |
| `LiquidityMonitor.tsx` | 183 | Bid/ask depth via `deriveOrderBook()`. |
| `StockSearch.tsx` | 88 | Autocomplete search, 300ms debounce. |
| `StockMetrics.tsx` | 131 | P/E, market cap, 52-week range, volume. |
| `SignalPanel.tsx` | 195 | 8 strategy signals with confidence bars. |
| `PriceChart.tsx` | 259 | Candlestick + volume, canvas rendering. |
| `ForecastSimulator.tsx` | 270 | Monte Carlo paths + percentile bands. |
| `StockNews.tsx` | 276 | Aggregated news headlines. |
| `Header.tsx` | 225 | Nav bar with links + search + dark mode. |

## Remaining Lib Files

| File | Lines | Purpose |
|------|-------|---------|
| `tacticalEngine.ts` | 755 | Regime state machine, 3 entry weapons, position sizing, trailing exit, iceberg execution, `replayEngine()` backtest. |
| `tradingAgents.ts` | 573 | Rule-based reimplementation of the TradingAgents multi-agent workflow → 5-tier final rating. No AI/ML. |
| `strategyRecommendation.ts` | 581 | Market condition analysis → strategy recommendation with confidence + suitability. |
| `stockScreener.ts` | — | `screenerStocks` list, filter types. |
| `useScreenerData.ts` | 361 | Fetches all screener stocks, runs recommendations, caches results. |
| `useTacticalHistory.ts` | 48 | In-browser tactical engine replay. No server calls. |
| `edgeFn.ts` | — | Supabase Edge Function client. |
| `localDb.ts` | — | sql.js WASM wrapper, IndexedDB persistence. |

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Supabase primary | Cloud-first; localStorage is sync cache |
| Server proxy | CORS + SSRF protection, single caching point |
| No AI/ML | Rule-based signals, template narratives |
| Matrix history localStorage-only | Master Matrix daily snapshots live in `stockpulse_master_matrix` (localStorage), NOT via `storage.ts`/Supabase. Deliberate — past daily snapshots are user-local. Don't "fix" into cloud sync. Supabase feeds them (`stock_price_history` bars + backfill), it doesn't store them |
| Stored-bars universe | Only 32 S&P 500 symbols have `stock_price_history` bars (~81k total); outer-universe rows fall back to live/`supabase`-tagged snapshots |
| Browser cron | No always-on server (Render free tier sleeps) |
| Three-tier fetch | Server proxy → direct → CORS proxies (legacy) |
| SQLite backup | Survives Supabase outages, offline-capable |
| PapaParse | Handles unquoted fields with commas (RFC 4180) |
