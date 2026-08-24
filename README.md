# Dan's StockPulse

Stock analysis dashboard with cloud-first storage. Runs in the browser; deploys to Render.com.

> **Education only. Not financial advice.**

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:8080
npm run build      # production build → dist/
npm run test       # vitest
npm start          # serve dist/ via Express
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vite + TypeScript + React 18 |
| UI | shadcn/ui (Radix) + Tailwind CSS |
| Charts | Recharts |
| Data Fetching | TanStack React Query |
| Local DB | sql.js (WASM SQLite) — IndexedDB / File System API persistence |
| Cloud DB | Supabase (PostgreSQL) — primary source of truth |
| Cron | Browser-based scheduler (runs while tab is open) |
| Server | Express (`index.js`) — serves dist/ + server-side proxy |
| Deploy | Render.com (auto-deploy on push to main) |

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Price charts, signals, sentiment, action plan |
| `/screener` | Screener | Batch-screen all stocks by signal confidence |
| `/tactical` | Tactical Engine | Per-stock trade planner with position sizing |
| `/masters` | Trading Masters | 12 legendary investors analyze any stock |
| `/settings` | Settings | Auth, watchlist, DB export/import, cloud sync |
| `/admin` | Admin | Cron job management (password-protected) |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  React UI ← hooks ← lib/ (analytics, signals, forecasting) │
│     │                                                       │
│     ├── storage.ts ──→ localStorage (instant reads)         │
│     │                ──→ SQLite (offline backup)            │
│     │                ──→ Supabase (cloud primary)           │
│     │                                                       │
│     └── localCron.ts ──→ fetches data on schedule           │
│                          pushes to Supabase                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│                   RENDER.COM (Express)                      │
│                                                             │
│  index.js:                                                  │
│    GET /          → serves dist/ (SPA catch-all)            │
│    GET /api/proxy → SSRF-protected CORS proxy               │
│    GET /api/politician-trades/unusualwhales → scrape UW     │
│    GET /api/politician-trades/stockspill → query StockSpill │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
External APIs (Yahoo, CapitolExposed, UnusualWhales, StockSpill)
  ↓ (via server proxy or direct fetch)
Browser analytics engine (signals, forecasts, sentiment)
  ↓
React components (display)
  ↓
Storage layer (write)
  ├── Supabase (primary, debounced 3s)
  ├── SQLite (backup, fire-and-forget)
  └── localStorage (sync read cache)
```

### Boot Sequence

1. Express serves `dist/` from Render
2. React app loads → `App.tsx` calls `pullAll()` to hydrate localStorage from Supabase
3. `useStockData` hook fetches Yahoo data → caches in SQLite
4. Cron scheduler starts → runs enabled jobs on schedule

## Storage Hierarchy (Cloud-First)

| Priority | Store | Role | When Written |
|----------|-------|------|-------------|
| 1 (primary) | **Supabase** | Source of truth | First (debounced 3s) |
| 2 (backup) | **SQLite** | Offline archive | Second (fire-and-forget) |
| 3 (cache) | **localStorage** | Instant reads | Always (sync) |

**On boot**: localStorage/SQLite are hydrated FROM Supabase (`pullAll()`), so the cloud always wins.

**Write path**: `storage.setItem()` → localStorage + Supabase (debounced) + SQLite (async)

### Supabase Tables

| Table | Purpose | Key |
|-------|---------|-----|
| `stockpulse_kv` | Settings, configs, documents | `key` (text PK) |
| `stock_quotes` | Cached quote data per symbol | `symbol` (text PK) |
| `stock_historical` | OHLCV bars | `(symbol, date)` PK |
| `politician_featured_trades` | Trump/Pelosi featured trades | `id` (text PK) |

## Data Sources

### Stock Data
- **Yahoo Finance v8 chart API**: Price + historical OHLCV (no auth needed)
- **Yahoo Finance v10 quoteSummary**: Fundamentals (sector, market cap, P/E)
- **Crumb token**: Fetched once, cached 30 min

### Politician Trades
- **CapitolExposed**: Recent House/Senate trades (paginated API)
- **CongressInvests**: Full history back to 2015 (House + Senate)
- **UnusualWhales**: Trump OGE Form 278T filings (scraped from profile page `__NEXT_DATA__`)
- **StockSpill**: Congress trades (Supabase REST API at `artscweyrracfffoqvur`)

### CORS Proxy Chain
Each API request tries up to 3 fetches per URL:
1. **Server-side proxy** (`/api/proxy?url=...`) — primary, no CORS restrictions
2. **Direct fetch** — works for same-origin
3. **Third-party CORS proxies** — legacy fallback (often dead)

## Cron Jobs

Browser-based scheduler. Jobs only run while a tab is open.

| Job ID | Label | Schedule | What It Does |
|--------|-------|----------|-------------|
| `sync-stock-data` | Stock quotes → Supabase | `0 6 * * 1-5` | Fetch top 20 stocks, push to Supabase |
| `sync-politician-trades` | Politician trades → Supabase | `0 7 * * 1-5` | CapitolExposed + CongressInvests, merge/dedup |
| `sync-featured-trades` | Featured trades → Supabase | `0 8 * * *` | Trump (UW) + Pelosi (StockSpill+UW) |
| `archive-sqlite` | Local SQLite archive | `30 8 * * *` | Flush pending writes to .db file |
| `pull-stock-data` | Stock data ← Supabase | `0 9 * * 1-5` | Pull cloud data into local SQLite |

### Server-Side Sync (Optional)

Edge Functions run via `pg_cron` even when no browser is open:
- `supabase/functions/sync-stock-data` — Yahoo v8 for top 20 symbols
- `supabase/functions/sync-politician-trades` — disclosure APIs → Supabase KV

Deploy: `scripts/deploy-edge-functions.ps1`
Schedule: Fill placeholders in `supabase/schedules.sql`, run in SQL Editor

## Signal Engine

8 independent strategies evaluated per stock (requires 50+ bars):

| Strategy | Buy Signal | Sell Signal |
|----------|-----------|-------------|
| MA Crossover | Golden cross (SMA20 > SMA50) | Death cross |
| RSI | < 30 (strong < 20) | > 70 (strong > 80) |
| MACD | Histogram turns positive | Histogram turns negative |
| Bollinger | Squeeze + band breakout | Upper band rejection |
| Volume | > 2.5x 20-day average | Declining on rally |
| Candle Patterns | Engulfing, hammer | Shooting star, weak close |
| S/R Break | Within 0.5% of 50-day high | Within 0.5% of 50-day low |
| Multi-TF RSI | RSI(7/14/21) all < 30 | RSI(7/14/21) all > 70 |

**Confluence**: How many strategies agree on the same direction. This is the key metric.

## Trading Masters

12 legendary investors analyze any stock. Each uses their own methodology:

| Master | Method | Key Criterion |
|--------|--------|--------------|
| Buffett/Graham | Value | > 20% below 52-week high |
| Lynch | GARP | PEG proxy < 1 |
| Greenblatt | Magic Formula | ROC + Earnings Yield rank |
| Livermore | Trend | Uptrend + not parabolic |
| Munger | Inversion | Uptrend + > 10% off high |
| Marks | Cycles | Contrarian buy during fear |
| Templeton | Pessimism | > 30% below 52-week high |
| Minervini | SEPA/VCP | Uptrend + RS > 20 |
| O'Neil | CAN SLIM | Uptrend + RS > 15 + volume |
| Weinstein | Stage 2 | Above SMA50 + SMA200 |
| Darvas | Box Theory | Consolidating in box + uptrend |
| Wyckoff | Accumulation | Volume confirms accumulation |

## Alert System

Rules defined in `alertTypes.ts`:
- **Market conditions**: Regime change, volatility spike, momentum shift, RSI extreme
- **Strategy signals**: MA crossover, RSI reversal, MACD crossover, Bollinger breakout
- **Price levels**: Above/below user-defined thresholds

## Project Structure

```
src/
  components/             React UI components
    ui/                   shadcn/ui primitives
    PoliticianTrades.tsx  Trump/Pelosi featured trades panel
    StockMetrics.tsx      Price/volume/valuation
    PriceChart.tsx        Candlestick chart + overlays
    ChartAnalyst.tsx      Analyst narrative + forecasts
    TechnicalIndicators.tsx  RSI + MACD
    SignalPanel.tsx       Signal aggregation
    ForecastSimulator.tsx Monte Carlo simulation
    OptionsWheel.tsx      Wheel strategy calculator
    TodayActionPlan.tsx   Daily trade plan
    SentimentMonitor.tsx  Greed/fear gauge
    LiquidityMonitor.tsx  Liquidity conditions
    SocialSentimentCheck.tsx  News/social sentiment
  hooks/
    useStockData.ts       Main data hook (selectedStock, historicalData, signals)
  lib/
    stockApi.ts           Yahoo Finance API + proxy layer
    stockData.ts          Types, indicators, signals, forecasting
    localDb.ts            In-browser SQLite (sql.js WASM)
    storage.ts            Unified write layer (Supabase → SQLite → localStorage)
    supabaseDb.ts         Supabase client + push/pull functions
    syncKeys.ts           Keys mirrored across storage layers
    localCron.ts          Browser-based cron scheduler
    sentimentMonitor.ts   Market greed/fear indicators
    liquidityMonitor.ts   Liquidity condition estimates
    sentimentAnalysis.ts  News/social keyword scoring
    strategyRecommendation.ts  Market regime detection
    alertTypes.ts         Alert type definitions
  pages/
    Index.tsx             Dashboard
    Screener.tsx          Batch stock screener
    Tactical.tsx          Tactical trade engine
    TradingMasters.tsx    12 masters analyze any stock
    Settings.tsx          Account, watchlist, DB, cloud sync
    Admin.tsx             Cron job management
index.js                  Express server (serves dist/ + API endpoints)
scripts/
  deploy-edge-functions.ps1  Deploy Supabase Edge Functions
supabase/
  functions/              Edge Function source code
  schedules.sql           pg_cron schedule SQL (fill placeholders)
```

## Key Design Decisions

1. **Cloud-first storage**: Supabase is primary; SQLite is backup; localStorage is cache. On boot, local data is hydrated FROM Supabase.
2. **No AI/ML**: All analysis is algorithmic (rule-based scoring, template narratives). No external AI APIs.
3. **Simulated data labeled**: Put/call ratio, sentiment indicators, liquidity conditions are clearly marked as estimates.
4. **Server-side proxy**: Express handles CORS + SSRF protection for external API calls.
5. **Progressive disclosure**: Simple view (action plan) hides complexity; detailed views available but not overwhelming.
6. **Offline-capable**: Once cached, works without internet. Export/import moves data between devices.

## License

MIT
