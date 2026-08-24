# Deploy to Render.com

## Repository

- **GitHub:** https://github.com/beartoinfinity-crypto/bonto.stock
- **Live URL:** https://dandanball-stock.onrender.com/

## Quick Start

```bash
# Clone the repo
git clone https://github.com/beartoinfinity-crypto/bonto.stock.git
cd bonto.stock

# Install dependencies
npm install

# Build for production
npm run build

# Run locally (for testing the production build)
npm start
```

## Deploy to Render

### Auto-deploy (recommended)

Render connects to the GitHub repo and auto-deploys on push to `main`:

```bash
git add -A
git commit -m "your message"
git push
```

Your app will be live at:
https://dandanball-stock.onrender.com/

### Manual deploy

1. Go to https://dashboard.render.com
2. Select the `dandanball-stock` service
3. Click "Manual Deploy" → "Deploy latest commit"

## Project Structure

```
├── index.js              # Express server (serves dist/ + /api/proxy endpoint)
├── package.json          # Dependencies + start script
├── dist/                 # Production build (committed for deployment)
│   ├── index.html
│   ├── favicon.ico
│   ├── sql-wasm.wasm
│   └── assets/
│       ├── index-*.css
│       └── index-*.js
├── src/                  # Source code
└── ...
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `10000` | Server port (Render sets this automatically) |

## Useful Commands

```bash
# Rebuild after code changes
npm run build

# Push updates to Render
git add -A
git commit -m "your message"
git push
```

## Troubleshooting

- **Page is blank:** Make sure `dist/` folder is committed and `index.js` points to it
- **404 on refresh:** The Express catch-all route handles client-side routing
- **App won't start:** Check that `package.json` has `"start": "node index.js"`
- **"All providers unavailable":** The server-side proxy (`/api/proxy`) handles data fetching; check Render logs for fetch errors
- **Stale data:** Click "Refresh" in the Politician Trades panel, or run the cron job from Admin page
- **Server proxy 502:** Render's outbound requests may be blocked; check the service's outbound IP allowlist
