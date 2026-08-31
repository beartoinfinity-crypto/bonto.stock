# StockPulse Domain Model

## Glossary

**Stock quote**: A snapshot of a stock's price, volume, and fundamentals at a point in time. Stored as JSON in the `stock_quotes` Supabase table keyed by symbol.

**Historical bar**: A single OHLCV (open/high/low/close/volume) candle for one trading day. Stored in `stock_historical` keyed by `(symbol, date)`.

**Signal**: The output of one strategy evaluating one stock. Has a direction (BUY/SELL/HOLD), strength (strong/moderate/weak), and confidence (0-100).

**Confluence**: How many distinct signal strategies agree on the same direction for a stock. The primary metric for ranking stocks in the screener.

**Regime**: The current market state classification (STRONG_UPTREND, SIDEWAYS_TIGHT, CORRECTION, etc.). Determined by `analyzeMarketConditions()`.

**Featured trade**: A trade by a prominent politician (Trump, Pelosi) fetched from external sources and stored in the `politician_featured_trades` Supabase table.

**Cron job**: A scheduled task that runs in the browser while a tab is open. Jobs fetch data from external APIs and push results to Supabase (primary store).

**Server proxy**: The Express endpoint `/api/proxy?url=<encoded>` that fetches external URLs server-side, bypassing CORS restrictions. Has SSRF protection (blocks localhost, private IPs).

**Crumb token**: A Yahoo Finance authentication token fetched once and cached for 30 minutes. Required for the v10 quoteSummary API but not for the v8 chart API.

**Master**: One of 12 rule-based investor strategies (Buffett, Munger, Fisher, etc.) evaluated against a stock's daily OHLCV bars. See `masterAnalysis.ts`.

**Verdict**: A master's judgement on a stock — one of `BUY`, `HOLD`, `WATCH`, `SELL`, or `AVOID`. Trading Masters tallies each type into summary boxes (BUY / HOLD / WATCH / SELL+AVOID); the Master Matrix ranks by BUY count out of 12.

**Universe**: Which stock set the Master Matrix ranks over — `sp500` (SP500_TICKERS), `nasdaq100` (NASDAQ100_TICKERS), or `all`. Plus user-typed custom symbols.

**Daily snapshot**: One day's 12-master verdict summary for a stock. Tagged `source: 'live' | 'supabase'` and accumulated per stock; past days are backfillable from stored bars. Stored in localStorage (key `stockpulse_master_matrix`), not cloud-synced.

**TradingAgents rating**: The final 5-tier decision produced by `runTradingAgents()` — `Buy`, `Overweight`, `Hold`, `Underweight`, or `Sell`. Derived entirely by rule from the multi-agent pipeline (analyst team → research manager → bull/bear debate → trader → risk committee → portfolio manager). No AI/ML.

## Storage & Data Sources

See [`docs/CODEBASE.md`](docs/CODEBASE.md) for storage hierarchy (Supabase → SQLite → localStorage), Supabase table schemas, and all external data source details.
