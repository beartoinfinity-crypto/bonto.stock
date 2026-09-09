# Development Guide

How to extend this codebase. For the file-by-file architecture, data flow, and design decisions, see [`docs/CODEBASE.md`](CODEBASE.md). For deploy/schedule ops, see [`DEPLOY.md`](../DEPLOY.md). For the domain model, see [`CONTEXT.md`](../CONTEXT.md).

## Repo layout (where things live)

```
src/
  lib/                 domain logic — pure, unit-tested (no React): stockApi, stockData,
                       masterAnalysis, tradingAgents, peadAnalysis, tacticalEngine,
                       supabaseDb, supabaseHistory, edgeFn, storage, ledgerMerge, ...
  hooks/               state management (React Query): useStockData, useMasterMatrix,
                       useTradeLedger, useTacticalHistory, useScreenerData ...
  components/          presentational components
  pages/               route components
supabase/
  functions/           Edge Functions (Deno) — data-production jobs
  schedules.sql        pg_cron jobs (server-side schedules)
  migrations/          schema/seed SQL applied to the Supabase project
  config.toml          project_id = aqyaarnpmvvdzasjefje, function config
index.js               Express server — /api/* endpoints + serves dist/
docs/                  architecture reference (CODEBASE.md) + this guide
```

The core principle: **data production is server-side (Supabase Edge Functions + pg_cron)**; the browser is a consumer. Browsers only keep two local maintenance jobs (`archive-sqlite`, `pull-stock-data`). Do not add browser-side data-production jobs.

## Adding a server-side cron job

The full pattern is: an Edge Function (the work) + a pg_cron schedule (the trigger) + optional tables/migrations + a secret for auth.

1. **Write the function** in `supabase/functions/<name>/index.ts` (Deno, imports from `https://esm.sh/`). It should:
   - Read its config from `Deno.env.get(...)` (secrets/keys are env vars set via `supabase secrets set`, never hardcoded).
   - Auth-check the `x-cron-secret` header against `Deno.env.get('CRON_SECRET')` — every scheduled function requires this.
   - Upsert results to the appropriate table (`stock_quotes`, `stock_historical`, `stockpulse_kv`, etc.).
2. **Deploy it** from the repo root (the CLI reads `supabase/config.toml` relative to cwd):
   ```powershell
   npx.cmd supabase functions deploy <name> --no-verify-jwt
   if ($?) { npx.cmd supabase secrets set ... }
   ```
   If it can't find the project ref: `npx.cmd supabase link --project-ref aqyaarnpmvvdzasjefje` first.
3. **Schedule it** in the Supabase SQL Editor by appending a `cron.schedule` row (extensions `pg_cron` + `pg_net` must be enabled). Keep `supabase/schedules.sql` in sync so the schedule is reproducible.
4. **Verify by data freshness**, not the `_http_response` status — pg_net only waits 5s, so long functions record a spurious timeout (see DEPLOY.md troubleshooting).

New tables: add a migration under `supabase/migrations/` (create table + RLS policies so the anon key can read what browsers need). Browsers reach these tables through the runtime config endpoints, never hardcoded project URLs/keys.

## Adding a sentiment source

Social sentiment aggregates **rule-based keyword scoring — no AI/LLM**. To add a source:

1. Add the fetch + scoring in `src/lib/sentimentAnalysis.ts` alongside the existing 10 sources (Google News, StockTwits, Yahoo, ApeWisdom, SocialTickers, Finnhub, Reddit, MarketWatch, CNBC, Google Trends, + Adanos).
2. If the source needs an API key, **serve it from the server at runtime**, not from source:
   - Add it as an env var on Render.
   - Expose it in `index.js` — e.g. add to the `/api/api-keys` response (like `ADANOS_API_KEY`).
   - Fetch it in the browser (`fetchAdanosKey` is the pattern) with a per-browser fallback in Settings → API Keys.
   - Never bake a real key into `dist/` — it's committed to git and public.
3. Surface it in `SocialSentimentCheck.tsx` with the keyword-scoring convention used by the others.

## Adding runtime config (new features)

Browser features that need server URLs/keys must fetch them at runtime — never compile secrets into the SPA. Three endpoints on `index.js` serve this:

| Endpoint | Serves | Source (Render env) |
|----------|--------|--------------------|
| `/api/sync-config` | Supabase URL + anon key (cloud sync, stored history) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `/api/edge-config` | Edge function URL + key (`edgeFn.ts` calls) | `EDGE_FN_URL`, `EDGE_FN_KEY` |
| `/api/api-keys` | Third-party keys (e.g. `ADANOS_API_KEY`) | named Render env vars |

Local dev fallback: `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in the gitignored `.env` (never committed).

## Adding master strategies (12 Masters)

Editable engine: `src/lib/masterAnalysis.ts` (`analyzeStock` runs all 12). Add a `MasterId`/`MASTERS` entry (e.g. `buffett-graham`), the strategy's verdict logic against daily OHLCV rows, then surface it in the Masters page. Rule-based only — no AI/ML/LLM (see design decisions). `tradingAgents.ts` and `tacticalEngine.ts` follow the same discipline.

## Editing the ledger / simulator

- Personas + rules: `src/lib/tradeSimulator.ts` + `useTradeLedger.ts` — each persona binds to a distinct engine (12 Masters, inverted Masters, Matrix rank, `runEngine`, `runTradingAgents`).
- Pure math lives in `tradeSimulator.ts` and is unit-tested; keep behavioral thresholds in the hook.
- **Parallelism rules**: a day simulates ONCE (write-protected + server-side `simulate-ledger` fn). Multi-machine merge: `src/lib/ledgerMerge.ts` (`mergeLedgers`, `healSameDayConflicts`) — pure + unit-tested; wired into both push paths and boot hydration in `supabaseDb.ts`.

## Testing & checks (run before committing)

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
.\node_modules\.bin\tsc.cmd --noEmit     # type check — 0 errors
npm.cmd run test                         # 126 tests across 14 files — all pass
npm.cmd run build                        # rebuild dist/ (committed)
```

New pure logic should come with unit tests (see `src/lib/*.test.ts`, `*.simulateDay.test.ts`). Follow the existing style.

## Conventions cheat-sheet

- Commit style: `feat:` / `fix:` / `chore:` / `docs:` (conventional commits).
- Git identity: `ben.chan@stockpulse.local` / `Ben Chan`.
- Storage write path (browser): Supabase → SQLite → localStorage, all via the unified `storage.ts` — never bypass it.
- Analytics: rule-based only; template narratives, no AI/ML APIs.
- Secrets: runtime-config pattern only (see above) — the committed `dist/` is public.
- PowerShell gotchas: use `npm.cmd` not `npm`; never `Set-Content` source files (UTF-8 em-dash/emoji corruption) — use the `write`/`edit` tools; probe Supabase REST via Node `.cjs` scripts (PowerShell mangles `select=*`).
