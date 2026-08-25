import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS proxy endpoint (replaces dead third-party proxies) -------
// GET /api/proxy?url=<encoded-target-url>

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }

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

// --- Yahoo Finance crumb proxy --------------------------------------
// GET /api/yahoo/crumb
// Fetches Yahoo crumb server-side (cookies work from server, not browser).

let yahooCrumbCache = { crumb: null, expiry: 0 };

app.get('/api/yahoo/crumb', async (req, res) => {
  if (yahooCrumbCache.crumb && Date.now() < yahooCrumbCache.expiry) {
    res.set('Access-Control-Allow-Origin', '*');
    return res.json({ crumb: yahooCrumbCache.crumb });
  }

  try {
    // Step 1: hit finance.yahoo.com to set session cookies
    const ctrl1 = new AbortController();
    const timer1 = setTimeout(() => ctrl1.abort(), 10000);
    const cookieRes = await fetch('https://finance.yahoo.com/', {
      signal: ctrl1.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timer1);

    // Step 2: get crumb using cookies from step 1
    const cookieHeader = cookieRes.headers.get('set-cookie') || '';
    const ctrl2 = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), 10000);
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      signal: ctrl2.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieHeader.split(';')[0],
      },
    });
    clearTimeout(timer2);

    if (crumbRes.ok) {
      const crumb = (await crumbRes.text()).trim();
      if (crumb && crumb.length > 2 && !crumb.includes('error')) {
        yahooCrumbCache = { crumb, expiry: Date.now() + 30 * 60 * 1000 };
        console.log('[YahooCrumb] Server got crumb:', crumb.substring(0, 6) + '...');
        res.set('Access-Control-Allow-Origin', '*');
        return res.json({ crumb });
      }
    }
    res.status(502).json({ error: 'Failed to get Yahoo crumb', status: crumbRes.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Yahoo crumb fetch failed', detail: msg });
  }
});

// --- Finnhub social sentiment proxy ---------------------------------
// GET /api/finnhub/sentiment?symbol=AAPL
// Requires FINNHUB_API_KEY env var. Free tier: 60 calls/min.

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';

app.get('/api/finnhub/sentiment', async (req, res) => {
  if (!FINNHUB_KEY) {
    return res.status(503).json({ error: 'FINNHUB_API_KEY not configured' });
  }
  const symbol = (req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const url = `https://finnhub.io/api/v1/stock/social-sentiment?symbol=${symbol}&token=${FINNHUB_KEY}`;
    const response = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await response.json();
    res.set('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Finnhub fetch failed', detail: msg });
  }
});

// --- Google Trends proxy --------------------------------------------
// GET /api/google-trends?keyword=AAPL
// Calls Google Trends explore + widgetdata server-side to avoid CORS.

app.get('/api/google-trends', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.status(400).json({ error: 'Missing keyword' });

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const exploreReq = {
      comparisonItem: [{ keyword, geo: 'US', time: 'today 1-m' }],
      category: 0,
      property: '',
    };
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=-240&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;

    const ctrl1 = new AbortController();
    const timer1 = setTimeout(() => ctrl1.abort(), 10000);
    const exploreRes = await fetch(exploreUrl, { signal: ctrl1.signal, headers });
    clearTimeout(timer1);

    if (!exploreRes.ok) {
      return res.status(exploreRes.status).json({ error: `Google Trends explore returned ${exploreRes.status}` });
    }

    const raw = await exploreRes.text();
    const cleaned = raw.startsWith(")]}'") ? raw.slice(5) : raw;
    const exploreData = JSON.parse(cleaned);

    const widgets = exploreData?.widgets ?? [];
    const timeseries = widgets.find(w => w.id === 'TIMESERIES');

    if (!timeseries) {
      return res.json({ interestOverTime: [], avg: 0, latest: 0, relatedQueries: { top: [], rising: [] } });
    }

    const ctrl2 = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), 10000);
    const dataUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-240&req=${encodeURIComponent(JSON.stringify(timeseries.request))}&token=${timeseries.token}`;
    const dataRes = await fetch(dataUrl, { signal: ctrl2.signal, headers });
    clearTimeout(timer2);

    if (!dataRes.ok) {
      return res.status(dataRes.status).json({ error: `Google Trends data returned ${dataRes.status}` });
    }

    const dataRaw = await dataRes.text();
    const dataCleaned = dataRaw.startsWith(")]}'") ? dataRaw.slice(5) : dataRaw;
    const timeData = JSON.parse(dataCleaned);

    const timelineData = timeData?.default?.timelineData ?? [];
    const values = timelineData.map(d => parseInt(d.value?.[0] ?? '0', 10));
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const latest = values.length > 0 ? values[values.length - 1] : 0;

    const relatedWidget = widgets.find(w => w.id === 'RELATED_QUERIES');
    let relatedQueries = { top: [], rising: [] };

    if (relatedWidget) {
      try {
        const ctrl3 = new AbortController();
        const timer3 = setTimeout(() => ctrl3.abort(), 10000);
        const rqUrl = `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=en-US&tz=-240&req=${encodeURIComponent(JSON.stringify(relatedWidget.request))}&token=${relatedWidget.token}`;
        const rqRes = await fetch(rqUrl, { signal: ctrl3.signal, headers });
        clearTimeout(timer3);

        if (rqRes.ok) {
          const rqRaw = await rqRes.text();
          const rqCleaned = rqRaw.startsWith(")]}'") ? rqRaw.slice(5) : rqRaw;
          const rqData = JSON.parse(rqCleaned);
          const rankedList = rqData?.default?.rankedList ?? [];
          for (const group of rankedList) {
            const items = (group?.rankedKeyword ?? []).map(kk => ({
              query: kk.query,
              value: kk.formattedValue ?? '',
            }));
            if (relatedQueries.top.length === 0) relatedQueries.top = items;
            else relatedQueries.rising = items;
          }
        }
      } catch { /* related queries are optional */ }
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ interestOverTime: values, avg, latest, relatedQueries });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Google Trends fetch failed', detail: msg });
  }
});

// --- Featured politician trade endpoints -----------------------------
// Scrape UnusualWhales profile pages (SSG -> __NEXT_DATA__ JSON)
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
    const rawTrades = nextData?.props?.pageProps?.trades ?? [];
    const trades = Array.isArray(rawTrades) ? rawTrades.flat() : [];
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