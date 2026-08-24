# StockPulse Domain Model

## Language

**Stock quote**: A snapshot of a stock's price, volume, and fundamentals at a point in time. Stored as JSON in the `stock_quotes` Supabase table keyed by symbol.

**Historical bar**: A single OHLCV (open/high/low/close/volume) candle for one trading day. Stored in `stock_historical` keyed by `(symbol, date)`.

**Signal**: The output of one strategy evaluating one stock. Has a direction (BUY/SELL/HOLD), strength (strong/moderate/weak), and confidence (0-100).

**Confluence**: How many distinct signal strategies agree on the same direction for a stock. The primary metric for ranking stocks in the screener.

**Regime**: The current market state classification (STRONG_UPTREND, SIDEWAYS_TIGHT, CORRECTION, etc.). Determined by `analyzeMarketConditions()`.

**Featured trade**: A trade by a prominent politician (Trump, Pelosi) fetched from external sources and stored in the `politician_featured_trades` Supabase table.

**Cron job**: A scheduled task that runs in the browser while a tab is open. Jobs fetch data from external APIs and push results to Supabase (primary store).

**Server proxy**: The Express endpoint `/api/proxy?url=<encoded>` that fetches external URLs server-side, bypassing CORS restrictions. Has SSRF protection (blocks localhost, private IPs).

**Crumb token**: A Yahoo Finance authentication token fetched once and cached for 30 minutes. Required for the v10 quoteSummary API but not for the v8 chart API.

## Storage Layers

1. **Supabase** (primary): Source of truth. Written first (debounced 3s). Hydrated on boot via `pullAll()`.
2. **SQLite** (backup): Offline archive. Written second (fire-and-forget). Persisted via File System API or IndexedDB.
3. **localStorage** (cache): Sync read cache. Instant reads. Always written on every `setItem()`.

## Data Sources

- **Yahoo Finance**: v8 chart (OHLCV), v10 quoteSummary (fundamentals with crumb)
- **CapitolExposed**: Recent congressional trades (House/Senate, paginated API)
- **CongressInvests**: Full congressional trade history back to 2015
- **UnusualWhales**: Trump OGE Form 278T filings (HTML scraping of `__NEXT_DATA__`)
- **StockSpill**: Congress trades stored in a separate Supabase project (`artscweyrracfffoqvur`)
