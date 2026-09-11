import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

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
    // Market-data fetches through the proxy must never be HTTP-cached —
    // stale cached responses would re-mark positions at old prices.
    res.set('Cache-Control', 'no-store');

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

let yahooCrumbCache = { crumb: null, cookie: null, expiry: 0 };

// Crumb is SESSION-BOUND: a crumb only authorizes quoteSummary calls made
// with the same session cookie that minted it. The browser can't hold that
// cookie (CORS), so all crumb'd calls must happen here, server-side.

async function getYahooSession() {
  if (yahooCrumbCache.crumb && yahooCrumbCache.cookie && Date.now() < yahooCrumbCache.expiry) {
    return { crumb: yahooCrumbCache.crumb, cookie: yahooCrumbCache.cookie };
  }

  // Step 1: hit fc.yahoo.com to set the A3 session cookie (finance.yahoo.com
  // now bounces to a consent page that drops the cookie; fc.yahoo.com still
  // sets it directly). This exchange works server-side only (CORS).
  const ctrl1 = new AbortController();
  const timer1 = setTimeout(() => ctrl1.abort(), 10000);
  const cookieRes = await fetch('https://fc.yahoo.com', {
    signal: ctrl1.signal,
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  clearTimeout(timer1);

  // Step 2: mint a crumb bound to that same session cookie
  const cookieHeader = cookieRes.headers.get('set-cookie') || '';
  if (!cookieHeader) {
    throw new Error('No session cookie returned by fc.yahoo.com');
  }
  const cookie = cookieHeader.split(';')[0];
  const ctrl2 = new AbortController();
  const timer2 = setTimeout(() => ctrl2.abort(), 10000);
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    signal: ctrl2.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie,
    },
  });
  clearTimeout(timer2);

  if (!crumbRes.ok) {
    throw new Error(`getcrumb failed: ${crumbRes.status}`);
  }
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length <= 2 || crumb.includes('error')) {
    throw new Error('Invalid crumb response');
  }
  yahooCrumbCache = { crumb, cookie, expiry: Date.now() + 30 * 60 * 1000 };
  console.log('[YahooCrumb] Server session minted:', crumb.substring(0, 6) + '...');
  return { crumb, cookie };
}

app.get('/api/yahoo/crumb', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const { crumb } = await getYahooSession();
    return res.json({ crumb });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: 'Yahoo crumb fetch failed', detail: msg });
  }
});

// --- Yahoo quoteSummary proxy ----------------------------------------
// GET /api/yahoo/quote-summary?symbol=BE&modules=summaryDetail,assetProfile
// Runs the crumb'd v10 call server-side with its session cookie — the only
// place it can succeed (crumbs are session-bound).

app.get('/api/yahoo/quote-summary', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const modules = String(req.query.modules || 'summaryDetail,assetProfile');
  if (!symbol || !/^[A-Za-z0-9.\-^=]{1,12}$/.test(symbol)) {
    return res.status(400).json({ error: 'Missing or invalid symbol' });
  }

  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const { crumb, cookie } = await getYahooSession();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const url = `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': cookie,
        },
      });
      clearTimeout(timer);
      if (r.ok) {
        const body = await r.text();
        res.set('Content-Type', 'application/json');
        return res.status(200).send(body);
      }
      // Non-OK: invalidate the cached session (crumb may have expired) and retry other host
      yahooCrumbCache = { crumb: null, cookie: null, expiry: 0 };
    } catch { /* try next host */ }
  }
  return res.status(502).json({ error: 'quoteSummary failed for ' + symbol });
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

// --- Finnhub earnings surprises proxy --------------------------------
// GET /api/finnhub/earnings-surprises?symbol=AAPL&tokens=k1,k2
// Provides BEAT/MISS history for the /hedge-fund PEAD page as a backup
// to Yahoo's 401-protected quoteSummary `earnings` module.
//
// Multiple API keys are supported: the server env keys (FINNHUB_API_KEY,
// FINNHUB_API_KEY_2) plus any browser-supplied `tokens` the client sends from
// the Settings page. Keys are tried in order, skipping any that are
// rate-limited or that lack access (Finnhub serves an HTML paywall for paid
// endpoints like earnings-surprises).
app.get('/api/finnhub/earnings-surprises', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const envKeys = [
    process.env.FINNHUB_API_KEY,
    process.env.FINNHUB_API_KEY_2,
  ].filter(Boolean);
  const tokens = String(req.query.tokens || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const keys = [...new Set([...envKeys, ...tokens])];
  if (keys.length === 0) {
    return res.status(503).json({ error: 'No Finnhub API key configured' });
  }

  let lastDetail = 'no keys returned data';
  for (const key of keys) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const url = `https://finnhub.io/api/v1/stock/earnings-surprises?symbol=${symbol}&token=${key}`;
      const response = await fetch(url, { signal: ctrl.signal });
      const raw = await response.text();
      const isHtml = /^\s*(<!DOCTYPE|<html)/i.test(raw);
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch { /* not JSON */ }
      // Treat rate-limits, HTML paywalls, and access errors as "try next key".
      const blocked =
        isHtml ||
        response.status === 429 ||
        (json && typeof json.error === 'string' && /access|plan|rate|subscri|unavailable/i.test(json.error));
      if (blocked) {
        lastDetail = json?.error || `HTTP ${response.status}`;
        continue;
      }
      res.set('Access-Control-Allow-Origin', '*');
      return res.status(response.status).json({ finnhubStatus: response.status, body: raw });
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  res.status(502).json({
    error: 'All Finnhub keys failed or lack access',
    detail: lastDetail,
  });
});

// GET /api/finnhub/quote?symbol=AAPL&tokens=k1,k2
// Fast quote proxy for fresh (uncached) price lookups — e.g. the Master Matrix
// page. Mirrors the earnings-surprises rotation: tries the server env keys
// (FINNHUB_API_KEY, FINNHUB_API_KEY_2) plus any browser-supplied `tokens`,
// skipping rate-limited / invalid keys, and returns the first valid quote.
app.get('/api/finnhub/quote', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const envKeys = [
    process.env.FINNHUB_API_KEY,
    process.env.FINNHUB_API_KEY_2,
  ].filter(Boolean);
  const tokens = String(req.query.tokens || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const keys = [...new Set([...envKeys, ...tokens])];
  if (keys.length === 0) {
    return res.status(503).json({ error: 'No Finnhub API key configured' });
  }

  let lastDetail = 'no keys returned data';
  for (const key of keys) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`;
      const response = await fetch(url, { signal: ctrl.signal });
      const raw = await response.text();
      const isHtml = /^\s*(<!DOCTYPE|<html)/i.test(raw);
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch { /* not JSON */ }
      const blocked =
        isHtml ||
        response.status === 429 ||
        (json && typeof json.error === 'string' && /access|plan|rate|subscri|unavailable/i.test(json.error));
      if (blocked) {
        lastDetail = json?.error || `HTTP ${response.status}`;
        continue;
      }
      // A valid quote has current price `c`; empty object `{}` means unknown symbol.
      if (!json || typeof json.c !== 'number') {
        lastDetail = 'no quote';
        continue;
      }
      // Quotes must never be HTTP-cached by the browser — the /ledger
      // live re-marking depends on freshness.
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'no-store');
      return res.status(response.status).json({ finnhubStatus: response.status, body: raw });
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  res.status(502).json({
    error: 'All Finnhub keys failed or lack access',
    detail: lastDetail,
  });
});

// --- stockanalysis.com earnings proxy --------------------------------
// GET /api/earnings/stockanalysis?symbol=AAPL
// Keyless backup for the /hedge-fund PEAD page. stockanalysis.com exposes
// per-quarter EPS actual/estimate/surprise as JSON (no API key needed), which
// works even when Yahoo's crumb and Finnhub keys are blocked or rate-limited.
app.get('/api/earnings/stockanalysis', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const url = `https://stockanalysis.com/api/symbol/s/${encodeURIComponent(symbol)}/earnings/`;
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timer);
    const raw = await response.text();
    res.set('Access-Control-Allow-Origin', '*');
    res.status(response.status).json({ status: response.status, body: raw });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'stockanalysis fetch failed', detail: msg });
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

// --- Open Cabinet (OGE presidential financial disclosures) ----------
// GET /api/politician-trades/opencabinet?politician=Trump
// Fetches the full CSV from open-cabinet.org/data/all-transactions.csv
// and filters by official_name. Returns stock trades only (excludes bonds/muni).

function parseAmountRangeOC(s) {
  const clean = (v) => Number(v.replace(/[^0-9.]/g, '')) || null;
  if (!s) return { from: null, to: null };
  const parts = s.split(/\s*[-–]\s*/);
  if (parts.length === 2) return { from: clean(parts[0]), to: clean(parts[1]) };
  return { from: clean(s), to: null };
}

app.get('/api/politician-trades/opencabinet', async (req, res) => {
  const politician = (req.query.politician || 'Trump').toLowerCase();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const csvRes = await fetch('https://open-cabinet.org/data/all-transactions.csv', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timer);
    if (!csvRes.ok) return res.status(csvRes.status).json({ error: `OpenCabinet returned ${csvRes.status}` });

    const csv = await csvRes.text();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    if (!parsed.data || parsed.data.length === 0) return res.json({ trades: [], count: 0 });

    const trades = [];
    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i];
      const name = row.official_name || '';
      const title = row.official_title || '';
      const agency = row.agency || '';
      const description = row.description || '';
      const ticker = row.ticker || '';
      const type = row.type || '';
      const date = row.date || '';
      const amountRange = row.amount_range || '';
      const amountMidpoint = row.amount_midpoint || '';
      const lateFiling = row.late_filing || '';
      const sourceUrl = row.source_filing_url || '';

      if (!name) continue;
      const csvNameLower = name.toLowerCase();
      const polLower = politician.toLowerCase();
      const nameParts = csvNameLower.replace(/"/g, '').split(',').map(s => s.trim());
      const lastName = nameParts[0] || '';
      const firstName = nameParts[1] || '';
      const matches = csvNameLower.includes(polLower)
        || polLower.includes(lastName)
        || polLower.includes(firstName);
      if (!matches) continue;
      if (!ticker || ticker === '' || ticker === 'N/A') continue;
      const tickerUpper = ticker.toUpperCase();
      if (tickerUpper === 'THE' || tickerUpper.length <= 1) continue;
      const desc = description.toLowerCase();
      if (desc.includes('bond') || desc.includes('muni') || desc.includes('note ') || desc.includes('b/e ')) continue;
      const tt = type.toLowerCase();
      let side = 'OTHER';
      if (tt === 'purchase') side = 'BUY';
      else if (tt === 'sale') side = 'SELL';
      else if (tt === 'exchange') side = 'EXCHANGE';
      const { from, to } = parseAmountRangeOC(amountRange);
      const normalizedPol = name.replace(/[".]/g, '').split(',').map(s => s.trim()).reverse().join(' ').trim();
      trades.push({
        id: `oc-${i}`,
        politician: normalizedPol,
        symbol: ticker,
        transaction_type: side,
        transaction_date: date.slice(0, 10),
        filing_date: null,
        amount_from: from || (amountMidpoint ? Number(String(amountMidpoint).replace(/[^0-9.]/g, '')) || null : null),
        amount_to: to,
        asset_name: description || null,
        source_name: 'opencabinet',
        source_url: sourceUrl || null,
        metadata: { title, agency, late_filing: lateFiling === 'yes' },
      });
    }
    trades.sort((a, b) => (b.transaction_date || '').localeCompare(a.transaction_date || ''));
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ trades, count: trades.length, total_in_csv: parsed.data.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Failed to fetch from OpenCabinet', detail: msg });
  }
});

// --- Diagnostic: check Open Cabinet Trump trade count ----------
app.get('/api/diag/opencabinet', async (req, res) => {
  try {
    const csvRes = await fetch('https://open-cabinet.org/data/all-transactions.csv', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const csv = await csvRes.text();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const allTrump = parsed.data.filter(r => {
      const name = (r.official_name || '').toLowerCase();
      return name.includes('trump') && !name.includes('melania') && !name.includes('ivanka');
    });
    const withTicker = allTrump.filter(r => r.ticker && r.ticker !== '' && r.ticker !== 'N/A');
    const withoutTicker = allTrump.filter(r => !r.ticker || r.ticker === '' || r.ticker === 'N/A');
    const tickers = [...new Set(withTicker.map(r => r.ticker))];
    res.json({
      total_csv_rows: parsed.data.length,
      trump_total: allTrump.length,
      trump_with_ticker: withTicker.length,
      trump_without_ticker: withoutTicker.length,
      unique_tickers: tickers.sort(),
      sample_trades: withTicker.slice(0, 5).map(r => ({
        name: r.official_name,
        ticker: r.ticker,
        desc: r.description,
        type: r.type,
        date: r.date,
        amount: r.amount_range,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

// --- Server-managed Supabase cloud-sync config ----------------------
// Set SUPABASE_URL + SUPABASE_ANON_KEY on Render to configure Cloud Sync ONCE
// for every browser/machine — no per-browser input needed. When unset the API
// 404s and the app falls back to per-browser Settings.
const SUPABASE_URL_ENV = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY_ENV = process.env.SUPABASE_ANON_KEY || '';
app.get('/api/sync-config', (req, res) => {
  if (!SUPABASE_URL_ENV || !SUPABASE_ANON_KEY_ENV) {
    res.status(404).json({ enabled: false });
    return;
  }
  res.json({
    url: SUPABASE_URL_ENV,
    anonKey: SUPABASE_ANON_KEY_ENV,
    enabled: process.env.SUPABASE_SYNC_ENABLED ? process.env.SUPABASE_SYNC_ENABLED !== 'false' : true,
  });
});

// --- Server-managed API-key config (secret-free bundle) --------------
// The dist bundle is committed to git, so client env vars (VITE_*) would leak
// secrets into the repo (GitHub push protection blocks them). Instead, keys
// live ONLY as Render env vars and are served to browsers at runtime.
// Set ADANOS_API_KEY on Render to enable the Adanos sentiment source for
// every browser — no per-browser input needed. Unset -> omitted, and the app
// falls back to per-browser Settings (API Keys -> Adanos).
const ADANOS_API_KEY_ENV = process.env.ADANOS_API_KEY || '';
app.get('/api/api-keys', (req, res) => {
  res.json(ADANOS_API_KEY_ENV ? { adanosApiKey: ADANOS_API_KEY_ENV } : {});
});

// --- Server-managed edge-function endpoint (for the Screener / News
//     features that call Supabase edge functions directly) -------------
// EDGE_FN_URL / EDGE_FN_KEY on Render point at the Supabase project hosting
// the compute functions (stock-data, analyze-news-sentiment, social-sentiment,
// asymmetric-value-screener). The key is the project's PUBLIC anon key, so
// serving it to browsers is safe. Unset -> 404, and the app falls back to
// per-browser Settings (Cloud Sync values) or disables those panels.
const EDGE_FN_URL_ENV = process.env.EDGE_FN_URL || '';
const EDGE_FN_KEY_ENV = process.env.EDGE_FN_KEY || '';
app.get('/api/edge-config', (req, res) => {
  if (!EDGE_FN_URL_ENV || !EDGE_FN_KEY_ENV) {
    res.status(404).json({ enabled: false });
    return;
  }
  res.json({
    url: EDGE_FN_URL_ENV,
    anonKey: EDGE_FN_KEY_ENV,
  });
});

// ─── Simulated traders ledger (server-authoritative) ────────────────────
// The simulate-ledger edge fn is the ONLY writer. These endpoints proxy it
// so the browser never needs (or sees) the x-cron-secret.

const LEDGER_FN_BASE = 'https://aqyaarnpmvvdzasjefje.supabase.co/functions/v1';

function ledgerFnHeaders() {
  const secret = process.env.CRON_SECRET || '';
  return { 'Content-Type': 'application/json', ...(secret ? { 'x-cron-secret': secret } : {}) };
}

async function callLedgerFn(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(`${LEDGER_FN_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: ledgerFnHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { status: res.status, body: parsed ?? text };
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/ledger/status — latest session + whether it's simulated.
app.get('/api/ledger/status', async (req, res) => {
  try {
    const r = await callLedgerFn('/simulate-ledger', { });
    if (r.status !== 200) return res.status(502).json({ error: 'simulate-ledger call failed', status: r.status, detail: r.body });
    res.json(r.body);
  } catch (err) {
    res.status(502).json({ error: 'simulate-ledger unreachable', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/ledger/rerun — clear the latest simulated session (cloud) and
// re-simulate it server-side. This is the only re-run path; the browser is a
// viewer and never recomputes fills.
app.post('/api/ledger/rerun', async (req, res) => {
  try {
    const r = await callLedgerFn('/simulate-ledger', { rerun: true });
    if (r.status !== 200) return res.status(502).json({ error: 'simulate-ledger rerun failed', status: r.status, detail: r.body });
    res.json(r.body);
  } catch (err) {
    res.status(502).json({ error: 'simulate-ledger unreachable', detail: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/ledger — the full cloud ledger (viewer pull for /ledger mount).
app.get('/api/ledger', async (req, res) => {
  try {
    const cfgRes = await fetch(`https://aqyaarnpmvvdzasjefje.supabase.co/rest/v1/stockpulse_kv?key=eq.stockpulse_trade_ledger&select=value`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || '',
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY || ''}`,
      },
    });
    if (!cfgRes.ok) return res.status(cfgRes.status).json({ error: 'Supabase KV read failed' });
    const rows = await cfgRes.json();
    if (!rows?.length) return res.json({ ledger: null });
    res.json({ ledger: JSON.parse(rows[0].value) });
  } catch (err) {
    res.status(502).json({ error: 'Supabase unreachable', detail: err instanceof Error ? err.message : String(err) });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
  });
}

// Vercel serverless — @vercel/node invokes the Express app directly.
// (Bound to /index.js via vercel.json; static dist/ and the SPA fallback
// are served through Express just like on Render.)
export default app;