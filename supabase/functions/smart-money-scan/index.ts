// Deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: smart-money-scan
//
// Daily background scan that keeps the Smart Money Screener (Option B, index
// universes) warm so the page opens instantly with zero browser API traffic.
//
// Runs in three independent, time-boxed legs (each leg is its own cron entry
// so a slow SEC leg can never starve the quote leg):
//
//   quotes    ~01:30 UTC  batch quotes (price/change/mcap/name) + short
//                         interest for the top-125 by cached score + a
//                         congress bulk read (own DB, ~12 REST calls).
//                         ~10 + ~125 Yahoo calls, paced.
//   insider   ~02:30 UTC  SEC Form 4 bucket: up to 85 un-scanned/stale
//                         symbols. Full 500-symbol coverage accrues over ~6
//                         runs, then self-maintains past the 30d TTL.
//   weekly    Mon 03:30   13F (10 fast managers) — flat cost regardless of
//                         universe size; quarterly filings don't justify a
//                         daily re-fetch.
//
// Writes ONE row per run to public.smart_money_scan_rows keyed
// (universe, symbol). The page reads the freshest row per symbol and, while
// a leg is still filling in (first ~6 days after deploy), falls back to its
// own interactive scan for symbols this fn hasn't reached yet.
//
// NOTE: the pure scoring/fetch helpers below are ported from
// src/lib/smartMoney.ts (browser) + src/lib/funds13f.ts. Deno cannot import
// those (browser-path `fetch` + DOMParser), so they are duplicated here.
// When you change a threshold or parser, change BOTH files — see AGENTS.md.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildIndexUnion, type DenoMember } from './universe.ts';

// ── Auth ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true; // no secret configured -> open
  return req.headers.get('x-cron-secret') === secret;
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Constants (mirror src/lib/smartMoney.ts — keep in sync) ─────────────────

const INSIDER_LOOKBACK_DAYS = 60;
const INSIDER_MIN_TRADE = 100_000;
const INSIDER_CLUSTER_MIN_BUYERS = 3;
const INSIDER_CLUSTER_MIN_VALUE = 500_000;
const CONGRESS_LOOKBACK_DAYS = 365;
const FORM4_SCAN_CAP = 20;
const CONGRESS_PAGE_LIMIT = 1000;
const INSIDER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — matches page
const INSIDER_BUCKET = 85;                       // symbols per insider leg
const TIME_BUDGET_MS = 110_000;                  // edge-fn wall-clock guard per leg (AVS pattern)
const SQUEEZE_TOP_N = 125;
const BATCH_QUOTE_CHUNK = 50;
const SEC_UA = 'StockPulse smart-money-scan research bot (contact: research@stockpulse.local)';
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 10 managers whose latest 13F info tables are small enough to parse in a
// scan run (mirror FAST_13F_CIKS in smartMoney.ts).
const FAST_MANAGERS = [
  { cik: 1067983, name: 'Berkshire Hathaway' },
  { cik: 1350694, name: 'Bridgewater' },
  { cik: 1061768, name: 'Baupost' },
  { cik: 1336528, name: 'Pershing Square' },
  { cik: 1649339, name: 'Scion' },
  { cik: 1029160, name: 'Soros' },
  { cik: 1167483, name: 'Tiger Global' },
  { cik: 1079114, name: 'Greenlight' },
  { cik: 1061165, name: 'Lone Pine' },
  { cik: 1135730, name: 'Coatue' },
];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Types (mirror SmartMoneyRow + signal interfaces) ────────────────────────

interface InsiderBuy { owner: string; title: string; value: number; date: string; senior: boolean }
interface InsiderSignal { score: number; buys: InsiderBuy[]; totalValue: number; distinctBuyers: number }
interface InstitutionHolding { manager: string; issuer: string; value: number; shares: number }
interface InstitutionalSignal { score: number; holdings: InstitutionHolding[] }
interface CongressSignal { score: number; buys: number; sells: number; latestDate: string | null }
interface SqueezeSignal { score: number; shortPercentOfFloat: number | null; shortRatio: number | null }
interface CongressSourceTrade { symbol: string; transaction_type: string; transaction_date: string }
interface QuoteShort {
  price: number | null; changePercent: number | null; marketCap: number | null;
  shortPercentOfFloat: number | null; shortRatio: number | null;
}

// ── Pure scoring (mirror smartMoney.ts) ─────────────────────────────────────

function computeInsiderScore(buys: InsiderBuy[]): InsiderSignal {
  const qualifying = buys.filter(b => b.value >= INSIDER_MIN_TRADE);
  const totalValue = qualifying.reduce((s, b) => s + b.value, 0);
  const distinctBuyers = new Set(qualifying.map(b => b.owner)).size;
  let score = 0;
  if (distinctBuyers >= INSIDER_CLUSTER_MIN_BUYERS && totalValue >= INSIDER_CLUSTER_MIN_VALUE) score = 25;
  else if (qualifying.length >= 1) score = 15;
  return { score, buys: qualifying, totalValue, distinctBuyers };
}

function computeInstitutionalScore(holdings: InstitutionHolding[]): InstitutionalSignal {
  const n = new Set(holdings.map(h => h.manager)).size;
  let score = 0;
  if (n >= 3) score = 25;
  else if (n === 2) score = 20;
  else if (n === 1) score = 15;
  return { score, holdings };
}

function congressType(raw: string): 'BUY' | 'SELL' | 'OTHER' {
  const t = String(raw ?? '').toUpperCase();
  if (t.includes('BUY') || t.includes('PURCHASE')) return 'BUY';
  if (t.includes('SELL') || t.includes('SALE')) return 'SELL';
  return 'OTHER';
}

function computeCongressScore(trades: CongressSourceTrade[]): CongressSignal {
  const mapped = trades.map(t => ({
    type: congressType(t.transaction_type),
    date: String(t.transaction_date ?? '').slice(0, 10),
  }));
  const buys = mapped.filter(t => t.type === 'BUY').length;
  const sells = mapped.filter(t => t.type === 'SELL').length;
  const latestDate = mapped.reduce<string | null>(
    (latest, t) => (t.date && (!latest || t.date > latest) ? t.date : latest),
    null,
  );
  let score = 0;
  if (buys > 0) score = 20;
  else if (sells > 0) score = 8;
  return { score, buys, sells, latestDate };
}

function computeSqueezeScore(spf: number | null, sr: number | null): SqueezeSignal {
  let score = 0;
  if (typeof spf === 'number' && spf > 0) {
    if (spf >= 20) score = 30;
    else if (spf >= 10) score = 20;
    else if (spf >= 5) score = 10;
  }
  return { score, shortPercentOfFloat: spf, shortRatio: sr };
}

function totalScore(ins: InsiderSignal, inst: InstitutionalSignal, cong: CongressSignal, sqz: SqueezeSignal): number {
  return ins.score + inst.score + cong.score + sqz.score;
}

function classify(score: number): 'Strong' | 'Watch' | 'Light' | 'None' {
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Watch';
  if (score > 0) return 'Light';
  return 'None';
}

function capTierFromMarketCap(mcap: number | null | undefined): string {
  if (typeof mcap !== 'number' || !Number.isFinite(mcap) || mcap <= 0) return 'large';
  if (mcap >= 200e9) return 'mega';
  if (mcap >= 10e9) return 'large';
  if (mcap >= 2e9) return 'mid';
  return 'small';
}

// ── 13F issuer-name matching (mirror smartMoney.ts) ─────────────────────────

const ISSUER_SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED',
  'PLC', 'THE', 'GROUP', 'HOLDINGS', 'HOLDING', 'SA', 'AG', 'NV', 'COM', 'CL', 'CLASS', 'A', 'B', 'C', 'AND',
]);

function normalizeIssuerName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/)
    .filter(t => t && !ISSUER_SUFFIXES.has(t)).join(' ').trim();
}

function matchUniverseByIssuer(issuer: string, universe: readonly DenoMember[]): string | null {
  const norm = normalizeIssuerName(issuer);
  if (norm.length < 4) return null;
  for (const u of universe) {
    const target = normalizeIssuerName(u.name);
    if (target.length < 4) continue;
    if (norm === target || norm.startsWith(target) || target.startsWith(norm)) return u.symbol;
  }
  return null;
}

// ── SEC EDGAR (direct, declared UA — mirrors /api/edgar) ────────────────────

async function secFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json,*/*' } });
  } catch {
    return null;
  }
}

async function secJson<T>(url: string): Promise<T | null> {
  const r = await secFetch(url);
  if (!r || !r.ok) return null;
  try { return await r.json() as T; } catch { return null; }
}

async function secText(url: string): Promise<string | null> {
  const r = await secFetch(url);
  if (!r || !r.ok) return null;
  try { return await r.text(); } catch { return null; }
}

// ticker -> CIK (SEC uses hyphen share classes: BRK-B)
let tickerCikMap: Map<string, string> | null = null;
async function fetchTickerCikMap(): Promise<Map<string, string>> {
  if (tickerCikMap) return tickerCikMap;
  const json = await secJson<Record<string, { cik_str?: number; ticker?: string }>>(
    'https://www.sec.gov/files/company_tickers.json',
  );
  const map = new Map<string, string>();
  if (json) {
    for (const k of Object.keys(json)) {
      const row = json[k];
      if (row?.ticker && row.cik_str) map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'));
    }
  }
  tickerCikMap = map;
  return map;
}

// ── Form 4 parsing (mirror parseForm4 / edgarPrimaryDocPath) ────────────────

function textBetween(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function edgarPrimaryDocPath(primaryDocument: string): string {
  return primaryDocument.replace(/^xsl\w+\//, '');
}

function parseForm4(xml: string): InsiderBuy | null {
  const owner = textBetween(xml, 'rptOwnerName') || 'Unknown';
  const isOfficer = /<isOfficer>\s*(1|true)\s*<\/isOfficer>/i.test(xml);
  const isDirector = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(xml);
  const title = (textBetween(xml, 'officerTitle') || (isDirector ? 'Director' : 'Insider')).slice(0, 60);

  let value = 0;
  let date = '';
  const txBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || [];
  for (const block of txBlocks) {
    const code = block.match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/)?.[1];
    if (code !== 'P') continue;
    const acq = block.match(/<transactionAcquiredDisposedCode>[\s\S]*?<value>\s*([AD])\s*<\/value>/)?.[1];
    if (acq !== 'A') continue;
    const shares = Number(block.match(/<transactionShares>[\s\S]*?<value>\s*([\d.]+)\s*<\/value>/)?.[1] ?? 0);
    const price = Number(block.match(/<transactionPricePerShare>[\s\S]*?<value>\s*([\d.]+)\s*<\/value>/)?.[1] ?? 0);
    const d = block.match(/<transactionDate>[\s\S]*?<value>\s*([\d-]+)\s*<\/value>/)?.[1] ?? '';
    if (shares > 0 && price > 0) {
      value += shares * price;
      if (!date) date = d;
    }
  }
  if (value <= 0) return null;
  const senior = /chief|ceo|cfo|coo|president/i.test(title);
  return { owner, title, value, date, senior };
}

/** Scan one company's recent Form 4s for open-market "P" purchases. */
async function fetchInsiderBuys(cik: string): Promise<InsiderBuy[] | null> {
  const submissions = await secJson<{
    filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; primaryDocument?: string[] } };
  }>(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return null;

  const cutoff = Date.now() - INSIDER_LOOKBACK_DAYS * 24 * 3600 * 1000;
  const targets: { acc: string; doc: string }[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== '4') continue;
    if (new Date(recent.filingDate?.[i] ?? '').getTime() < cutoff) continue;
    targets.push({
      acc: String(recent.accessionNumber?.[i] ?? '').replace(/-/g, ''),
      doc: edgarPrimaryDocPath(recent.primaryDocument?.[i] ?? ''),
    });
    if (targets.length >= FORM4_SCAN_CAP) break;
  }

  const cikNum = String(Number(cik));
  const buys: InsiderBuy[] = [];
  for (let i = 0; i < targets.length; i += 4) {
    const chunk = targets.slice(i, i + 4);
    const parsed = await Promise.all(chunk.map(async t => {
      const xml = await secText(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${t.acc}/${t.doc}`);
      return xml ? parseForm4(xml) : null;
    }));
    for (const p of parsed) if (p) buys.push(p);
    if (i + 4 < targets.length) await sleep(500); // ~8 req/s SEC fair-access pace
  }
  return buys;
}

// ── 13F parsing (mirror funds13f.ts: pick13fFilings / pickInfoTableFile / parseInfoTable) ──

function pick13fFilings(submissions: any): { accession: string; filingDate: string; primaryDocument: string } | null {
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return null;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] === '13F-HR') {
      return {
        accession: recent.accessionNumber?.[i] ?? '',
        filingDate: recent.filingDate?.[i] ?? '',
        primaryDocument: recent.primaryDocument?.[i] ?? '',
      };
    }
  }
  return null;
}

function pickInfoTableFile(indexJson: any, primaryDocument: string): string | null {
  const items = indexJson?.directory?.item ?? [];
  const primaryName = primaryDocument.split('/').pop() ?? primaryDocument;
  const xmls = items.map((i: any) => i.name ?? '').filter((n: string) => n.toLowerCase().endsWith('.xml') && n !== primaryName);
  if (!xmls.length) return null;
  return xmls.find((n: string) => /info|table/i.test(n)) ?? xmls[0];
}

function valueScaleFor(filingDate: string): 1 | 1000 {
  return filingDate >= '2023-01-03' ? 1 : 1000;
}

// Deno has no DOMParser — parse the info table with regex (namespace-agnostic).
function parseInfoTable(xmlText: string): { issuer: string; value: number; shares: number }[] | null {
  if (!/<infoTable[\s>]/.test(xmlText)) return null;
  const rows: { issuer: string; value: number; shares: number }[] = [];
  const blocks = xmlText.match(/<infoTable[\s\S]*?<\/infoTable>/g) || [];
  for (const b of blocks) {
    const cusip = textBetween(b, 'cusip');
    if (!cusip) continue;
    const issuer = (textBetween(b, 'nameOfIssuer') || '').toUpperCase();
    const value = Number((textBetween(b, 'value') ?? '').replace(/,/g, '')) || 0;
    const shares = Number((textBetween(b, 'sshPrnamt') ?? '').replace(/,/g, '')) || 0;
    rows.push({ issuer, value, shares });
  }
  return rows;
}

async function fetchManager13f(cik: number): Promise<{ positions: { issuer: string; value: number; shares: number }[] } | null> {
  const submissions = await secJson<any>(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
  if (!submissions) return null;
  const filing = pick13fFilings(submissions);
  if (!filing) return null;

  const acc = filing.accession.replace(/-/g, '');
  const indexJson = await secJson<any>(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/index.json`);
  if (!indexJson) return null;
  const infoTable = pickInfoTableFile(indexJson, filing.primaryDocument);
  if (!infoTable) return null;

  const xml = await secText(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${infoTable}`);
  if (!xml) return null;
  const rows = parseInfoTable(xml);
  if (!rows || rows.length === 0) return null;
  const scale = valueScaleFor(filing.filingDate);
  return { positions: rows.map(r => ({ ...r, value: r.value * scale })) };
}

// ── Yahoo (crumb'd v7/v10 — mirrors index.js proxies) ───────────────────────

let yahooSession: { crumb: string; cookie: string; expiry: number } | null = null;

async function getYahooSession(): Promise<{ crumb: string; cookie: string }> {
  if (yahooSession && Date.now() < yahooSession.expiry) {
    return { crumb: yahooSession.crumb, cookie: yahooSession.cookie };
  }
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': YAHOO_UA },
    redirect: 'manual',
  });
  const cookieHeader = cookieRes.headers.get('set-cookie') || '';
  if (!cookieHeader) throw new Error('No session cookie from fc.yahoo.com');
  const cookie = cookieHeader.split(';')[0];
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': YAHOO_UA, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`getcrumb failed: ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length <= 2 || crumb.includes('error')) throw new Error('Invalid crumb');
  yahooSession = { crumb, cookie, expiry: Date.now() + 30 * 60 * 1000 };
  return { crumb, cookie };
}

function invalidateYahooSession() {
  yahooSession = null;
}

async function fetchBatchQuotes(symbols: string[]): Promise<Map<string, { price: number | null; changePercent: number | null; marketCap: number | null; name: string | null }>> {
  const out = new Map<string, { price: number | null; changePercent: number | null; marketCap: number | null; name: string | null }>();
  const list = [...new Set(symbols)];
  for (let i = 0; i < list.length; i += BATCH_QUOTE_CHUNK) {
    const chunk = list.slice(i, i + BATCH_QUOTE_CHUNK);
    for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
      try {
        const { crumb, cookie } = await getYahooSession();
        const url = `${host}/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(crumb)}`;
        const r = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookie } });
        if (r.ok) {
          const body = await r.json();
          const results = Array.isArray(body?.quoteResponse?.result) ? body.quoteResponse.result : [];
          for (const row of results) {
            if (!row?.symbol) continue;
            out.set(row.symbol, {
              price: typeof row.regularMarketPrice === 'number' ? row.regularMarketPrice : null,
              changePercent: typeof row.regularMarketChangePercent === 'number' ? row.regularMarketChangePercent : null,
              marketCap: typeof row.marketCap === 'number' ? row.marketCap : null,
              name: typeof row.longName === 'string' ? row.longName : null,
            });
          }
          break;
        }
        invalidateYahooSession();
      } catch { invalidateYahooSession(); }
    }
    if (i + BATCH_QUOTE_CHUNK < list.length) await sleep(400);
  }
  return out;
}

async function fetchQuoteShort(symbol: string): Promise<QuoteShort> {
  const empty: QuoteShort = { price: null, changePercent: null, marketCap: null, shortPercentOfFloat: null, shortRatio: null };
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const { crumb, cookie } = await getYahooSession();
      const url = `${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`;
      const r = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookie } });
      if (r.ok) {
        const data = await r.json();
        const q = data?.quoteSummary?.result?.[0];
        if (!q) return empty;
        const spf = q.defaultKeyStatistics?.shortPercentOfFloat?.raw;
        const sr = q.defaultKeyStatistics?.shortRatio?.raw;
        return {
          price: typeof q.price?.regularMarketPrice?.raw === 'number' ? q.price.regularMarketPrice.raw : null,
          changePercent: typeof q.price?.regularMarketChangePercent?.raw === 'number' ? q.price.regularMarketChangePercent.raw : null,
          marketCap: typeof q.summaryDetail?.marketCap?.raw === 'number' ? q.summaryDetail.marketCap.raw : null,
          shortPercentOfFloat: typeof spf === 'number' ? spf * 100 : null, // Yahoo reports a fraction
          shortRatio: typeof sr === 'number' ? sr : null,
        };
      }
      invalidateYahooSession();
    } catch { invalidateYahooSession(); }
  }
  return empty;
}

// ── Congress (bulk monthly windows — mirror fetchCongressTradesBulk) ────────

async function fetchCongressTradesBulk(): Promise<Map<string, CongressSourceTrade[]>> {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();
  const start = new Date(now - CONGRESS_LOOKBACK_DAYS * 24 * 3600 * 1000);

  const windows: { from: Date; to: Date }[] = [];
  let cursor = new Date(start);
  while (cursor.getTime() < now) {
    const to = new Date(cursor.getTime());
    to.setMonth(to.getMonth() + 1);
    if (to.getTime() > now) to.setTime(now);
    windows.push({ from: new Date(cursor), to });
    cursor = to;
  }

  const all: CongressSourceTrade[] = [];
  async function pull(from: Date, to: Date, depth = 0): Promise<void> {
    if (from.getTime() >= to.getTime()) return;
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('politician_trades')
      .select('symbol,transaction_type,transaction_date')
      .gte('transaction_date', fromIso)
      .lt('transaction_date', toIso)
      .limit(CONGRESS_PAGE_LIMIT);
    const rows = (data ?? []) as CongressSourceTrade[];
    if (!error && rows.length >= CONGRESS_PAGE_LIMIT && depth < 6) {
      const mid = new Date((from.getTime() + to.getTime()) / 2);
      await pull(from, mid, depth + 1);
      await pull(mid, to, depth + 1);
    } else if (!error) {
      all.push(...rows);
    }
  }
  for (let i = 0; i < windows.length; i += 4) {
    await Promise.all(windows.slice(i, i + 4).map(w => pull(w.from, w.to)));
    if (i + 4 < windows.length) await sleep(100);
  }

  const out = new Map<string, CongressSourceTrade[]>();
  for (const row of all) {
    const sym = String(row.symbol ?? '').toUpperCase();
    if (!sym) continue;
    const list = out.get(sym);
    if (list) list.push(row); else out.set(sym, [row]);
  }
  return out;
}

// ── Universe + persistence helpers ──────────────────────────────────────────

// The daily background scan always runs the full index union (S&P 500 ∪
// NDX). The curated 41 stays interactive-only on the page — it is cheap to
// scan in a browser and isn't scheduled here.
const UNIVERSE = buildIndexUnion();

interface StoredRow {
  universe: string;
  symbol: string;
  name: string;
  sector: string;
  cap_tier: string;
  price: number | null;
  change_percent: number | null;
  market_cap: number | null;
  insider: InsiderSignal;
  institutional: InstitutionalSignal;
  congress: CongressSignal;
  squeeze: SqueezeSignal;
  score: number;
  classification: string;
  insider_pending: boolean;
  squeeze_loaded: boolean;
  leg: string;
  scanned_at: string;
  /** Freshness of the insider signal only — the other legs rewrite rows
   *  daily, so insider staleness must not key off scanned_at. */
  insider_scanned_at: string | null;
}

type SupabaseClient = ReturnType<typeof createClient>;

async function loadExistingRows(supabase: SupabaseClient, universe: string): Promise<Map<string, StoredRow>> {
  const { data } = await supabase
    .from('smart_money_scan_rows')
    .select('*')
    .eq('universe', universe);
  const map = new Map<string, StoredRow>();
  for (const r of (data ?? []) as StoredRow[]) map.set(r.symbol, r);
  return map;
}

async function upsertRows(supabase: SupabaseClient, rows: StoredRow[]): Promise<number> {
  let ok = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase
      .from('smart_money_scan_rows')
      .upsert(chunk, { onConflict: 'universe,symbol' });
    if (error) {
      console.error('[smart-money-scan] upsert error:', error.message);
    } else {
      ok += chunk.length;
    }
  }
  return ok;
}

function buildRow(
  u: DenoMember,
  leg: string,
  insider: InsiderSignal,
  institutional: InstitutionalSignal,
  congress: CongressSignal,
  squeeze: SqueezeSignal,
  q: QuoteShort | null,
  capTier: string,
  insiderPending: boolean,
  squeezeLoaded: boolean,
): StoredRow {
  const score = totalScore(insider, institutional, congress, squeeze);
  return {
    universe: 'index',
    symbol: u.symbol,
    name: u.name,
    sector: u.sector,
    cap_tier: capTier,
    price: q?.price ?? null,
    change_percent: q?.changePercent ?? null,
    market_cap: q?.marketCap ?? null,
    insider,
    institutional,
    congress,
    squeeze,
    score,
    classification: classify(score),
    insider_pending: insiderPending,
    squeeze_loaded: squeezeLoaded,
    leg,
    scanned_at: new Date().toISOString(),
  };
}

// ── Legs ────────────────────────────────────────────────────────────────────

/** Leg "quotes": batch quotes for all 500 + short interest for top-N. */
async function legQuotes(supabase: SupabaseClient): Promise<unknown> {
  const started = Date.now();
  const existing = await loadExistingRows(supabase, 'index');
  const symbols = UNIVERSE.map(u => u.symbol);

  const batch = await fetchBatchQuotes(symbols);

  // Rank by the cached score so short interest lands on the names that
  // actually matter this run (not the whole 500). Rows without squeeze data
  // yet are also eligible (score 0 on a cold start), so coverage fills in
  // progressively across runs: loaded rows drop out of this filter.
  const candidates = UNIVERSE
    .map(u => ({ symbol: u.symbol, score: existing.get(u.symbol)?.score ?? 0, hasSqueeze: existing.get(u.symbol)?.squeeze_loaded ?? false }))
    .filter(c => c.score > 0 || !c.hasSqueeze)
    .sort((a, b) => b.score - a.score)
    .slice(0, SQUEEZE_TOP_N);

  const shortBySymbol = new Map<string, QuoteShort>();
  let sq = 0;
  for (const c of candidates) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    shortBySymbol.set(c.symbol, await fetchQuoteShort(c.symbol));
    sq++;
    await sleep(300); // ~3/s — Yahoo comfort zone
  }

  // Congress — bulk read of our own politician_trades table (~12 REST
  // calls), cheap enough to refresh daily alongside the quotes.
  const congressBySymbol = await fetchCongressTradesBulk();

  const now = new Date().toISOString();
  const rows: StoredRow[] = UNIVERSE.map(u => {
    const prev = existing.get(u.symbol);
    const b = batch.get(u.symbol);
    const s = shortBySymbol.get(u.symbol);
    const q: QuoteShort = {
      price: b?.price ?? prev?.price ?? null,
      changePercent: b?.changePercent ?? prev?.change_percent ?? null,
      marketCap: b?.marketCap ?? prev?.market_cap ?? null,
      shortPercentOfFloat: s?.shortPercentOfFloat ?? prev?.squeeze?.shortPercentOfFloat ?? null,
      shortRatio: s?.shortRatio ?? prev?.squeeze?.shortRatio ?? null,
    };
    const squeeze = computeSqueezeScore(q.shortPercentOfFloat, q.shortRatio);
    const insider = prev?.insider ?? computeInsiderScore([]);
    const institutional = prev?.institutional ?? computeInstitutionalScore([]);
    const congress = congressBySymbol.has(u.symbol)
      ? computeCongressScore(congressBySymbol.get(u.symbol) ?? [])
      : (prev?.congress ?? computeCongressScore([]));
    const capTier = b?.marketCap != null ? capTierFromMarketCap(b.marketCap) : (prev?.cap_tier ?? 'large');
    const score = totalScore(insider, institutional, congress, squeeze);
    return {
      universe: 'index',
      symbol: u.symbol,
      name: b?.name ?? u.name,
      sector: u.sector,
      cap_tier: capTier,
      price: q.price,
      change_percent: q.changePercent,
      market_cap: q.marketCap,
      insider,
      institutional,
      congress,
      squeeze,
      score,
      classification: classify(score),
      insider_pending: prev?.insider_pending ?? true,
      squeeze_loaded: q.shortPercentOfFloat != null || q.shortRatio != null,
      leg: 'quotes',
      scanned_at: now,
      insider_scanned_at: prev?.insider_scanned_at ?? null,
    } satisfies StoredRow;
  });

  const written = await upsertRows(supabase, rows);
  return { leg: 'quotes', universe: 'index', symbols: UNIVERSE.length, quotes: batch.size, shortInterest: sq, congressSymbols: congressBySymbol.size, written, budgetMs: Date.now() - started };
}

/** Leg "insider": SEC Form 4 bucket of up to INSIDER_BUCKET stale symbols. */
async function legInsider(supabase: SupabaseClient): Promise<unknown> {
  const existing = await loadExistingRows(supabase, 'index');
  const nowMs = Date.now();

  // Refresh whatever is missing first, then whatever is past the 30d
  // insider TTL. Key off insider_scanned_at (not scanned_at — the quotes
  // leg rewrites every row daily and would otherwise keep it "fresh").
  // Null = never scanned by the insider leg -> stale.
  const missing = UNIVERSE.filter(u => !existing.has(u.symbol));
  const stale = UNIVERSE
    .filter(u => {
      const prev = existing.get(u.symbol);
      if (!prev) return false;
      if (!prev.insider_scanned_at) return true;
      const stamp = Date.parse(prev.insider_scanned_at);
      return !Number.isFinite(stamp) || nowMs - stamp > INSIDER_TTL_MS;
    })
    .sort((a, b) => {
      const ta = existing.get(a.symbol)?.scanned_at ?? '';
      const tb = existing.get(b.symbol)?.scanned_at ?? '';
      return ta.localeCompare(tb);
    });

  const work = [...missing, ...stale].slice(0, INSIDER_BUCKET);
  if (!work.length) return { leg: 'insider', universe: 'index', scanned: 0, written: 0, remainingUnscanned: 0 };

  const cikMap = await fetchTickerCikMap();
  // An empty map means SEC's company_tickers.json fetch failed — bailing
  // out instead of marking every symbol "checked" with no data.
  if (!cikMap.size) {
    return { leg: 'insider', universe: 'index', scanned: 0, written: 0, error: 'SEC ticker map unavailable' };
  }
  const started = Date.now();
  const now = new Date().toISOString();
  const scannedSet = new Set<string>();
  let written = 0;

  // Flush inside the loop: a hard platform timeout must not lose the whole
  // bucket. Budget keeps the run inside the edge-fn wall-clock limit (same
  // pattern as the AVS fn's TIME_BUDGET_MS).
  for (const u of work) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const prev = existing.get(u.symbol);
    const cik = cikMap.get(u.symbol);
    const buys = cik ? await fetchInsiderBuys(cik) : null;
    const insider = computeInsiderScore(buys ?? []);
    const institutional = prev?.institutional ?? computeInstitutionalScore([]);
    const congress = prev?.congress ?? computeCongressScore([]);
    const squeeze = prev?.squeeze ?? computeSqueezeScore(null, null);
    const score = totalScore(insider, institutional, congress, squeeze);
    const row: StoredRow = {
      universe: 'index',
      symbol: u.symbol,
      name: prev?.name ?? u.name,
      sector: u.sector,
      cap_tier: prev?.cap_tier ?? 'large',
      price: prev?.price ?? null,
      change_percent: prev?.change_percent ?? null,
      market_cap: prev?.market_cap ?? null,
      insider,
      institutional,
      congress,
      squeeze,
      score,
      classification: classify(score),
      // cik missing: SEC has no filings for this symbol — nothing to wait
      // for. cik present but fetch failed: keep pending, next run retries.
      insider_pending: cik ? buys === null : false,
      squeeze_loaded: prev?.squeeze_loaded ?? false,
      leg: 'insider',
      scanned_at: now,
      // checked this run -> fresh. Exceptions: SEC has no CIK for the
      // symbol (nothing to ever scan -> fresh), or the fetch failed
      // (keep prior timestamp so the row stays stale and retries tomorrow).
      insider_scanned_at: cik && buys === null ? (prev?.insider_scanned_at ?? null) : now,
    } satisfies StoredRow;
    await upsertRows(supabase, [row]);
    written++;
    // A failed fetch leaves insider_scanned_at unchanged -> still stale.
    if (row.insider_scanned_at === now) scannedSet.add(u.symbol);
    await sleep(150); // keep total run well inside the edge-fn time limit
  }

  // Coverage metric: symbols whose row still has no fresh insider scan.
  const remaining = UNIVERSE.filter(u =>
    !scannedSet.has(u.symbol) && !existing.get(u.symbol)?.insider_scanned_at,
  ).length;
  return {
    leg: 'insider',
    universe: 'index',
    scanned: scannedSet.size,
    written,
    remainingUnscanned: remaining,
    budgetMs: Date.now() - started,
  };
}

/** Leg "weekly": 13F (10 managers) — quarterly filings don't justify a
 *  daily re-fetch; congress moves daily with the quotes leg instead. */
async function legWeekly(supabase: SupabaseClient): Promise<unknown> {
  const started = Date.now();
  const existing = await loadExistingRows(supabase, 'index');

  // 13F — 10 managers, ~3 EDGAR requests each.
  const instBySymbol = new Map<string, InstitutionHolding[]>();
  let attempted = 0;
  for (const m of FAST_MANAGERS) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    attempted++;
    const result = await fetchManager13f(m.cik);
    if (result) {
      for (const p of result.positions) {
        const sym = matchUniverseByIssuer(p.issuer, UNIVERSE);
        if (!sym) continue;
        const list = instBySymbol.get(sym);
        const holding: InstitutionHolding = { manager: m.name, issuer: p.issuer, value: p.value, shares: p.shares };
        if (list) list.push(holding); else instBySymbol.set(sym, [holding]);
      }
    }
    await sleep(300);
  }
  // Budget cut before attempting every manager = truncated data. Scoring a
  // full recompute off a partial manager set would zero out real holdings,
  // so keep the previous 13F result until a complete run lands.
  const complete = attempted === FAST_MANAGERS.length;

  const now = new Date().toISOString();
  const rows: StoredRow[] = UNIVERSE.map(u => {
    const prev = existing.get(u.symbol);
    // Full recompute over all 10 managers each run (same semantics as the
    // browser scan): a symbol absent from every manager legitimately scores 0.
    const institutional = complete
      ? computeInstitutionalScore(instBySymbol.get(u.symbol) ?? [])
      : (prev?.institutional ?? computeInstitutionalScore([]));
    const congress = prev?.congress ?? computeCongressScore([]);
    const insider = prev?.insider ?? computeInsiderScore([]);
    const squeeze = prev?.squeeze ?? computeSqueezeScore(null, null);
    const score = totalScore(insider, institutional, congress, squeeze);
    return {
      universe: 'index',
      symbol: u.symbol,
      name: prev?.name ?? u.name,
      sector: u.sector,
      cap_tier: prev?.cap_tier ?? 'large',
      price: prev?.price ?? null,
      change_percent: prev?.change_percent ?? null,
      market_cap: prev?.market_cap ?? null,
      insider,
      institutional,
      congress,
      squeeze,
      score,
      classification: classify(score),
      insider_pending: prev?.insider_pending ?? true,
      squeeze_loaded: prev?.squeeze_loaded ?? false,
      leg: 'weekly',
      scanned_at: now,
      insider_scanned_at: prev?.insider_scanned_at ?? null,
    } satisfies StoredRow;
  });

  const written = await upsertRows(supabase, rows);
  return { leg: 'weekly', universe: 'index', written, managers: attempted, complete, budgetMs: Date.now() - started };
}

// ── Entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);

  const started = Date.now();
  const url = new URL(req.url);
  const leg = url.searchParams.get('leg') ?? 'quotes';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // bypasses RLS
    );

    let result: unknown;
    if (leg === 'insider') result = await legInsider(supabase);
    else if (leg === 'weekly') result = await legWeekly(supabase);
    else result = await legQuotes(supabase);

    console.log(`[smart-money-scan] leg=${leg} elapsedMs=${Date.now() - started}`, JSON.stringify(result));
    return jsonRes({ ok: true, elapsedMs: Date.now() - started, result });
  } catch (e) {
    console.error('[smart-money-scan] fatal:', e instanceof Error ? e.message : e);
    return jsonRes({ ok: false, error: e instanceof Error ? e.message : 'scan failed' }, 500);
  }
});
