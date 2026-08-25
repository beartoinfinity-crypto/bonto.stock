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

### `src/lib/stockApi.ts` — Yahoo Finance (377 lines)

Fetch chain: `proxyFetch()` → server proxy first → direct → CORS proxies.

| Function | Purpose |
|----------|---------|
| `fetchStockQuote(symbol)` | Yahoo v8 chart → Stooq CSV → mock |
| `fetchHistoricalData(symbol)` | 10y daily OHLCV. Yahoo v8 → Stooq → synthetic |
| `getYahooCrumb()` | `/api/yahoo/crumb`, cached 30 min |
| `fetchQuoteSummary(symbol)` | Yahoo v10: P/E, market cap, sector |

### `src/lib/stockData.ts` — Analytics Engine (866 lines)

**No AI/ML.** Rule-based signals, template narratives.

8 strategies in `generateSignals()`: MA Crossover, RSI Momentum, MACD Momentum, Bollinger Position, Volume, Candle Patterns, S/R Break, Multi-TF RSI. Each returns `Signal` with direction, strength, confidence (0-100), entry/stop/target.

Forecasting: `generateForecast()` (trend + confidence bands), `generateMonteCarloPaths()` (GBM simulation, p10-p90).

### `src/lib/supabaseDb.ts` — Supabase Cloud (453 lines)

Tables: `stockpulse_kv`, `stock_quotes`, `stock_historical`, `politician_featured_trades`.

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
| `/masters` | TradingMasters — Strategy perf (510 lines) | Radar charts, 5 strategies |
| `/tactical` | Tactical — Trade planner (662 lines) | `useTacticalHistory`, `tacticalEngine` |
| `/screener` | Screener — Batch screen (604 lines) | `useScreenerData` |
| `/settings` | Settings — Config (767 lines) | Auth, watchlist, Supabase, DB ops |
| `/admin` | Admin — Cron mgmt (275 lines) | `localCron` jobs, run history |
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
| Browser cron | No always-on server (Render free tier sleeps) |
| Three-tier fetch | Server proxy → direct → CORS proxies (legacy) |
| SQLite backup | Survives Supabase outages, offline-capable |
| PapaParse | Handles unquoted fields with commas (RFC 4180) |
