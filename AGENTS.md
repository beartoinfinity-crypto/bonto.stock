# Agent Instructions

## Working With This Codebase

### Build & Test Commands

```bash
# Set Node.js on PATH (Windows)
$env:Path = "C:\Program Files\nodejs;" + $env:Path

# Build
npm run build        # Vite → dist/

# Test
npm run test         # vitest — 7 tests across 2 files

# Run production locally
npm start            # Express on port 10000 (or PORT env)
```

### Commit Convention

- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Commit message should explain what changed and why
- Push to `main` triggers auto-deploy on Render.com

### Git Identity

```
user.name = Ben Chan
user.email = ben.chan@stockpulse.local
```

### Key Files to Understand

| File | What It Does |
|------|-------------|
| `src/lib/storage.ts` | Unified write layer — the single entry point for all data writes |
| `src/lib/supabaseDb.ts` | Supabase client, push/pull functions, SETUP_SQL |
| `src/lib/syncKeys.ts` | Defines which keys are synced across storage layers |
| `src/lib/localCron.ts` | Browser-based cron scheduler with 5 jobs |
| `src/lib/stockApi.ts` | Yahoo Finance API + proxy chain |
| `src/lib/stockData.ts` | All analytics: indicators, signals, forecasting, regime detection |
| `src/hooks/useStockData.ts` | Main React hook — returns `{ selectedStock, historicalData, signals }` |
| `src/components/PoliticianTrades.tsx` | Featured politician trades panel (Trump/Pelosi) |
| `index.js` | Express server — serves dist/ + `/api/proxy` + `/api/politician-trades/*` |

### Architecture Rules

1. **Supabase is primary storage**. Always write to Supabase first, then SQLite, then localStorage.
2. **All analytics are rule-based**. No AI/ML APIs. Template-based narratives.
3. **proxyFetch chain**: Server proxy → direct → CORS proxies (legacy). The server proxy is the primary path.
4. **Featured politician data**: Fetched live from external sources. Can also be loaded from Supabase (`politician_featured_trades` table) for instant display.
5. **Cron jobs run in-browser only**. They only execute while a tab is open.

### Common Tasks

**Add a new cron job**: Add a function in `localCron.ts`, register it in `CRON_JOBS` array, add description and schedule.

**Add a new Supabase table**: Add to `SETUP_SQL` in `supabaseDb.ts`, add push/pull functions, add to RLS policies.

**Add a new data source**: Create `fetch` function in the component or `localCron.ts`, use the server proxy (`/api/proxy?url=...`) for CORS-free access.

**Modify the signal engine**: Edit functions in `src/lib/stockData.ts`. Each strategy returns a `Signal` object with direction, strength, confidence.

### Known Gotchas

- `dist/` is committed to git (required for Render deployment)
- Render free tier sleeps after inactivity — first request takes 30-50s
- UnusualWhales URL for Trump must NOT have a period: `Donald J Trump` (not `Donald J. Trump`) — the period causes a 500 error
- StockSpill Supabase anon key is hardcoded in `index.js` (read-only access to `artscweyrracfffoqvur`)
- The third-party CORS proxies (corsproxy.io, allorigins.win) are often dead — server proxy is the primary path

### Domain Docs

- `CONTEXT.md` — domain model and language definitions
- `docs/adr/` — architecture decision records
- `docs/agents/` — agent skill definitions
