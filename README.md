# Dan's StockPulse

Stock analysis dashboard with cloud-first storage. Runs in the browser; deploys to Render.com.

> **Education only. Not financial advice.**

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:8080
npm run build      # production build → dist/
npm run test       # vitest
npm start          # serve dist/ via Express
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vite + TypeScript + React 18 |
| UI | shadcn/ui (Radix) + Tailwind CSS |
| Charts | Recharts |
| Data Fetching | TanStack React Query |
| Local DB | sql.js (WASM SQLite) — IndexedDB / File System API persistence |
| Cloud DB | Supabase (PostgreSQL) — primary source of truth |
| Cron | Browser-based scheduler (runs while tab is open) |
| Server | Express (`index.js`) — serves dist/ + server-side proxy |
| Deploy | Render.com (auto-deploy on push to main) |

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Price charts, signals, sentiment, action plan |
| `/screener` | Screener | Batch-screen all stocks by signal confidence |
| `/tactical` | Tactical Engine | Per-stock trade planner with position sizing |
| `/masters` | Trading Masters | 12 legendary investors analyze any stock |
| `/masters-matrix` | Master Matrix | Rank S&P 500 / NASDAQ-100 / custom stocks into a top-50 matrix by 12-master verdicts |
| `/masters-matrix/:symbol` | Stock History | Per-stock daily 12-master history, with past-year backfill |
| `/settings` | Settings | Auth, watchlist, DB export/import, cloud sync |
| `/admin` | Admin | Cron job management (password-protected) |

## Architecture

See [`docs/CODEBASE.md`](docs/CODEBASE.md) for file-by-file docs, architecture diagrams, data flow, storage hierarchy, signal engine, and all component details.

## License

MIT
