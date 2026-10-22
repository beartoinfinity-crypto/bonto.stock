# Handoff Document — Smart Money Screener & Scheduled Scan

> **Last updated:** 2026-10-22  
> **Commit:** `e9990f3` (pushed to `main`, Vercel auto-deployed)  
> **Test suite:** 353 tests / 27 files passing  
> **Typecheck:** no new errors (`tsc --noEmit` still reports ~30 pre-existing errors in unrelated files)

---

## 1. Project Overview

**Stock Scout** (aka StockPulse) — a React/TS single-page app for rule-based stock research signals. Deployed on Vercel at `https://dandanball-stock.vercel.app`. Backend: Supabase (Postgres + edge functions + pg_cron). No AI/ML — all signals are deterministic scoring from public data (SEC EDGAR, Yahoo Finance, congress trades, 13F filings).

**Repo:** `beartoinfinity-crypto/bonto.stock.git`  
**Supabase project:** `aqyaarnpmvvdzasjefje`  
**Local root:** `C:\Users\ben.chan\Documents\source_code\stock-scout-main`

---

## 2. What Shipped (Chronological)

### 2.1 Research Screens 1–6 (v1.0–v1.4)

| Screen | Route | Commit | Tag |
|--------|-------|--------|-----|
| Options Flow | `/flow` | `74f8084` | v1.0 |
| 13F Fund Holdings | `/funds` | `ad4c396` | v1.1 |
| Macro (FRED) | `/macro` | `c0cc664` | v1.2 |
| Dark Pool | `/darkpool` | `ab10106` | v1.3 |
| Unusual Whales (congress) | `/unusual-whales` | `5c36614` | v1.4 |
| Greeks/OI | `/greeks` | `5e31119` | v1.4 |

All screens include inline signal explanations (education-only English labels), `<Header />` + `<BackToTop />`.

### 2.2 Smart Money Screener — Option B (`f3aaa8a`)

Extended from curated-41-only to full S&P 500 + NASDAQ-100:

- **Universes:** Curated 41 / S&P 500 = 488 / NASDAQ-100 = 85 / union = 501
- **Scoring (100 pts):** Insider 25 / 13F Institutional 25 / Congress 20 / Squeeze 30
- **Data sources:** SEC Form 4 XML (paced EDGAR fetchers via `/api/edgar`), Yahoo batch quotes, congress trades (bulk monthly windows), 13F issuer-name matching, short interest (top-125 by score)
- **Browser scan:** 4-stage bucketed orchestration (~100 Form 4s/run for index modes), progress bar, soft-fail stages
- **Caching:** localStorage `stockpulse_sm_scan_<mode>` (24h TTL) + `stockpulse_sm_insider_v3` (30d, symbol-keyed, shared across modes)

### 2.3 Insider XSL Fix (`42a676a`)

EDGAR serves Form 4 wrapped in an HTML viewer with an XSL stylesheet prefix. Parser was reading the HTML viewer instead of raw XML. Fix: `edgarPrimaryDocPath` strips the xsl viewer prefix.

### 2.4 Empty-Cache Fix (`4d15bc2`)

Bumped insider cache key so pre-fix empty buys are not reused.

### 2.5 Daily Scheduled Scan — Edge Function (`481d316` + `aeabec5`)

**Architecture:** Supabase edge function `smart-money-scan` with 3 independent cron legs, each authenticated via `x-cron-secret` header, each with a `TIME_BUDGET_MS = 110_000` wall-clock guard.

| Leg | Schedule (UTC) | What it does | Verified runtime |
|-----|----------------|--------------|------------------|
| `quotes` | Daily 01:30 | Batch quotes (501 symbols) + top-125 short interest (score-ranked candidates) + congress bulk refresh | ~70s |
| `insider` | Daily 02:30 | SEC Form 4 bucket scan (85 symbols/run, incremental per-row upsert) | ~110s |
| `weekly` | Mon 03:30 | 13F × 10 managers (full recompute only if all 10 attempted) | ~12s |

**Key design decisions:**
- Congress moved to daily quotes leg (not weekly) — cheap bulk REST calls
- `insider_scanned_at` column tracks insider freshness independently (quotes leg rewrites `scanned_at` daily)
- Incremental per-row upsert means timeouts never lose progress
- Empty SEC ticker map → leg bails without marking anything done
- Squeeze candidates = `score > 0 || !squeeze_loaded` (coverage accrues progressively)

**Database:** Table `smart_money_scan_rows` with PK `(universe, symbol)`, RLS anon SELECT, columns for all signals + `insider_scanned_at`.

**Files:**
- `supabase/functions/smart-money-scan/index.ts` — edge function (3 legs)
- `supabase/functions/smart-money-scan/universe.ts` — generated membership (SP500=488, NDX=85)
- `supabase/migrations/20261012000000_smart_money_scan_rows.sql` — table + RLS
- `supabase/schedules.sql` — 3 pg_cron rows (9 total jobs active)
- `scripts/gen-deno-universe.cjs` — regenerates `universe.ts` from `src/lib/indexMembers.ts`
- `scripts/run-sql.cjs` — SQL runner via `run-sql` edge fn (CLI `db push` blocked by login bug)

### 2.6 Server Read-Path for sp500/ndx100 (`b4ead13`)

**Problem:** `sp500` (488) and `ndx100` (85) are strict subsets of the 501 union but had no server read-path → every page open triggered a full browser scan (~30–60s+).

**Fix:**
- `SERVER_SCANNED_MODES = {'index', 'sp500', 'ndx100'}` exported from `smartMoney.ts`
- `serverScanForMode(mode, dbRows)` projects `universe='index'` rows onto a mode's symbols
- Page effect fetches `smart_money_scan_rows?universe=eq.index&select=*` for all three index modes
- Curated stays local-only (GME + RIVN not in the 501 union)
- 5 new tests in `serverScanForMode` describe block (smartMoney.test.ts: 45 total)

### 2.7 Screener Discoverability (`48461c7`)

The 501-symbol union made the highest-scoring names hard to find; the table is now sortable and self-describing:

- **Default sort** is signal score ↓ (unchanged ranking, now visible in the header arrow and context line).
- **Sortable headers**: Score, Insider $, 13F mgrs, Congress B/S, Short %Float, Price, Δ% — first click sorts desc, second toggles asc; the sort dropdown exposes the same 8 keys.
- **Context line** above the table: `Showing 1–25 of N · sorted by <field> ↓` with an inline **Show all N**, so the active order and truncation are never ambiguous.
- **Top score card** shows `LEN · 70/100` and is clickable — filters the table to that symbol (click again clears) and scrolls results into view.
- **Rank-1 emphasis**: when sorted by score ↓, the first row gets a `TOP` badge and a subtle emerald tint.
- **Loading state**: the server pre-scan fetch shows a spinner line (`Loading 501 rows from the daily scan…`); a failed fetch now keeps the local cache instead of throwing an unhandled rejection.

Verified in headless Chrome on the 501 universe: score sort → LEN first (70, Strong, insider $595.29M); Insider $ desc → RSG ($1.12B); asc → Agilent (`—`).

### 2.8 Social Sentiment: Evidence-First Card (`48461c7`)

The home-page sentiment card previously read like a template (generic prose + percentages with no provenance). It now shows the evidence behind the score:

- **Real quotes with links**: every source returns actual headlines/posts (`items` with URL + timestamp), ranked by recency × keyword strength. The card lists the top items per source and "What people are saying" with source, relative time, tone chip, and an external link.
- **Crowd vs financial news**: `aggregateSources()` splits directional sources into `retail` (social) and `news` groups, so the card can show e.g. "Retail +3% vs financial news +16%" and call out divergence instead of hiding it in one blended number. Confidence reports `n/m sources agree`.
- **Attention is separate**: ApeWisdom, SocialTickers, Google Trends, and Adanos feed an attention line (e.g. "Reddit mentions 23, +28% vs 24h, rank #28") and never steer the directional call.
- **No template prose**: `extractTopics` was removed; the summary is short and data-grounded (tone, item count, live-source count, agreement, divergence/attention). "Stand-out item" was dropped because the quotes list sits directly below it.
- **Source hygiene**: headlines are filtered by `isRelevantToSymbol` (symbol or company name, company suffixes like Inc/Corp stripped) because Yahoo's news feed and CNBC's search return generic market stories. MarketWatch no longer falls back to unrelated headlines; SocialTickers was rewritten to mentions/upvotes after its API stopped returning `social_score` (it previously scored a constant −100%).
- **Tests**: `src/lib/sentimentAnalysis.test.ts` (13 tests) covers tone mapping, relevance filtering, group scores, divergence, agreement, quote ranking, and `aggregateSources` (attention volume cannot flip direction; attention-only input stays neutral).

### 2.9 Market Sentiment: Verdict-First Panel (`603d67c`)

`SentimentMonitor.tsx` (+ `sentimentMonitor.ts#ordinal`) went from a generic score block to the shared panel pattern: a verdict hero (label, `n of N indicators flagged`, score, segmented meter, one-line advice) over flagged-first rows with `FLAG` chips and 2-line reasons, then a single footnote. Card height 982 → 751 px.

### 2.10 Liquidity Proxy: Verdict-First Panel (`9831da6`)

Same pattern for `LiquidityMonitor.tsx`: hero verdict Abundant / Normal / Tightening / Critical with `0 of 4 flagged`, 0–100 score, 4-segment meter; rows sorted flagged-first (`FLAG` chip, `line-clamp-2` reason with tooltip), passing rows truncate; duplicated summary/advice blocks removed. Card height 904 → 622 px. Enumerated labels use `t()`; counts/legend stay English (LiquidityMonitor precedent).

### 2.11 Trading Signals: Verdict + De-duplicated Strategies (`e9990f3`)

`generateSignals` (`stockData.ts`) and `SignalPanel.tsx` fixed six defects:

- **One signal per strategy** — `emitted` set + `emit()` helper; previously RSI could push twice and inflate "n of N strategies".
- **SMA200 claim guarded** — the "20 > 50 > 200" wording only appears when `sma200` exists (<200 bars no longer prints a fake 200-SMA).
- **MACD threshold is relative** — `histPct = histogram / price` (% of price) with an expansion check, instead of an absolute `> 0.5` that was meaningless on high-priced names; holds below 0.02%.
- **Multi-timeframe RSI reasons agree with direction** — below-50 rising → buy / above-50 falling → sell, otherwise hold, instead of contradicting the action.
- **Bollinger squeeze holds** while bandwidth keeps narrowing (no premature direction call).
- **Panel stats are honest** — `net = (buy − sell) / totalConfidence` replaced the direction-blind "Strong Buy" verdict; `avgConfidence` and `strategiesAligned` consider directional signals only. Rows are sorted flagged-first, `signals.sort()` no longer mutates the prop (copies via `useMemo`).

Headless verification (5 buy / 2 sell, overbought RSI): old verdict `STRONG BUY` from 7 signals over 6 strategies; new verdict `HOLD`, `NET SCORE -16`, 7 signals over 7 strategies, meter 2 red segments left of centre, neutral successes labelled as passing rows. Build: `dist/assets/index-6rrgnVJN.js` (1,893.71 kB) + `index-CjT3JW9i.css` (83.74 kB).

---

## 3. Current Architecture

### 3.1 Page Load Flow (`/smart-money`)

```
User opens /smart-money
  → Default mode: 'curated' (not persisted)
  → loadScan(mode) reads localStorage cache (24h TTL)
  → If mode ∈ SERVER_SCANNED_MODES:
      → fetch smart_money_scan_rows?universe=eq.index&select=*
      → serverScanForMode(mode, rows) filters to mode's symbols
      → If serverRows.length > 0: use them (save to localStorage)
      → Else: fall back to local cache
  → If mode = 'curated': use local cache only
  → Render table
```

### 3.2 Manual Scan Flow

```
User clicks "Run screen"
  → 4-stage bucketed browser scan (Form 4 → 13F → congress → quotes/squeeze)
  → Progress bar updates
  → Results saved to localStorage (NOT to server)
  → Toast: "First run pulls SEC Form 4 filings"
```

### 3.3 Scheduled Scan Flow

```
pg_cron fires (e.g. daily 01:30 UTC)
  → POST /functions/v1/smart-money-scan?leg=quotes
  → x-cron-secret auth
  → TIME_BUDGET_MS guard (110s)
  → Fetch data from external APIs
  → Upsert rows into smart_money_scan_rows
  → Return JSON summary
```

---

## 4. Logic Reference

### 4.1 Scoring System (100 pts max)

| Signal | Max pts | Formula |
|--------|---------|---------|
| **Insider** | 25 | Cluster (≥3 distinct buyers AND ≥$500K total, each trade ≥$100K) → 25; else any qualifying buy → 15; else 0 |
| **13F Institutional** | 25 | ≥3 tracked managers → 25; 2 → 20; 1 → 15; 0 → 0 |
| **Congress** | 20 | Any BUY in 12 months → 20; sells only → 8; none → 0 |
| **Squeeze** | 30 | Short% of float ≥20% → 30; ≥10% → 20; ≥5% → 10; else 0 |

**Classification thresholds:** Strong ≥60 / Watch ≥40 / Light >0 / None = 0

**Key constants:**
- `INSIDER_MIN_TRADE = 100_000` — minimum dollar value for a qualifying insider trade
- `INSIDER_CLUSTER_MIN_BUYERS = 3` — distinct insiders needed for cluster score
- `INSIDER_CLUSTER_MIN_VALUE = 500_000` — total value needed for cluster score
- `SQUEEZE_TOP_N = 125` — max symbols per short-interest fetch run
- `BATCH_QUOTE_CHUNK = 50` — Yahoo batch-quote chunk size

**Cap tier derivation:** `capTierFromMarketCap(marketCap)` — mega/giga ≥$200B, large ≥$10B, mid ≥$2B, small ≥$300M, micro <$300M

### 4.2 Browser Scan Orchestration (Manual "Run screen")

4-stage bucketed pipeline for index modes (~100 Form 4s per run):

```
Stage 1: SEC Form 4 (insider)
  → Fetch ticker→CIK map from SEC
  → For each symbol in bucket: fetch recent Form 4 filings via /api/edgar
  → Parse XML, extract insider trades (owner, value, date, type)
  → Paced delays to respect SEC rate limits
  → Soft-fail: continue on individual symbol failure

Stage 2: 13F Institutional
  → For each tracked manager: fetch latest 13F-HR from EDGAR
  → Parse XML, extract holdings, match issuer names to tickers
  → Match via suffix-stripped name comparison (INC, CORP, etc.)

Stage 3: Congress
  → Bulk fetch politician_trades from Supabase REST
  → Filter to 12-month lookback
  → 1000-row cap-safe bisection for large datasets

Stage 4: Quotes + Squeeze
  → Batch quotes (50 symbols/chunk, 150ms delay between chunks)
  → Short interest for top-100 symbols by cached score (300ms pace)
  → Derive cap tier from marketCap
```

**Caching:** Only insider results are cached per-symbol (30d TTL). Stages 2–4 re-fetch on every scan by design.

### 4.3 Edge Function Leg Internals

#### `quotes` leg (daily 01:30 UTC, ~70s)

```
1. Load existing rows from smart_money_scan_rows
2. Fetch batch quotes for all 501 symbols
3. Rank by cached score → pick top-125 candidates
   - Candidate filter: score > 0 OR squeeze not yet loaded (cold-start coverage)
4. Fetch short interest for each candidate (300ms pace)
5. Fetch congress trades bulk from Supabase REST
6. Build all 501 rows (merge fresh + previous data)
7. Upsert to smart_money_scan_rows
```

#### `insider` leg (daily 02:30 UTC, ~110s)

```
1. Load existing rows
2. Find missing symbols (never scanned) + stale symbols (>30d since insider_scanned_at)
3. Sort stale by scanned_at ascending (oldest first)
4. Take first INSIDER_BUCKET (85) symbols
5. Fetch ticker→CIK map from SEC company_tickers.json
   - If empty: bail out (don't mark anything done)
6. For each symbol: fetch + parse Form 4, compute insider score
   - Flush per-row upsert (incremental — timeout-safe)
   - Set insider_scanned_at = now (unless fetch fails → keep prior for retry)
7. Budget guard: TIME_BUDGET_MS = 110s
```

#### `weekly` leg (Mon 03:30 UTC, ~12s)

```
1. Load existing rows
2. For each of 10 tracked managers: fetch latest 13F-HR
3. If all 10 attempted → full recompute of institutional scores
4. If partial (budget timeout) → keep previous institutional data
5. Upsert rows
```

### 4.4 Server Read-Path Logic

```
Page opens → mode effect:
  1. Read localStorage cache stockpulse_sm_scan_<mode> (24h TTL)
  2. If mode ∈ {index, sp500, ndx100}:
     a. Fetch smart_money_scan_rows?universe=eq.index&select=*
     b. serverScanForMode(mode, rows):
        - Filter rows to mode's symbol set
        - Map DB rows → UI rows via mapScanDbRow
        - Return [] if no server data (→ keep local cache)
     c. If serverRows.length > 0 → saveScan + use server data
  3. If mode = 'curated': use local cache only
  4. Render table
```

**`mapScanDbRow`:** Converts a `smart_money_scan_rows` DB row to a `SmartMoneyRow` UI object (JSONB signal columns → typed objects, null coalescing for optional fields).

---

## 5. Key Files Reference

| File | Purpose |
|------|---------|
| `src/pages/SmartMoneyScreener.tsx` (630 lines) | Page component — mode selector, sortable table, Top score card, scan button, load effect |
| `src/lib/smartMoney.ts` (946 lines) | Scoring, scan orchestration, `SERVER_SCANNED_MODES`, `serverScanForMode`, `mapScanDbRow` |
| `src/lib/smartMoney.test.ts` (45 tests) | Unit tests for scoring + server read-path |
| `src/pages/SmartMoneyScreener.test.tsx` | Page component tests |
| `src/lib/edgeFn.ts` | `edgeRest(tablePath)` REST helper |
| `src/lib/storage.ts` | localStorage wrapper (Supabase → SQLite → localStorage) |
| `src/lib/indexMembers.ts` (605 lines) | SP500_MEMBERS (488) + NASDAQ100_MEMBERS (85) |
| `supabase/functions/smart-money-scan/index.ts` | Edge function — 3 cron legs |
| `supabase/functions/smart-money-scan/universe.ts` | Generated Deno membership |
| `supabase/migrations/20261012000000_smart_money_scan_rows.sql` | Table + RLS |
| `supabase/schedules.sql` | 3 pg_cron job definitions |
| `supabase/config.toml` | Edge fn config (`verify_jwt = false`) |
| `scripts/gen-deno-universe.cjs` | Regenerates universe.ts |
| `scripts/run-sql.cjs` | SQL runner (has CRON_SECRET fallback) |

---

## 5. Conventions & Gotchas

### 5.1 PowerShell Rules

- **Never use `Add-Content`/`Set-Content` for files with UTF-8** (em-dashes, arrows) — use `write`/`edit` tools or Node `.cjs` scripts
- **Never inline `\$`/`$100K` in `node -e` double-quoted commands** — PowerShell mangles them
- Use `npm.cmd` (not `npm`) in PowerShell
- Node prefix: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

### 5.2 Supabase

- `supabase db push` blocked by CLI login-role bug → use `node scripts/run-sql.cjs <file.sql>`
- pg_net waits only 5s → cron jobs log spurious timeouts; verify by data freshness
- `run-sql` cannot serialize `bigint`/`jobid` → use `jobname::text` etc.
- CRON_SECRET = `0mvixrnd7zl3ckow92us645jbhqet8yf1gap` (committed in `scripts/run-sql.cjs`)

### 5.3 Git

- Commit style: `feat:`, `fix:`, `chore:`, `docs:` — conventional commits
- Git identity: `Ben Chan <ben.chan@stockpulse.local>`
- `dist/` is committed to git (Vercel serves it via `index.js`)
- Always run `npm run build` before committing

### 5.4 App Constraints

- Rule-based only (no AI/ML APIs)
- Education-only English labels
- Pages render `<Header />` + `<BackToTop />`
- Storage write path: Supabase first → SQLite → localStorage (all via `storage.ts`)

---

## 6. Known Issues & Pending Items

| Item | Status | Notes |
|------|--------|-------|
| `FRED_API_KEY` not set on Vercel | **Open** | `/macro` shows 501; needs Vercel env var |
| v1.4.1 tag | **Offered** | User hasn't confirmed |
| Squeeze-reuse gap | **Open** | Re-running scan re-fetches squeeze data already in table |
| Mode not persisted | **Open** | Default is always `'curated'` on page load |
| 13F/congress/quotes not cached | **By design** | Every manual scan re-fetches these stages |
| Curated can't be fully server-served | **By design** | GME + RIVN absent from 501 union |

---

## 7. Test & Build Commands

```powershell
# Typecheck
.\node_modules\.bin\tsc.cmd --noEmit

# Tests (353 tests / 27 files)
npm.cmd run test

# Build (dist/ committed to git)
npm.cmd run build

# Regenerate universe.ts after editing indexMembers.ts
node scripts/gen-deno-universe.cjs

# Run SQL against Supabase
node scripts/run-sql.cjs <file.sql>

# Deploy edge function
npx.cmd supabase functions deploy smart-money-scan --no-verify-jwt
```

---

## 8. Verification Checklist (After Any Change)

1. `tsc --noEmit` → exit 0
2. `npm run test` → 353 passing
3. `npm run build` → clean, new `dist/assets/index-*.js`
4. `git add -A && git commit && git push origin main`
5. Vercel auto-deploys (check `https://dandanball-stock.vercel.app`)
6. For edge fn changes: `npx.cmd supabase functions deploy smart-money-scan --no-verify-jwt`
7. For SQL changes: `node scripts/run-sql.cjs <file.sql>`
8. For cron changes: verify with `select jobname::text, schedule::text, active from cron.job`
