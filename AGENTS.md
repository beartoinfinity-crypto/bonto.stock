# Agent Instructions

## Every session

1. Set Node on PATH: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`
2. Run `npm run build` before committing — `dist/` is committed to git (Render serves it directly)
3. Run `npm run test` after changes — 126 tests across 14 files, must pass
4. Use `npm.cmd` (not `npm`) in PowerShell commands
5. Supabase CLI deploy runs from the **repo root** (`supabase/config.toml` is resolved relative to cwd). If the link is lost: `npx.cmd supabase link --project-ref aqyaarnpmvvdzasjefje`

## Gotchas

- **Render free tier sleeps** — first request after idle takes 30-50s
- **UnusualWhales Trump URL** — use `Donald J Trump` (no period). The period causes a 500 error
- **PowerShell template literals** — backtick-mangled in here-strings. Use `.cjs` Node scripts or the `write` tool instead
- **PowerShell Set-Content corrupts UTF-8 em-dashes/emoji** — always use the `write`/`edit` tools for file changes, never `Set-Content` on source files
- **PowerShell `select=*` in URLs** — the `*` gets mangled; probe Supabase REST with Node `.cjs` scripts instead
- **Third-party CORS proxies** — often dead. Server proxy (`/api/proxy`) is the primary path
- **StockSpill Supabase** — third-party project `artscweyrracfffoqvur`, anon key hardcoded (read-only). Our own project is `aqyaarnpmvvdzasjefje`
- **Vite has no proxy config** — `/api/*` endpoints only work on Render (Express), not localhost dev server
- **Master Matrix history is localStorage-only** (key `stockpulse_master_matrix`) — does NOT go through `storage.ts`'s Supabase path. Supabase only *feeds* it (`stock_historical` bars)
- **Secrets never go in source or `.env`-built bundles** — GitHub push protection blocks them. Keys are served at runtime via `/api/api-keys` (ADANOS_API_KEY) and `/api/edge-config` (EDGE_FN_URL/EDGE_FN_KEY), set on Render. The committed `dist/` bundle is public
- **pg_net 5s timeout** — Supabase SQL `net.http_post` records "timeout" for any edge fn running >5s (sync-stock-data ~60s). The fn still completes; verify by data freshness, not `_http_response` status
- **Edge fn auth** — functions are deployed `--no-verify-jwt`; the `x-cron-secret` header (CRON_SECRET secret) is the only auth. The secret is write-only (`secrets list` shows a digest)
- **Supabase schedules** — 6 pg_cron jobs live on the project (see `supabase/schedules.sql`); data jobs are server-side, browser cron keeps only local maintenance (`archive-sqlite`, `pull-stock-data`)

## Conventions

- **Commit style**: `feat:`, `fix:`, `chore:`, `docs:` — conventional commits
- **Git identity**: `ben.chan@stockpulse.local` / `Ben Chan`
- **Analytics**: rule-based only, no AI/ML APIs. Template-based narratives
- **Storage write path**: Supabase first → SQLite → localStorage (all via `storage.ts`)
- **Runtime config pattern** (new features): browser fetches config from the server (`/api/sync-config`, `/api/api-keys`, `/api/edge-config`) — never bake VITE_ vars holding secrets; the dist bundle is committed
- **Ledger day semantics**: a day simulates ONCE (`simulateDay` write-protect + server `simulate-ledger` fn). Re-run via the page's Reset today (clears cloud too), or delete the KV row for a full restart

## Context pointers

| When you need... | Read... |
|------------------|---------|
| File-by-file codebase docs, architecture, data flow | `docs/CODEBASE.md` |
| Development guide (adding cron jobs, sentiment sources, config) | `docs/DEVELOPMENT.md` |
| Domain model, glossary | `CONTEXT.md` |
| Deploy process, troubleshooting, env vars | `DEPLOY.md` |
| Triage labels, issue tracker conventions | `docs/agents/` |
