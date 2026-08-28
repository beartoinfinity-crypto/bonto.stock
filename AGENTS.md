# Agent Instructions

## Every session

1. Set Node on PATH: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`
2. Run `npm run build` before committing — `dist/` is committed to git (Render serves it directly)
3. Run `npm run test` after changes — 24 tests across 4 files, must pass
4. Use `npm.cmd` (not `npm`) in PowerShell commands

## Gotchas

- **Render free tier sleeps** — first request after idle takes 30-50s
- **UnusualWhales Trump URL** — use `Donald J Trump` (no period). The period causes a 500 error
- **PowerShell template literals** — backtick-mangled in here-strings. Use `.cjs` Node scripts or the `write` tool instead
- **Third-party CORS proxies** — often dead. Server proxy (`/api/proxy`) is the primary path
- **StockSpill Supabase** — project `artscweyrracfffoqvur`, anon key hardcoded in `index.js` (read-only)
- **Vite has no proxy config** — `/api/*` endpoints only work on Render (Express), not localhost dev server
- **Master Matrix history is localStorage-only** (key `stockpulse_master_matrix`) — does NOT go through `storage.ts`'s Supabase path. Supabase only *feeds* it (`stock_price_history` bars). Only 32 S&P 500 symbols have stored bars; the rest show live/`supabase`-tagged snapshots

## Conventions

- **Commit style**: `feat:`, `fix:`, `chore:`, `docs:` — conventional commits
- **Git identity**: `ben.chan@stockpulse.local` / `Ben Chan`
- **Analytics**: rule-based only, no AI/ML APIs. Template-based narratives
- **Storage write path**: Supabase first → SQLite → localStorage (all via `storage.ts`)

## Context pointers

| When you need... | Read... |
|------------------|---------|
| File-by-file codebase docs, architecture, data flow | `docs/CODEBASE.md` |
| Domain model, glossary | `CONTEXT.md` |
| Deploy process, troubleshooting | `DEPLOY.md` |
| Triage labels, issue tracker conventions | `docs/agents/` |
