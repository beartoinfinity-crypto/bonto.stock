# StockPulse

A fully client-side stock analysis dashboard. All analytics run in the browser — no backend server, no Supabase, no AI APIs. Data comes from Yahoo Finance via CORS proxies; everything else (signals, forecasts, sentiment, technical analysis) is computed locally from OHLCV history stored in an in-browser SQLite database.

> **Education only. Not financial advice. Past performance does not guarantee future results.**

## Tech Stack

- **Vite** + **TypeScript** + **React 18**
- **shadcn/ui** (Radix primitives) + **Tailwind CSS**
- **Recharts** for charts
- **TanStack React Query** for data fetching/caching
- **sql.js** (WASM) for in-browser SQLite persistence
- **cronstrue** for cron schedule display

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:8080)
npm run dev

# Build for production
npm run build

# Run tests
npm run test

# Run production build locally
npm start
```

---

## Pages

### Dashboard (`/`)
The main page with a two-column layout. Left column shows price data and charts; right column shows signals, sentiment, and action plans.

### Screener (`/screener`)
Batch-screens all popular stocks through the signal engine. Shows a ranked table sorted by confidence score with sector heatmap, politician trades, and an asymmetric-value screener.

### Tactical Engine (`/tactical`)
Per-stock trade planning tool. Runs the engine to detect market state (STRONG_UPTREND, SIDEWAYS_TIGHT, etc.), assigns a "weapon" (strategy playbook), and calculates position size, stop loss, take profit, and an iceberg order plan.

### Trading Masters (`/masters`)
Ask 12 legendary investors to analyze any stock. Enter a symbol and get BUY/HOLD/SELL verdicts from each master with confidence scores, strengths, risks, and specific advice. Animated progress bar while analyzing.

### Settings (`/settings`)
Account management (local auth with SHA-256 hashed passwords), watchlist, SQLite database stats, export/import (`.db` file), CSV import, and cache management.

### Admin (`/admin`)
Password-protected ops console for the local cron scheduler. View/toggle cron jobs, run jobs on demand, and see run history with durations.

---

## Dashboard Panels (Left Column)

### StockMetrics
Displays current price, change, volume, market cap, P/E ratio, and 52-week range. Also shows a **Benjamin Graham intrinsic value estimate** using the formula `IV = EPS x (8.5 + 2g)` with two variants: conservative (g=0, `IV = EPS x 8.5`) and growth-adjusted (g=7.5%, `IV = EPS x 23.5`).

### PriceChart
Interactive candlestick chart with time-range presets (1M/3M/6M/1Y/5Y/10Y). Each range maps to a bar count (1M=21d, 1Y=252d, etc.). Toggleable overlays: SMA20/SMA50 moving averages and Bollinger Bands (20-period, 2 standard deviations). Separate volume pane. Refresh button clears the SQLite cache for that symbol before refetching.

### ChartAnalyst
Produces an "AI analyst"-style narrative of the chart plus short/mid/long-term forecasts. Builds a rule-based scoring system that evaluates:
- Trend direction and strength
- SMA20/50/200 positioning
- RSI zone
- MACD state
- Bollinger Band position and percentile
- Support/resistance levels
- Volume trend

Outputs an outlook (bullish/bearish/neutral) with confidence, plus three forecast cards (short/mid/long-term) each with direction, confidence, key levels, and insight. No ML or external AI — purely algorithmic.

### TechnicalIndicators
Dedicated RSI and MACD sub-charts using the last 126 bars (~6 months). RSI shows 70/30 overbought/oversold reference lines. MACD displays the MACD line, signal line, and histogram. Status badges indicate overbought/oversold conditions.

### MultiTimeframeRSI
Confluence signal across three RSI lookbacks (RSI-7, RSI-14, RSI-21). All three below 30 = **strong buy**; all three above 70 = **strong sell**. Intermediate readings produce moderate buy/sell/neutral signals. Demonstrates how timeframe alignment reduces false positives from a single RSI period.

### ForecastSimulator
Interactive price-forecast and Monte Carlo simulation workbench:
- **Single path**: Random walk on log returns of the last 252 days. Drift incorporates trend strength (EMA20 vs EMA50). Weekends are skipped. Confidence decays over time (95% -> 50% floor). Shows 1.96-sigma prediction bands.
- **Monte Carlo**: Generates N paths (10/50/100/200) using Geometric Brownian Motion with Box-Muller normal draws. Uses a deterministic seeded RNG to prevent re-render flicker. Shows percentile bands (p10/p25/p50/p75/p90).
- **Backtest mode**: A slider hides the last N bars so you can compare predictions against actuals. Requires at least 100 training bars.

### OptionsWheel
Calculator for the covered-call / cash-secured-put "wheel" options strategy. Contains a self-contained Black-Scholes implementation:
- `normCdf` using Abramowitz & Stegun approximation
- `bsPrice` for premium calculation
- `bsDelta` for hedge ratio and probability estimates

Tabbed UI with interactive strike and premium sliders. No external pricing library.

---

## Dashboard Panels (Right Column)

### Today's Action Plan
Generates a single actionable daily trade plan by fusing:
- Indicator readings (RSI, MACD, Bollinger, volume)
- Strategy recommendations from `getStrategyRecommendations`
- Monte Carlo p50 projected price

Outputs an `ActionAdvice` with: action (BUY/SELL/HOLD), weighted confidence factors (each factor scored 0-100 x weight, so users see *why* the plan scores what it does), entry price, stop loss, target price, support/resistance levels, reasoning list, risk/reward ratio, and projected price/return.

### Social Sentiment Cross-Check
Fetches news/social sentiment from 6 sources via CORS proxies. Each source's headlines are scored locally using keyword matching (bullish/bearish word sets). Shows per-source results with a Gemini-style analyst narrative summarizing the overall sentiment. 5-second timeout per source; degrades gracefully if sources are unavailable.

### Sentiment Monitor
Market-wide greed/fear gauge. Synthesizes pseudo-indicators from price-derived market conditions:
- **NAAIM Exposure Index**: Approximated from regime normalization and trend strength (0-200 scale; warning if >80 and median >=95)
- **Institutional Equity Allocation**: Based on price vs SMA and regime score (warning if >63%)
- **Retail Net Buying Percentile**: Derived from similar price behavior signals

Each indicator has a `hint` explaining what it measures. Outputs a rating (extreme_greed/greed/neutral/fear), greed score (0-100), and a Signal Synthesis card combining all readings. Explicitly labeled as simulated, not live fund-flow data.

### Liquidity Monitor
Estimates system liquidity conditions from price behavior:
- **Net Liquidity Simulation**: Fed assets (~7.5T baseline), TGA (Treasury General Account), ON-RRP (overnight reverse repo) estimated from volatility percentile and regime
- **Week-over-Week Change**: Comparing 5-day vs prior 5-day average closes

Each indicator shows severity (normal/warning/critical). Outputs a rating (abundant/normal/tightening/critical), liquidity score (0-100), and actionable advice. Rebranded as "Liquidity Proxy" with disclaimer about synthetic data.

### Trading Signals (SignalPanel)
Aggregates signals from the 8-strategy signal engine into a confluence display:
- Shows BUY/HOLD/SELL signal counts
- Calculates **confluence**: how many distinct strategies agree on the same direction
- Highlights the **Best Setup** (highest confidence signal)
- Sorted by confidence; each signal shows strategy name, strength, and reasoning

### Put/Call Ratio
Simulated put/call ratio gauge (no real options data). Compares the last 20 bars vs the prior 20 bars, blending price change, average volatility (high-low/close), and volume around a base ratio of 0.85 (typical range 0.7-1.3). Shows sentiment read (bullish/bearish/neutral) and trend direction. Clearly labeled as an estimate.

---

## Trading Masters

12 legendary investors/traders analyze any stock using their unique methodologies. Each master gets shared metrics computed from price history (SMA20/50/200, relative volume, 52-week range, relative strength, parabola detection, Darvas consolidation) and applies their specific criteria:

| # | Master | Method | Verdict Logic |
|---|--------|--------|---------------|
| 1 | **Buffett / Graham** | Value + Margin of Safety | BUY if >20% below 52-week high |
| 2 | **Peter Lynch** | GARP / PEG | BUY if PEG proxy < 1 |
| 3 | **Greenblatt** | Magic Formula | BUY if combined ROC + Earnings Yield rank < 100 |
| 4 | **Livermore** | Trend Following | BUY if uptrend, not parabolic, relVol > 0.8; stop at SMA50 |
| 5 | **Munger** | Mental Models | Inversion test: uptrend, not parabolic, >10% off high |
| 6 | **Marks** | Risk Cycles | Contrarian BUY during fear/downtrend |
| 7 | **Templeton** | Max Pessimism | BUY if >30% below 52-week high |
| 8 | **Minervini** | SEPA / VCP | BUY if uptrend, RS > 20, not parabolic, price > SMA50 |
| 9 | **O'Neil** | CAN SLIM | BUY if uptrend, RS > 15, relVol > 1.2, not parabolic |
| 10 | **Weinstein** | Stage Analysis | BUY only Stage 2 (above SMA50 + SMA200); AVOID Stage 4 |
| 11 | **Darvas** | Box Theory | BUY if consolidating in a box + uptrend + volume |
| 12 | **Wyckoff** | Accumulation | BUY if volume confirms accumulation phase |

---

## Signal Engine (`generateSignals`)

Requires >= 50 bars of historical data. Evaluates the latest bar across 8 independent strategies:

| # | Strategy | Signal Logic |
|---|----------|-------------|
| 1 | **MA Crossover** | Golden/Death cross (SMA20 vs SMA50); alignment with SMA200 boosts confidence |
| 2 | **RSI** | <30 buy (strong <20); >70 sell (strong >80); momentum shift at 45/55 |
| 3 | **MACD** | Crossovers above/below zero line; histogram expansion/contraction |
| 4 | **Bollinger** | Squeeze detection (bandwidth <8% and shrinking); band breakouts |
| 5 | **Volume** | Volume ratio vs 20-day average; >2.5x = strong signal |
| 6 | **Candle Patterns** | Engulfing, hammer/shooting star (wick > 2x body), strong/weak close |
| 7 | **S/R Break** | 50-day high/low proximity; within 0.5% = strong breakout |
| 8 | **Multi-TF RSI** | RSI(7/14/21) alignment; all three oversold/overbought = strong signal |

Each signal has: type (buy/sell/hold), strength (strong/moderate/weak), confidence (0-100), entry level, stop loss, and take profit.

---

## Data Architecture

### Data Flow
```
Yahoo Finance -> proxyFetch (direct -> CORS proxies) -> localDb (SQLite TTL cache)
    -> hooks (useStockData, useScreenerData) -> pages/components
```

### Analytics Chain
```
Raw OHLCV -> analyzeMarketConditions (regime) -> sentiment/liquidity monitors
          -> generateSignals (8 strategies) -> SignalPanel confluence
          -> generateMonteCarloPaths -> ForecastSimulator + TodayActionPlan
```

### CORS Proxy Chain
Each API request tries up to 3 fetches per URL:
1. Direct fetch
2. `corsproxy.io` proxy
3. `api.allorigins.win/raw` proxy

Each with a 10-second AbortController timeout. Yahoo Finance also fetches a crumb token (cached 30 minutes) for authenticated API access.

### Yahoo Finance APIs
- **v8 chart API**: Price quotes and historical data (works without auth)
- **v10 quoteSummary API**: Fundamental data (sector, market cap, etc.) with crumb token
- **v7 API**: Deprecated — returns `{"error":{"code":"Unauthorized"}}`

### In-Browser SQLite (`localDb.ts`)
Uses sql.js (WASM) for persistence with TTL-based caching:
- **Quotes**: 15-minute TTL
- **Historical data**: 90-day TTL
- **Config/Documents**: 24-hour TTL

Persistence hierarchy:
1. **File System Access API** (user picks a `.db` file; writes via `createWritable()`)
2. **IndexedDB** fallback (`stockpulse_sqlite` database)

### Dual-Write Storage (`storage.ts`)
Every settings write goes to both:
- **localStorage** (synchronous, instant reads)
- **SQLite** (async, fire-and-forget)

On first load, existing localStorage data is migrated into SQLite.

---

## Local Cron Scheduler (`localCron.ts`)

Browser-based cron scheduler supporting 5-field cron expressions (lists, ranges, steps). Jobs:

| Job | Target | Schedule | Action |
|-----|--------|----------|--------|
| Stock quotes → Supabase | Cloud (primary) | 6:00 UTC Mon–Fri | Fetch quotes + historical, push to `stock_quotes`/`stock_historical` |
| Politician trades → Supabase | Cloud (primary) | 7:00 UTC Mon–Fri | Fetch CapitolExposed + CongressInvests, merge/dedup, push to KV |
| Local SQLite archive | Local backup | 8:30 UTC daily | Flush pending writes into `.db` archive, report stats |

Run results are capped at 200 entries and stored in SQLite as a document. Browser jobs only run while a tab is open.

## Server-Side Sync (Supabase Edge Functions)

Optional server-side equivalents that run **even when no browser is open** (via `pg_cron`):

- `supabase/functions/sync-stock-data` — Yahoo v8 chart fetch for top 20 symbols → upserts into `stock_quotes` + `stock_historical`
- `supabase/functions/sync-politician-trades` — both disclosure APIs → dedup/merge with existing cloud copy → writes back to `stockpulse_kv`

Setup:
1. Deploy: run `scripts/deploy-edge-functions.ps1` (requires [Supabase CLI](https://supabase.com/docs/guides/functions); sets a `CRON_SECRET`, deploys both functions)
2. Schedule: fill placeholders in `supabase/schedules.sql`, run in Dashboard → SQL Editor
3. The browser picks up server-synced data automatically: settings/docs via boot hydration, stock bars via Settings → Pull now

---

## Alert System

Alert rules defined in `alertTypes.ts`:
- **Market conditions**: Regime change, volatility spike, momentum shift, RSI extreme
- **Strategy signals**: MA crossover, RSI reversal, MACD crossover, Bollinger breakout, combined signal
- **Price levels**: Above/below user-defined thresholds

Alerts are checked on every data update and stored per-session. Browser notification support available.

---

## Screener

Batch-screens all stocks in `popularStocks` through the signal engine. For each stock:
1. Fetch quote + historical data
2. Run `generateSignals` to get confidence scores
3. Rank by aggregate confidence

Features:
- Client-side sorting (confidence, name, sector, price, change)
- Filter by signal type, risk level, sector
- Sector heatmap visualization
- Incremental refresh with progress indicator
- Cache-aware (shows whether data is from cache or fresh API)

---

## Trading Masters Page

Input any stock symbol and get analysis from 12 legendary investors:
- Animated progress bar while analyzing (prevents rapid clicks)
- Summary cards showing BUY/HOLD/SELL counts
- Sortable by confidence or verdict
- Each master card shows: philosophy, 3 key metrics, strengths, risks, and specific advice
- Parabola detection flags dangerous entries (Minervini: "parabolas are exits, not entries")

---

## Settings & Persistence

### Local Authentication
Signup/login with SHA-256 password hashing via `crypto.subtle.digest`. Users stored under `stockpulse_users`; session under `stockpulse_auth`. No server — everything in localStorage/SQLite.

### Database Management
- View SQLite stats (quotes cached, historical rows, storage backend)
- **Export**: Download `.db` file readable by any SQLite tool
- **Import**: Load `.db`/`.sqlite`/`.sqlite3` files
- **CSV Import**: Auto-detects file type from header (quotes vs historical)
- **File System Access**: Pick a `.db` file for persistent on-disk storage
- **Clear Cache**: One-button wipe of cached stock data

### Watchlist
Add/remove stocks; persisted via storage layer. Enriched with live price data from `popularStocks`.

---

## Key Design Decisions

1. **No backend**: All computation runs in the browser. Yahoo Finance via CORS proxies is the only external dependency.
2. **SQLite in the browser**: sql.js WASM provides real SQL persistence without a server. IndexedDB as fallback.
3. **Offline-capable**: Once data is cached, the app works without internet. Export/import lets you move data between devices.
4. **Simulated data labeled**: Put/call ratio, sentiment indicators, and liquidity conditions are clearly marked as estimates/simulations, not live data.
5. **Rule-based, not ML**: All analysis (ChartAnalyst, signals, forecasts) is algorithmic. No external AI APIs. The "analyst narrative" is template-based scoring.
6. **8 independent signal strategies**: Each strategy runs independently; confluence (how many agree) is the key metric, not any single signal.
7. **Progressive disclosure**: Simple view (action plan) hides complexity; detailed views (indicators, forecasts, masters) are available but not overwhelming.

---

## Project Structure

```
src/
  components/         # React UI components
    ui/               # shadcn/ui primitives (Button, Card, Input, etc.)
    Header.tsx        # Top nav with links to all pages
    StockSearch.tsx   # Symbol search with recents
    StockMetrics.tsx  # Price/volume/valuation display
    PriceChart.tsx    # Candlestick chart with overlays
    ChartAnalyst.tsx  # Analyst narrative + forecasts
    TechnicalIndicators.tsx  # RSI + MACD sub-charts
    MultiTimeframeRSI.tsx    # RSI(7/14/21) confluence
    SignalPanel.tsx   # Signal aggregation + confluence
    ForecastSimulator.tsx    # Monte Carlo simulation
    OptionsWheel.tsx  # Wheel strategy calculator (Black-Scholes)
    PutCallRatio.tsx  # Simulated P/C ratio gauge
    TodayActionPlan.tsx      # Daily trade plan
    SentimentMonitor.tsx     # Greed/fear gauge
    LiquidityMonitor.tsx     # Liquidity conditions gauge
    SocialSentimentCheck.tsx # News/social sentiment
    AlertPanel.tsx    # Alert notifications
  hooks/
    useStockData.ts   # Main data fetching hook
    useAlerts.ts      # Alert management
  lib/
    stockApi.ts       # Yahoo Finance API + CORS proxy layer
    stockData.ts      # Types, indicators, signal engine, forecasting
    localDb.ts        # In-browser SQLite (sql.js WASM)
    storage.ts        # Dual-write localStorage + SQLite
    localCron.ts      # Browser-based cron scheduler
    sentimentMonitor.ts     # Market greed/fear indicators
    liquidityMonitor.ts     # Liquidity condition estimates
    sentimentAnalysis.ts    # News/social keyword scoring
    strategyRecommendation.ts  # Market regime detection
    alertTypes.ts     # Alert type definitions
    i18n.tsx          # English + Traditional Chinese translations
  pages/
    Index.tsx         # Dashboard (main page)
    Screener.tsx      # Batch stock screener
    Tactical.tsx      # Tactical trade engine
    TradingMasters.tsx # 12 masters analyze any stock
    Settings.tsx      # Account, watchlist, DB management
    Admin.tsx         # Cron job management
trading-masters-main/ # Python reference implementations
  skills/             # SKILL.md + Python scripts per master
  scripts/            # Master screen + Minervini scanner
```

## License

MIT
