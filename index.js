import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS proxy endpoint (replaces dead third-party proxies) ────────
// GET /api/proxy?url=<encoded-target-url>
// Fetches any URL server-side (no CORS restrictions) and returns the
// response to the browser. Used by stockApi, sentimentAnalysis, and
// localCron as the primary data-fetch path.

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }

  // Block private IPs to prevent SSRF
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      parsed.protocol === 'file:'
    ) {
      return res.status(403).json({ error: 'Private/internal URLs are not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const response = await fetch(targetUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);

    const contentType = response.headers.get('content-type') || 'application/json';
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', contentType);

    const body = await response.text();
    res.status(response.status).send(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Proxy fetch failed', detail: msg });
  }
});

// ─── Featured politician trade endpoints ──────────────────────────
// Scrape UnusualWhales profile pages (SSG → __NEXT_DATA__ JSON)
// Query StockSpill Supabase (public anon key, no auth needed)

const UW_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFydHNjd2V5cnJhY2ZmZm9xdnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMTM2MTgsImV4cCI6MjA4MTU4OTYxOH0.P9zsEmmEJvYDDFqMuMa_v4m-Ywa2zF90Lk6zDBmqwOU';

app.get('/api/politician-trades/unusualwhales', async (req, res) => {
  const politician = req.query.politician;
  if (!politician) return res.status(400).json({ error: 'Missing politician query parameter' });

  try {
    const url = `https://unusualwhales.com/politics/profile/${encodeURIComponent(politician)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timer);

    if (!response.ok) return res.status(response.status).json({ error: `Upstream returned ${response.status}` });

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!match) return res.status(502).json({ error: 'Could not find __NEXT_DATA__ in page' });

    const nextData = JSON.parse(match[1]);
    const trades = nextData?.props?.pageProps?.trades ?? [];
    const politicianInfo = nextData?.props?.pageProps?.politician ?? null;

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ trades, politician: politicianInfo, count: trades.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Failed to fetch from UnusualWhales', detail: msg });
  }
});

app.get('/api/politician-trades/stockspill', async (req, res) => {
  const memberName = req.query.member_name;
  if (!memberName) return res.status(400).json({ error: 'Missing member_name query parameter' });

  try {
    const url = `https://artscweyrracfffoqvur.supabase.co/rest/v1/congress_trades?member_name=like.*${encodeURIComponent(memberName)}*&order=transaction_date.desc&limit=500`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'apikey': UW_ANON_KEY,
        'Authorization': `Bearer ${UW_ANON_KEY}`,
      },
    });
    clearTimeout(timer);

    if (!response.ok) return res.status(response.status).json({ error: `Upstream returned ${response.status}` });

    const data = await response.json();
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ trades: data, count: data.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Failed to fetch from StockSpill', detail: msg });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
