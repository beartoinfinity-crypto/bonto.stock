# Deploy to Bonto

## Repository

- **GitHub:** https://github.com/beartoinfinity-crypto/bonto.stock
- **Bonto URL:** https://dandanball.bonto.run

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

## Deploy to Bonto

### Option 1: Git Push (recommended)

```bash
# Add remote (already done if cloned from GitHub)
git remote add origin https://github.com/beartoinfinity-crypto/bonto.stock.git

# Push to main branch
git push -u origin main
```

Bonto auto-deploys on push. Your app will be live at:
https://dandanball.bonto.run

### Option 2: Browser Editor

1. Go to https://bonto.dev
2. Create a new project
3. Upload these files:
   - `index.js`
   - `package.json`
   - `dist/` folder (entire folder)
4. Bonto will install dependencies and start the app

## Project Structure

```
├── index.js              # Express server (serves dist/)
├── package.json          # Dependencies + start script
├── dist/                 # Production build (upload this to Bonto)
│   ├── index.html
│   ├── favicon.ico
│   ├── sql-wasm.wasm
│   └── assets/
│       ├── index-*.css
│       └── index-*.js
├── src/                  # Source code (not needed on Bonto)
└── ...
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port (Bonto sets this automatically) |

## Useful Commands

```bash
# Rebuild after code changes
npm run build

# Push updates to Bonto
git add -A
git commit -m "your message"
git push

# Check Bonto logs (if available)
# Use Bonto browser editor or MCP
```

## Troubleshooting

- **Page is blank:** Make sure `dist/` folder is uploaded and `index.js` points to it
- **404 on refresh:** The Express catch-all route handles client-side routing
- **App won't start:** Check that `package.json` has `"start": "node index.js"`
- **Stale data:** Click "Refresh" in the Politician Trades panel, or run the cron job from Admin page
