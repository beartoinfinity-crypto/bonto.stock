# Dan's StockPulse

Stock analysis dashboard with cloud-first storage. Runs in the browser; deploys to Render.com. (Testing)

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
| Cron | **Supabase Edge Functions + pg_cron** (server-side, 24/7) for data production; browser scheduler keeps only local maintenance |
| Server | Express (`index.js`) — serves dist/ + server-side proxy |
| Deploy | Render.com (auto-deploy on push to main) |

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Price charts, signals, sentiment, action plan |
| `/tactical` | Tactical | Per-stock trade planner with regime state machine and position sizing |
| `/screener` | Screener | Batch-screen all stocks (incl. Sector Heatmap + Asymmetric Value Screener) by signal confidence |
| `/masters` | Trading Masters | 12 legendary investors analyze any stock |
| `/trading-agents` | Trading Agents | Rule-based multi-agent analyst report (bull/bear debate, risk committee) |
| `/masters-matrix` | Master Matrix | Rank S&P 500 / NASDAQ-100 / custom stocks into a top-50 matrix by 12-master verdicts |
| `/masters-matrix/:symbol` | Stock History | Per-stock daily 12-master history, with past-year backfill |
| `/hedge-fund` | Hedge Fund | PEAD post-earnings-drift alpha model |
| `/ledger` | Simulated Traders | Six personas trade the shared S&P 500 / NASDAQ-100 universe daily; accumulated Decisions + All Transactions with filter bar, live stats, pagination |
| `/api-settings` | API Settings | Third-party provider API-key entry |
| `/settings` | Settings | Auth, watchlist, DB export/import, cloud sync |
| `/admin` | Admin | Browser cron job management (local maintenance only, password-protected) |

## Architecture

See [`docs/CODEBASE.md`](docs/CODEBASE.md) for file-by-file docs, architecture diagrams, data flow, storage hierarchy, signal engine, and all component details.

## License

MIT
