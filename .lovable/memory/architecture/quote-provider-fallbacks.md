---
name: Quote & history provider fallbacks
description: Multi-provider fallback chain in stock-data edge function for quotes and historical candles
type: feature
---
The `stock-data` edge function uses ordered provider chains and reports the winner via headers.

Quotes (`action=quote`), header `X-Quote-Source`:
1. Finnhub (if `FINNHUB_API_KEY`)
2. Twelve Data (if `TWELVE_DATA_API_KEY`)
3. Yahoo Finance chart API (keyless, query1/query2 hosts)
4. Stooq CSV quote (keyless)

History (`action=candles`), header `X-Data-Source`:
1. `stock_price_history` table (DB-first)
2. Twelve Data time_series (2500 points)
3. Yahoo Finance chart `range=10y&interval=1d`
4. Stooq daily CSV (`/q/d/l/?s=<sym>.us&i=d`)

Each provider has its own timeout (8-12s) and failures are logged and skipped, never fatal. If all fail, returns `[]` with `X-Data-Fallback: true`.
