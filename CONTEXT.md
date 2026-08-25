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

## Storage & Data Sources

See [`docs/CODEBASE.md`](docs/CODEBASE.md) for storage hierarchy (Supabase → SQLite → localStorage), Supabase table schemas, and all external data source details.
