# StockPulse — Codebase Documentation

## Overview

StockPulse is a React + TypeScript stock analysis dashboard with **cloud-first storage** (Supabase primary, SQLite backup, localStorage cache), **browser-based cron jobs**, and a **server-side Express proxy** for CORS-free external API access. It provides real-time stock quotes, technical analysis (8 strategies), price forecasting (Monte Carlo simulation), social sentiment (10+ sources), and politician financial disclosure tracking.

---

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

---

## File-by-File Documentation

### 1. `index.js` — Express Server (437 lines)

**Purpose:** Serves the built SPA from `dist/` and provides server-side API endpoints to bypass CORS restrictions.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/proxy?url=<encoded>` | Generic CORS proxy. Validates URL is not private/internal, 15s timeout. **Primary fetch path for all browser-side data.** |
| `GET /api/yahoo/crumb` | Two-step Yahoo crumb fetch (cookie + crumb). Cached 30 min. |
| `GET /api/finnhub/sentiment?symbol=X` | Proxies Finnhub social sentiment. Requires `FINNHUB_API_KEY`. |
| `GET /api/google-trends?keyword=X` | Scrapes Google Trends explore + widgetdata APIs. |
| `GET /api/politician-trades/unusualwhales?politician=X` | Scrapes UW profile pages, parses `__NEXT_DATA__` JSON. |
| `GET /api/politician-trades/stockspill?member_name=X` | Queries StockSpill Supabase `congress_trades` (read-only). |
| `GET /api/politician-trades/opencabinet?politician=X` | Fetches CSV from `open-cabinet.org`, parses with PapaParse, filters by name + valid tickers. |
| `GET /api/diag/opencabinet` | Diagnostic: Trump trade counts from OpenCabinet CSV. |

**Key dependencies:** `express`, `papaparse`, `node-fetch` (built-in in Node 18+)

---

### 2. `src/lib/localCron.ts` — Browser Cron Scheduler (681 lines)

**Purpose:** In-browser cron scheduler. Runs 5 background jobs on configurable schedules. **Only executes while a tab is open.**

#### The 5 Jobs

| ID | Schedule | What it does |
|----|----------|--------------|
| `sync-stock-data` | Weekdays 6 AM UTC | Fetches quotes + history for top 20 stocks from Yahoo/Stooq → Supabase |
| `sync-politician-trades` | Weekdays 7 AM UTC | Fetches congressional trades from CapitolExposed (10 pages) + CongressInvests (6000 records) → Supabase |
| `archive-sqlite` | Daily 8:30 AM UTC | Flushes pending SQLite writes to IndexedDB |
| `pull-stock-data` | Weekdays 9 AM UTC | Pulls quotes + price bars from Supabase → local SQLite |
| `sync-featured-trades` | Daily 8 AM UTC | Fetches Trump (OpenCabinet + UnusualWhales) + Pelosi (StockSpill + UnusualWhales) → Supabase |

#### Key Functions

| Function | Purpose |
|----------|---------|
| `startScheduler()` | Starts 60-second `setInterval` loop, checks all enabled jobs against UTC time |
| `stopScheduler()` | Clears the interval |
| `triggerJob(jobId)` | Manual run (UI "Run Now" button) |
| `toggleJob(jobId, enabled)` | Enable/disable + persist to localStorage |
| `getJobStatuses()` | Returns all jobs with `lastRun` + `nextRun` |
| `cronMatches(expr, date)` | Tests 5-field cron expression against a Date (UTC) |
| `proxyFetch(url, timeoutMs)` | Three-tier fetch: server proxy → direct → CORS proxies (legacy) |

---

### 3. `src/lib/stockApi.ts` — Yahoo Finance API (377 lines)

**Purpose:** Multi-provider stock data fetcher. Yahoo Finance primary, Stooq fallback. Handles crumb auth, SQLite caching, mock data fallback.

| Function | Purpose |
|----------|---------|
| `fetchStockQuote(symbol, forceRefresh?)` | Current quote. Yahoo v8 chart → Stooq CSV → mock. |
| `fetchHistoricalData(symbol, forceRefresh?)` | 10 years daily OHLCV. Yahoo v8 chart → Stooq CSV → generated synthetic. |
| `getYahooCrumb()` | Fetches from `/api/yahoo/crumb`, caches 30 min |
| `fetchQuoteSummary(symbol, preferredHost?)` | Yahoo v10 for P/E, market cap, sector |
| `quoteFromYahoo(symbol)` | Full quote from Yahoo v8 + v10 |
| `quoteFromStooq(symbol)` | Full quote from Stooq CSV |
| `formatMarketCap(raw)` | Formats to "2.8T", "565B", etc. |

**Fetch chain:** `proxyFetch()` → server proxy first → direct fetch → third-party CORS proxies (legacy fallback)

---

### 4. `src/lib/stockData.ts` — Analytics Engine (866 lines)

**Purpose:** All rule-based analytics. **No AI/ML.** Template-based narratives only.

#### Technical Indicators

| Function | Description |
|----------|-------------|
| `calculateSMA(data, period)` | Simple Moving Average |
| `calculateEMA(data, period)` | Exponential Moving Average |
| `calculateRSI(data, period=14)` | Relative Strength Index |
| `calculateMACD(data)` | MACD (12/26/9) with signal + histogram |
| `calculateBollingerBands(data, period=20, stdDev=2)` | Upper, middle, lower bands |

#### Signal Generation (8 Strategies)

`generateSignals(data)` runs these strategy groups:

1. **MA Crossover** — Golden/Death Cross (20-SMA vs 50-SMA), 200-SMA trend filter
2. **RSI Momentum** — Oversold (<30) / Overbought (>70) / momentum shift
3. **MACD Momentum** — Bullish/bearish crossovers, histogram expansion
4. **Bollinger Position** — Squeeze detection, band breakouts
5. **Volume** — Spike detection (>2.5x avg), low volume warning
6. **Candle Patterns** — Engulfing, hammer, shooting star
7. **Support/Resistance** — 50-day high/low approach
8. **Multi-Timeframe RSI** — RSI(7) + RSI(14) + RSI(21) confluence

Each strategy returns a `Signal` with `type` (buy/sell/hold), `strength`, `confidence` (0-100), `entryLevel`, `stopLoss`, `takeProfit`.

#### Forecasting

| Function | Description |
|----------|-------------|
| `generateForecast(data, days=30)` | Trend-based forecast with confidence intervals |
| `generateMonteCarloPaths(data, days=30, numPaths=100)` | Geometric Brownian motion simulation, percentile bands (p10-p90) |

#### Other

- `popularStocks` — 60+ hardcoded stock definitions across 12 sectors
- `generateHistoricalData(basePrice, volatility?)` — Synthetic 10-year OHLCV (fallback)
- `calculateStrategyPerformance()` — Hardcoded backtesting metrics for 5 strategies

---

### 5. `src/lib/supabaseDb.ts` — Supabase Cloud Integration (453 lines)

**Purpose:** Cloud (Layer 3) storage. Lazy client, config in localStorage, bidirectional sync.

#### Tables

| Table | Purpose |
|-------|---------|
| `stockpulse_kv` | Key-value pairs (settings, documents) |
| `stock_quotes` | One row per symbol with JSON data blob |
| `stock_historical` | One row per symbol+date (OHLCV) |
| `politician_featured_trades` | Featured politician trades (Trump, Pelosi) |

#### Key Functions

| Function | Purpose |
|----------|---------|
| `getClient()` | Lazy singleton Supabase client |
| `pushKeys(keys?)` | Upsert KV rows to Supabase |
| `pullAll()` | Pull all KV rows → localStorage + SQLite (paginated 500/page) |
| `maybeSyncToSupabase(key)` | Debounced (3s) push on every write. Skipped during active pull. |
| `pushStockData()` | Push all cached quotes + bars (chunked 500/batch) |
| `pullStockData()` | Pull all remote quotes + bars → local SQLite |
| `pushFeaturedTrades(trades)` | Upsert trades (chunked 100/batch) |
| `pullFeaturedTradesFor(politician)` | Filter by name, sort by date desc |
| `normalizeFeaturedTradeNames()` | One-time cleanup: "Last, First" → "First Last" |

---

### 6. `src/lib/storage.ts` — Unified Storage Layer (70 lines)

**Purpose:** **Single entry point for ALL data writes.** Every write goes through here.

#### Write Flow

```
storage.setItem(key, value)
  │
  ├─→ localStorage.setItem()          (immediate — sync reads)
  ├─→ maybeSyncToSupabase(key)        (debounced 3s — cloud push)
  └─→ setConfig/setDocument()         (fire-and-forget — SQLite backup)
```

| Function | Purpose |
|----------|---------|
| `getItem(key)` | Read from localStorage (sync cache) |
| `setItem(key, value)` | Write to all layers |
| `removeItem(key)` | Remove from localStorage + SQLite, push empty to Supabase |
| `getJson<T>(key)` | Parse JSON from localStorage |
| `setJson(key, value)` | Stringify + write |

---

### 7. `src/lib/syncKeys.ts` — Synced Key Definitions (31 lines)

**Purpose:** Single source of truth for which keys are mirrored across all storage layers.

| Constant | Keys |
|----------|------|
| `CONFIG_KEYS` | `stockpulse_watchlist`, `stockpulse_users`, `stockpulse_auth`, `stockpulse_admin_auth`, `stockpulse_api_config`, `sp-lang`, `stockpulse_recent_stocks` |
| `DOCUMENT_KEYS` | `stockpulse_screener_results`, `stockpulse_avs_results`, `stockpulse_politician_trades`, `stockpulse_trump_trades`, `stockpulse_featured_trades`, `stockpulse_cron_history`, `stockpulse_alerts`, `stockpulse_alert_config`, `stockpulse_market_snapshot` |

---

### 8. `src/hooks/useStockData.ts` — Main React Hook (126 lines)

**Purpose:** Primary hook managing stock data lifecycle.

| Return | Type |
|--------|------|
| `selectedStock` | Current stock metadata |
| `historicalData` | 10-year OHLCV array |
| `signals` | Trading signals from 8 strategies |
| `isLoading` | Loading state |
| `isRealData` | Whether data is real vs mock |
| `setSelectedStock(symbol)` | Change stock + invalidate caches |
| `refetch()` | Force refresh |

Uses `@tanstack/react-query` with 1-min stale time (quotes) and 5-min (historical). Listens for `stockpulse-sync` events from cron jobs.

---

### 9. `src/components/PoliticianTrades.tsx` — Politician Trades Panel (809 lines)

**Purpose:** Full-featured UI for US congressional and presidential financial disclosure trades.

#### Data Sources (5)

| Source | Endpoint | Data |
|--------|----------|------|
| CapitolExposed | Direct API | Congressional trades |
| CongressInvests | Direct API | Congressional trades |
| UnusualWhales | `/api/politician-trades/unusualwhales` | All politicians |
| StockSpill | `/api/politician-trades/stockspill` | Congress members |
| OpenCabinet | `/api/politician-trades/opencabinet` | Presidential disclosures |

#### Featured Politicians

| Name | Sources | Data Type |
|------|---------|-----------|
| Donald J Trump | OpenCabinet + UnusualWhales | OGE Form 278T disclosures |
| Nancy Pelosi | StockSpill + UnusualWhales | STOCK Act disclosures |

#### Data Flow

1. **Initial load:** CapitolExposed page 1 → fallback to CongressInvests
2. **Featured click:** Supabase first (instant) → background live refresh → save to Supabase
3. **Load more:** CapitolExposed pagination → CongressInvests offset
4. **Dedup:** Composite key `politician|symbol|date|type` via `mergeInto()`

---

### 10. `src/components/SocialSentimentCheck.tsx` — Sentiment Panel (210 lines)

**Purpose:** Multi-source social sentiment display for a stock.

| Source | Icon |
|--------|------|
| Google News | TrendingUp |
| StockTwits | MessageSquare |
| Yahoo Finance | BarChart3 |
| ApeWisdom | Flame |
| SocialTickers | Activity |
| Finnhub | Radio |
| Reddit | Globe |
| MarketWatch | Newspaper |
| CNBC | Tv |
| Google Trends | Search |

Shows: overall sentiment (bullish/bearish/neutral), confidence %, summary, confirmation/divergence with trading action.

---

## Data Flow Summary

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
    → 8 strategy analysis
    → Signal[] returned to UI

Cron job runs (background)
  → stockApi for 20 popular stocks
  → supabaseDb.pushStockData()
  → dispatches stockpulse-sync event
  → useStockData invalidates React Query caches
  → UI refreshes automatically
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Supabase is primary storage** | Cloud-first; localStorage is just a sync read cache |
| **Server proxy for all external APIs** | Solves CORS; blocks SSRF; single point for caching |
| **No AI/ML** | Rule-based signals and template narratives only |
| **Browser cron (not server cron)** | No always-on server needed (Render free tier sleeps) |
| **Three-tier fetch fallback** | Server proxy → direct → CORS proxies (legacy) |
| **SQLite as backup** | Survives Supabase outages; offline-capable |
| **PapaParse for CSV** | Handles unquoted fields with commas (RFC 4180 edge cases) |

---

## Pages

### `src/pages/Index.tsx` — Home / Dashboard (891 lines)

Main landing page. Top news, stock search, quote display, technical indicators (RSI, MACD, Bollinger, S/R), signal panel, strategy recommendation, today action plan, and sentiment panel. Uses `useStockData` hook. Featured on `/` route.

### `src/pages/TradingMasters.tsx` — Strategy Performance (510 lines)

Displays backtested performance metrics for 5 trading strategies (MA Crossover, RSI Momentum, MACD, Bollinger, Breakout). Radar chart visualization, strategy comparison cards, and trading master profiles. Accessible from Header nav.

### `src/pages/Tactical.tsx` — Tactical Trading Engine (662 lines)

Interactive rule-based trading engine UI. Runs the tactical engine on selected stock. Shows regime state (STRONG_UPTREND / STRONG_DOWNTREND / SIDEWAYS_TIGHT / TRANSITIONING), recommended weapon (A/B/C), position sizing, trailing stop, iceberg plan, and historical replay. Sliders for ATR length, volatility factor, max risk per trade, etc. Uses `useTacticalHistory` hook for past N-bar replay.

### `src/pages/Screener.tsx` — Stock Screener (604 lines)

Full-featured stock screener with sorting, risk/signal/sector filters. Shows strategy recommendations, news sentiment, social sentiment per stock. Embeds `AsymmetricValueScreener`, `SectorHeatmap`, and `PoliticianTrades`. Uses `useScreenerData` hook.

### `src/pages/Settings.tsx` — Settings & Configuration (767 lines)

Multi-section settings page:
- **User Account:** Login, signup, password reset (localStorage-based)
- **Watchlist:** Add/remove stocks from user watchlist
- **Admin Section:** Password-gated (SHA-256 hash). Includes SQLite DB export/import, Supabase cloud sync configuration
- **Supabase Config:** Enter URL + anon key, test connection, push/pull keys, push/pull stock data
- **Cloud Sync Card:** Shows connection status, last sync time

### `src/pages/Admin.tsx` — Admin Panel (275 lines)

Password-protected admin page (same password as Settings admin section). Displays all 5 cron jobs with status (enabled/disabled, last run, next run). Manual "Run Now" trigger per job. Run history table (last 20 runs with status + duration). Toggle jobs on/off. Requires `stockpulse_admin_auth` in localStorage.

### `src/pages/ApiSettings.tsx` — API Key Configuration (265 lines)

External API key management for providers that require browser-side keys (Finnhub, Polygon.io, Alpha Vantage, etc.). Stored in `stockpulse_api_config` in localStorage. Test connection per provider. NOT used for Supabase or server-side endpoints.

### `src/pages/NotFound.tsx` — 404 Page (24 lines)

Simple 404 page with link back to home.

---

## Routing (`src/App.tsx`)

```
/                    → Index.tsx (dashboard)
/masters             → TradingMasters.tsx
/tactical            → Tactical.tsx
/screener            → Screener.tsx
/settings            → Settings.tsx
/admin               → Admin.tsx
/api-settings        → ApiSettings.tsx
*                    → NotFound.tsx
```

---

## Key Components

### `src/components/PoliticianTrades.tsx` — Politician Trades Panel (809 lines)

See Section 9 in File-by-File above. 5 sources (CapitolExposed, CongressInvests, UnusualWhales, StockSpill, OpenCabinet). Featured politicians: Trump (OpenCabinet + UW), Pelosi (StockSpill + UW). Dedup via composite key. Supabase cache for instant display.

### `src/components/SocialSentimentCheck.tsx` — Sentiment Panel (210 lines)

See Section 10 in File-by-File above. 10 sentiment sources. Keyword-based scoring, no AI. Template-based summary.

### `src/components/AsymmetricValueScreener.tsx` — Asymmetric Value Screener (326 lines)

Custom screener that evaluates stocks for asymmetric risk/reward profiles. Scores each stock on downside protection vs upside potential. Embeds inside Screener page.

### `src/components/SectorHeatmap.tsx` — Sector Heatmap (262 lines)

Visual heatmap of sector performance. Color-coded by performance (green = up, red = down). Embeds inside Screener page.

### `src/components/ChartAnalyst.tsx` — Chart Pattern Recognition (589 lines)

Pattern recognition engine. Detects support/resistance, trendlines, candlestick patterns. Generates annotated chart overlays.

### `src/components/AlertPanel.tsx` — Price Alert Manager (280 lines)

UI for creating/editing/dismissing price alerts. Supports percentage change, price level, and indicator-based triggers. Stores alerts in `stockpulse_alerts` via storage layer.

### `src/components/MultiTimeframeRSI.tsx` — Multi-Timeframe RSI (138 lines)

Displays RSI(7), RSI(14), RSI(21) side-by-side with confluence visualization. Used in Index and Tactical pages.

### `src/components/LiquidityMonitor.tsx` — Liquidity Monitor (183 lines)

Real-time bid/ask depth display. Uses `deriveOrderBook()` from tacticalEngine. Shows volume profile and imbalance ratio.

### `src/components/StockSearch.tsx` — Stock Search Input (88 lines)

Search input with autocomplete. Debounced (300ms) filtering against `popularStocks` list. Returns selected stock via callback.

### `src/components/StockMetrics.tsx` — Key Metrics Display (131 lines)

P/E ratio, market cap, 52-week range, volume. Displayed in card format on Index page.

### `src/components/SignalPanel.tsx` — Trading Signals Panel (195 lines)

Displays the 8 strategy signals with buy/sell/hold icons and confidence bars. Color-coded by strength.

### `src/components/PriceChart.tsx` — Price Chart (259 lines)

Candlestick chart with volume bars. Uses HTML canvas rendering. Displays SMA/EMA overlays, support/resistance lines.

### `src/components/NewsSentimentTrend.tsx` — News Sentiment Trend (223 lines)

Historical news sentiment visualization over time. Pulls from multiple news sources.

### `src/components/ForecastSimulator.tsx` — Price Forecast Display (270 lines)

Shows Monte Carlo simulation paths + trend forecast. Percentile bands (p10/p50/p90) over configurable horizon.

### `src/components/StockNews.tsx` — News Feed (276 lines)

Aggregated news headlines for selected stock. Source badges, timestamps, sentiment icons.

### `src/components/StrategyPerformance.tsx` — Strategy Metrics (237 lines)

Backtesting performance cards for each of the 5 master strategies. Win rate, profit factor, Sharpe ratio.

### `src/components/BackToTop.tsx` — Scroll-to-Top Button (13 lines)

Floating button, appears on scroll > 500px. Smooth scroll to top.

### `src/components/Header.tsx` — Navigation Header (225 lines)

Top navigation bar with nav links (Home, Tactical, Screener, Masters), stock search, and dark mode toggle.

---

## Remaining Lib Files

### `src/lib/tacticalEngine.ts` — Tactical Trading Engine (755 lines)

Complete rule-based trading engine. Modules:
1. **Microstructure** — Liquidity check, order book imbalance, bid/ask skew
2. **Regime Detection** — 4 states: STRONG_UPTREND, STRONG_DOWNTREND, SIDEWAYS_TIGHT, TRANSITIONING. Uses ADX, Bollinger bandwidth, ATR.
3. **Entry Weapons** — Weapon A (breakout pullback), Weapon B (mean reversion), Weapon C (delayed momentum)
4. **Position Sizing** — Risk-based: `maxRiskPerTrade * accountEquity / ATR`
5. **Exit Management** — Adaptive trailing stop (ATR-based), time stop (minutes held)
6. **Iceberg Execution** — Splits position into N slices with staggered timing
7. **`replayEngine()`** — Backtests the engine over N past bars, returns `ReplayResult`

Key exports: `EngineParams`, `DEFAULT_PARAMS`, `runEngine()`, `calculatePositionSize()`, `manageExit()`, `buildIcebergPlan()`, `replayEngine()`, `atr()`, `adx()`, `bollinger()`, `rsi()`

### `src/lib/strategyRecommendation.ts` — Strategy Recommendation Engine (581 lines)

Market condition analysis + strategy recommendation. Analyzes regime, volatility, momentum, trend strength. Returns top strategy with confidence + suitability + reasoning. Key types: `MarketCondition`, `StrategyRecommendation`, `RecommendationResult`. Key function: `analyzeMarketConditions()`, `getStrategyRecommendations()`.

### `src/lib/stockScreener.ts` — Screener Configuration

Defines `screenerStocks` (list of stocks to screen), `ScreenerStock` interface, filter types (`SortField`, `SortDirection`, `RiskFilter`, `SignalFilter`).

### `src/hooks/useScreenerData.ts` — Screener Data Hook (361 lines)

Fetches quotes + historical data for all screener stocks. Runs strategy recommendations. Stores results in `stockpulse_screener_results` via storage layer. Returns `UseScreenerDataResult` with results, loading state, progress, refresh.

### `src/hooks/useTacticalHistory.ts` — Tactical History Hook (48 lines)

In-browser replay of tactical engine over N past bars. Pure computation, no server calls. Returns `ReplayResult` + source + loading state.

### `src/lib/edgeFn.ts` — Edge Function Client

Client-side code for calling Supabase Edge Functions (if deployed). `edgeFn()` calls the function; `isEdgeFnAvailable()` checks if Edge Functions are configured.

### `src/lib/localDb.ts` — SQLite Database Layer

sql.js (WASM) wrapper. Initializes SQLite in-memory DB, persists to IndexedDB (auto-save every 5s) + optional File System Access API. Key functions: `initDb()`, `exportDb()`, `importDb()`, `importCsv()`, `getStats()`, `isFsAccessSupported()`, `pickDbFile()`, `resetDbFile()`.
