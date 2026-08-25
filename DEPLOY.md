# Deploy Guide

## Repository

- **GitHub**: https://github.com/beartoinfinity-crypto/bonto.stock
- **Live**: https://dandanball-stock.onrender.com/

## How Deploy Works

Push to `main` → Render auto-builds → Express serves `dist/` on port 10000.

The `dist/` folder is committed to git (Render runs `npm install && npm start`, not `npm run build`).

## Deploy Steps

```bash
npm run build              # rebuild dist/
git add -A
git commit -m "feat: ..."
git push                   # triggers Render auto-deploy
```

## Local Testing (Production Build)

```bash
npm run build
npm start                  # Express on http://localhost:10000
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10000` | Server port (Render sets this automatically) |

## Supabase Setup

### First Time

1. Create a Supabase project
2. Go to SQL Editor
3. Run the setup SQL from Settings page (or from `supabaseDb.ts` `SETUP_SQL` constant)
4. In Settings, enter your Supabase URL and anon key
5. Enable Cloud Sync

### Featured Trades Table

The `politician_featured_trades` table is created by the same setup SQL. It stores Trump/Pelosi trades for instant display.

### Edge Functions (Optional)

Server-side sync that runs even when no browser is open:

```bash
# Deploy
./scripts/deploy-edge-functions.ps1

# Schedule: fill placeholders in supabase/schedules.sql, run in SQL Editor
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Blank page | Ensure `dist/` is committed and `index.js` serves it |
| 404 on refresh | Express catch-all should handle client-side routes |
| "All providers unavailable" | Check Render logs; server proxy may be failing |
| Stale data | Click Refresh in Politician Trades panel, or run cron job from Admin |
| Server proxy 502 | Render outbound requests may be blocked |
| Trump shows no records | Verify the UnusualWhales URL uses `Donald J Trump` (no period) |
| Render slow to respond | Free tier sleeps after inactivity; first request takes 30-50s |

For Express server architecture and API endpoints, see [`docs/CODEBASE.md`](docs/CODEBASE.md).
