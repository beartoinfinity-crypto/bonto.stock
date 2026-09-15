# Deploy Guide

## Repository

- **GitHub**: https://github.com/beartoinfinity-crypto/bonto.stock
- **Live**: https://dandanball-stock.vercel.app/

Vercel is the only deployment. (The old `dandanball-stock.onrender.com` host slept on the free tier and was retired — `bonto-stock.vercel.app` is an abandoned first deploy that 404s — ignore both.)

## How Deploy Works

Push to `main` → Vercel auto-deploys → the Express serverless function (`index.js`) serves `/api/*` and `dist/`.

The `dist/` folder is committed to git (Vercel runs `npm install && npm start`, not `npm run build`).

## Deploy Steps

```bash
npm run build              # rebuild dist/
git add -A
git commit -m "feat: ..."
git push                   # triggers Vercel auto-deploy
```

## Local Testing (Production Build)

```bash
npm run build
npm start                  # Express on http://localhost:10000
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10000` | Server port (the local Express server; Vercel ignores it) |
| `SUPABASE_URL` | *(none)* | **Server-managed Cloud Sync** — when set, every browser/machine picks this up automatically (no per-browser input); served via `GET /api/sync-config` |
| `SUPABASE_ANON_KEY` | *(none)* | Anon key for the Supabase project above |
| `SUPABASE_SYNC_ENABLED` | `true` | Set to `false` to disable server-managed sync even when the URL/key are set |
| `FINNHUB_API_KEY` | *(none)* | Optional: server-side Finnhub key for the quote/sentiment proxies (rotates with any browser-supplied keys) |
| `FINNHUB_API_KEY_2` | *(none)* | Optional: second Finnhub key — proxy rotates between them on rate-limits |
| `ADANOS_API_KEY` | *(none)* | Optional: Adanos sentiment API key, served to every browser via `GET /api/api-keys` (enables the Adanos source in Social Sentiment Check). Falls back to per-browser Settings → API Keys → Adanos when unset |
| `CRON_SECRET` | *(none)* | **Required for the `/api/ledger/*` proxy** — must match the Supabase `CRON_SECRET` secret (`0mv...f1gap`), and must be set as a hosting env var on Vercel. Without it `/api/ledger/status` and `/api/ledger/rerun` return 502 (the fn 401s since the proxy can't sign its calls) |

## Cache headers on dist

`index.js` sets `Cache-Control: no-store` on the SPA shell (`index.html`) so browsers always fetch the current bundle, and `immutable` (1 year) on `/assets/*` (content-hashed). After a deploy, a hard refresh is generally unnecessary once the shell cache expires.

## Supabase Setup

Project: `aqyaarnpmvvdzasjefje` (linked — `supabase/.temp/linked-project.json`, `supabase/config.toml`).

### First Time

1. Create a Supabase project
2. Go to SQL Editor
3. Run the setup SQL from Settings page (or from `supabaseDb.ts` `SETUP_SQL` constant)
4. **Either** set `SUPABASE_URL` + `SUPABASE_ANON_KEY` on Vercel (server-managed — recommended, configure once for all browsers)
5. **Or** (single-machine / dev only) enter the URL and anon key per browser in Settings and enable Cloud Sync

### Featured Trades Table

The `politician_featured_trades` table is created by the same setup SQL. It stores Trump/Pelosi trades for instant display.

## Server-Side Cron (pg_cron + Edge Functions) — Primary Data Pipeline

All data-production jobs run **server-side on Supabase**, 24/7, no browser needed. Definitions live in `supabase/functions/`, schedules in `supabase/schedules.sql`.

| Function | Schedule (UTC) | What it does | Writes to |
|----------|----------------|--------------|-----------|
| `sync-stock-data?batch=1` | `0 22 * * 1-5` | Yahoo quotes + 10y bars, index-universe batch 1/3 (~27 symbols) | `stock_quotes`, `stock_historical` |
| `sync-stock-data?batch=2` | `0 23 * * 1-5` | Batch 2/3 (~27 symbols) | `stock_quotes`, `stock_historical` |
| `sync-stock-data?batch=3` | `0 0 * * 2-6` | Batch 3/3 (~26 symbols) | `stock_quotes`, `stock_historical` |
| `sync-politician-trades` | `0 7 * * 1-5` | CapitolExposed + CongressInvests congressional trades | `stockpulse_kv` (`stockpulse_politician_trades`) |
| `sync-featured-trades` | `30 7 * * *` | Trump (OpenCabinet + UnusualWhales) + Pelosi (StockSpill + UnusualWhales) | `politician_featured_trades` |
| `simulate-ledger` | `0 12 * * 1-5` | Simulated-traders day, ONCE per day (write-protected; heals legacy conflicts) | `stockpulse_kv` (`stockpulse_trade_ledger`) |

**Stock-data universe** = the app's index universe (S&P 500 ∪ NASDAQ-100 curated constituents, 80 symbols — mirrors `src/lib/masterAnalysis.ts` `INDEX_UNIVERSE_TICKERS`). The 3 batches are staggered across the 3 hours after the US close (22:00/23:00/00:00 UTC) to stay under Yahoo rate limits; each batch paces its fetches ~1.2s apart. By pre-open US time (12:00 UTC sim), all 80 symbols carry the latest close.

### Schedule in local time zones

| Job | UTC | Hong Kong (HKT, UTC+8) | US Eastern (ET) |
|-----|-----|------------------------|------------------|
| Stock batch 1 | 22:00 Mon–Fri | 06:00 Tue–Sat | 5/6 PM Mon–Fri (post-close) |
| Stock batch 2 | 23:00 Mon–Fri | 07:00 Tue–Sat | 6/7 PM Mon–Fri |
| Stock batch 3 | 00:00 Tue–Sat | 08:00 Tue–Sat | 7/8 PM Mon–Fri |
| Politician trades | 07:00 Mon–Fri | 15:00 Mon–Fri | 2/3 AM Mon–Fri |
| Featured trades | 07:30 daily | 15:30 daily | 2:30/3:30 AM daily |
| Simulate ledger | 12:00 Mon–Fri | 20:00 Mon–Fri | 7/8 AM Mon–Fri (pre-open) |

ET entries alternate because US close/move between EST (UTC-5) and EDT (UTC-4); HKT has no DST. Batch runtime is ~1-2 min each (first sync of a new symbol backfills 10y of bars and can take ~2 min); **all stock batches finish by ~8:02 AM HKT** — well before a 9 AM HK deadline. Batch 3 runs Tue–Sat because its weekday close lands on the next calendar day.

`simulate-ledger` mirrors the browser's `tradeSimulator` semantics (persona thresholds, 10%-equity buys, -8%/+30% stops) with a Deno port of the tactical engine. Universe input: the cloud `stockpulse_master_matrix` snapshot (browsers still produce it when the Master Matrix page runs — if nobody visits that page, the sim trades the latest snapshot with fresh prices). It simulates the **last completed session** at its **official close** (every fill carries its own session date + a price within that day's high–low), not "today" — so a Friday's session appears on Monday's run. It is the **only writer** of the ledger row; browsers pull it and never push/merge (see CODEBASE.md). `GET`/`{"status":true}` answers a read-only status probe; `{"rerun":true}` clears the latest session and re-simulates atomically.

### Deploying Edge Functions

```powershell
# from the REPO ROOT (the CLI reads supabase/config.toml relative to cwd)
npx.cmd supabase functions deploy sync-stock-data --no-verify-jwt
npx.cmd supabase functions deploy sync-politician-trades --no-verify-jwt
npx.cmd supabase functions deploy sync-featured-trades --no-verify-jwt
npx.cmd supabase functions deploy simulate-ledger --no-verify-jwt
```

If the CLI says "Cannot find project ref": `npx.cmd supabase link --project-ref aqyaarnpmvvdzasjefje` first.

### Authentication: `CRON_SECRET`

Every function checks the `x-cron-secret` header against the `CRON_SECRET` env secret (`npx.cmd supabase secrets set CRON_SECRET=...`). Functions are deployed with `--no-verify-jwt`, so this secret is the only auth — keep it out of the repo. It is **write-only** (`supabase secrets list` shows a masked digest, not the value), so store the real value in a password manager. If lost, set a fresh one and update all schedules.

### Scheduling (Supabase SQL Editor)

Run `supabase/schedules.sql` (pg_cron + pg_net extensions required — enable via Dashboard → Database → Extensions). Verify:

```sql
select jobname, schedule, active from cron.job;   -- expect 6 active jobs
```

Manual fire (returns a request id; note it):

```sql
select net.http_post(url := 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1/<fn>',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'));
```

Check the response (~30s later; note `sync-stock-data` takes ~1 min):

```sql
select id, status_code, content from net._http_response where id = <id>;
```

**Important:** pg_net waits only **5 seconds** for a response. `sync-stock-data` (~60s) will show `status_code null` + `error_msg "Timeout of 5000 ms"` in `_http_response` — **the function still runs to completion**; only the recorded response is lost. Verify by data freshness instead:

```sql
select symbol, updated_at from stock_quotes order by updated_at desc limit 3;          -- 06:00 job
select updated_at from stockpulse_kv where key = 'stockpulse_politician_trades';        -- 07:00 job
select count(*), max(updated_at) from politician_featured_trades;                       -- 07:30 job
select updated_at, value::jsonb ->> 'lastRunDate' from stockpulse_kv
  where key = 'stockpulse_trade_ledger';                                                -- 12:00 job
```

### Browser Cron (local only)

Settings → Scheduler keeps exactly two local-machine jobs (see `src/lib/localCron.ts`):

| Job | Schedule | Action |
|-----|----------|--------|
| `archive-sqlite` | Daily 08:30 UTC | Flush pending writes into the local SQLite backup |
| `pull-stock-data` | Weekdays 09:00 UTC | Pull quotes/bars from Supabase into the local SQLite mirror |

The four data jobs above were migrated off the browser — do **not** re-add them there (duplicate runs against the same cloud rows).

### Ledger Notes

- The server sim is **write-protected**: one run per session. `{"ok":true,"simulated":false,"reason":"already simulated <date>"}` is the success response for a re-fire.
- The `/ledger` page is a **cloud viewer**: it auto-pulls the server-written ledger on load (no manual "Run today" — running is the server's job) and exposes:
  - **Re-run session** → `POST /api/ledger/rerun` — asks the fn to clear the latest simulated session and re-simulate it atomically.
  - **Status badge** → `GET /api/ledger/status` — green "session N: N fills / caught up" vs amber "session not simulated yet — waiting for the next run". Both need `CRON_SECRET` on the hosting env vars.
- Legacy local **Reset today** was removed from the page — the server owns the ledger; a full restart means deleting the `stockpulse_trade_ledger` KV row.
- Validation: run `node scripts/validate-ledger.cjs` after a simulated day to confirm every fill is inside its session's high–low and at the official close.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Blank page | Ensure `dist/` is committed and `index.js` serves it |
| 404 on refresh | Express catch-all should handle client-side routes |
| "All providers unavailable" | Check Vercel logs; server proxy may be failing |
| Stale data | Data now refreshes server-side on schedule; check the freshness queries above before assuming a browser problem |
| Chart ends on an old date (e.g. bars frozen weeks back) | The browser's SQLite historical cache self-heals since the bar-currency gate (`be5b2d9`): a series whose newest bar is >4 days old is a cache miss and refetches live, then falls back to Supabase `stock_historical` (nightly server sync) — hard-refresh the page once. If it *still* shows old bars, check the freshness queries above (server sync may have stopped) |
| Server proxy 502 | Vercel outbound requests may be blocked |
| Trump shows no records | Verify the UnusualWhales URL uses `Donald J Trump` (no period) |
| Edge fn 401 `unauthorized` | `x-cron-secret` doesn't match `CRON_SECRET` — reset the secret, update all schedules |
| Edge fn 401 `UNAUTHORIZED_NO_AUTH_HEADER` | Function deployed without `--no-verify-jwt` — redeploy it |
| `/api/ledger/status` or `/api/ledger/rerun` → 502 | The hosting env is missing `CRON_SECRET` — add it on Vercel (must equal the Supabase secret) and redeploy |
| `_http_response` shows 5s timeout | Cosmetic — function still completes; verify via data freshness queries |
| Ledger page "Cloud sync failed" | Server may be cold-starting; retry. Config arrives via `/api/sync-config` |
| Positions show snapshot prices for the whole session | Live re-marking retries every 60s + on tab focus; check the browser console for provider failures (Finnhub key limit). The cloud quote-board fallback covers most misses |
| Deploy from wrong folder fails | Run `npx.cmd supabase functions deploy ...` from the repo root, not `system32` |

For Express server architecture and API endpoints, see [`docs/CODEBASE.md`](docs/CODEBASE.md).
