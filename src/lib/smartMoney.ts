/**
 * smartMoney.ts — Smart Money Screener (/smart-money)
 *
 * A rule-based composite screener over a curated 41-stock universe. Four
 * signals, each computed LIVE from public data (no AI/ML, no paid APIs):
 *
 *   1. Insider buying   — SEC Form 4 open-market "P" purchases ≥ $100K (60d)
 *   2. Institutional    — 13F-HR holdings of 10 fast-scan famous managers
 *   3. Congress         — STOCK Act disclosures (Kadoa feed, 45-day lag)
 *   4. Squeeze pressure — Yahoo shortPercentOfFloat + days-to-cover
 *
 * SEC traffic goes through /api/edgar (declared User-Agent, 1h cache).
 * 13F parsing reuses funds13f.ts. The Form 4 parser is ported from the
 * asymmetric-value-screener edge fn (same thresholds, browser-paced).
 */

import {
  MANAGERS,
  pick13fFilings,
  pickInfoTableFile,
  valueScaleFor,
  parseInfoTable,
  type RawPosition,
} from '@/lib/funds13f';
import { edgeRest } from '@/lib/edgeFn';

// ── Universe ─────────────────────────────────────────────────────────

export interface UniverseEntry {
  symbol: string;
  name: string;
  sector: string;
  capTier: 'mega' | 'large' | 'mid' | 'small';
}

export const UNIVERSE: readonly UniverseEntry[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', capTier: 'mega' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', capTier: 'mega' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', capTier: 'mega' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', capTier: 'mega' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', capTier: 'mega' },
  { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', capTier: 'mega' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer', capTier: 'mega' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', capTier: 'large' },
  { symbol: 'ORCL', name: 'Oracle Corp.', sector: 'Technology', capTier: 'large' },
  { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', capTier: 'large' },
  { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', capTier: 'large' },
  { symbol: 'INTC', name: 'Intel Corp.', sector: 'Technology', capTier: 'large' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', sector: 'Technology', capTier: 'large' },
  { symbol: 'SMCI', name: 'Super Micro Computer', sector: 'Technology', capTier: 'mid' },
  { symbol: 'MSTR', name: 'Strategy Inc.', sector: 'Technology', capTier: 'mid' },
  { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financials', capTier: 'mid' },
  { symbol: 'HOOD', name: 'Robinhood Markets', sector: 'Financials', capTier: 'mid' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', capTier: 'mega' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Financials', capTier: 'mega' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financials', capTier: 'large' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financials', capTier: 'mega' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', capTier: 'mega' },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', capTier: 'mega' },
  { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare', capTier: 'mega' },
  { symbol: 'MRNA', name: 'Moderna Inc.', sector: 'Healthcare', capTier: 'mid' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare', capTier: 'large' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy', capTier: 'mega' },
  { symbol: 'CVX', name: 'Chevron Corp.', sector: 'Energy', capTier: 'mega' },
  { symbol: 'OXY', name: 'Occidental Petroleum', sector: 'Energy', capTier: 'large' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrials', capTier: 'mega' },
  { symbol: 'BA', name: 'Boeing Co.', sector: 'Industrials', capTier: 'large' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'Industrials', capTier: 'mega' },
  { symbol: 'F', name: 'Ford Motor Co.', sector: 'Consumer', capTier: 'large' },
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer', capTier: 'mega' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', capTier: 'mega' },
  { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', capTier: 'mega' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', capTier: 'mega' },
  { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Communication', capTier: 'mega' },
  { symbol: 'DIS', name: 'Walt Disney Co.', sector: 'Communication', capTier: 'large' },
  { symbol: 'GME', name: 'GameStop Corp.', sector: 'Consumer', capTier: 'small' },
  { symbol: 'RIVN', name: 'Rivian Automotive', sector: 'Consumer', capTier: 'mid' },
] as const;

export const SECTORS: readonly string[] = ['All sectors', ...[...new Set(UNIVERSE.map(u => u.sector))].sort()];
export const CAP_TIERS: readonly string[] = ['All caps', 'mega', 'large', 'mid', 'small'];

// ── Scoring constants (documented on the page) ───────────────────────

export const INSIDER_LOOKBACK_DAYS = 60;
export const INSIDER_MIN_TRADE = 100_000;
export const INSIDER_CLUSTER_MIN_BUYERS = 3;
export const INSIDER_CLUSTER_MIN_VALUE = 500_000;
export const CONGRESS_LOOKBACK_DAYS = 365;
export const FORM4_SCAN_CAP = 20; // most-recent Form 4s scanned per company

// 10 managers whose latest 13F info tables are small enough to parse in a
// browser run (Vanguard/BlackRock/State Street/Citadel/Renaissance/Two Sigma
// files are multi-MB — those belong on the /funds screen, one at a time).
const FAST_13F_CIKS: ReadonlySet<number> = new Set([
  1067983, // Berkshire Hathaway
  1350694, // Bridgewater
  1061768, // Baupost
  1336528, // Pershing Square
  1649339, // Scion
  1029160, // Soros
  1167483, // Tiger Global
  1079114, // Greenlight
  1061165, // Lone Pine
  1135730, // Coatue
]);

export const FAST_MANAGERS = MANAGERS.filter(m => FAST_13F_CIKS.has(m.cik));

// ── Signal types ─────────────────────────────────────────────────────

export interface InsiderBuy {
  owner: string;
  title: string;
  value: number;
  date: string;
  senior: boolean;
}

export interface InsiderSignal {
  score: number;              // 0–25
  buys: InsiderBuy[];
  totalValue: number;
  distinctBuyers: number;
}

export interface InstitutionHolding {
  manager: string;
  issuer: string;
  value: number;              // dollars
  shares: number;
}

export interface InstitutionalSignal {
  score: number;              // 0–25
  holdings: InstitutionHolding[];
}

export type CongressTradeType = 'BUY' | 'SELL' | 'OTHER';

export interface CongressSignal {
  score: number;              // 0–20
  buys: number;
  sells: number;
  latestDate: string | null;
}

export interface SqueezeSignal {
  score: number;              // 0–30
  shortPercentOfFloat: number | null; // percent, e.g. 12.4
  shortRatio: number | null;          // days to cover
}

export interface SmartMoneyRow {
  symbol: string;
  name: string;
  sector: string;
  capTier: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  insider: InsiderSignal;
  institutional: InstitutionalSignal;
  congress: CongressSignal;
  squeeze: SqueezeSignal;
  score: number;              // 0–100
  classification: 'Strong' | 'Watch' | 'Light' | 'None';
  detailError: string | null; // soft-failure note for this row (e.g. quote missing)
}

// ── Pure scoring ─────────────────────────────────────────────────────

/** ≥3 distinct buyers and ≥$500K total → 25; any qualifying buy → 15; else 0. */
export function computeInsiderScore(buys: InsiderBuy[]): InsiderSignal {
  const qualifying = buys.filter(b => b.value >= INSIDER_MIN_TRADE);
  const totalValue = qualifying.reduce((s, b) => s + b.value, 0);
  const distinctBuyers = new Set(qualifying.map(b => b.owner)).size;
  let score = 0;
  if (distinctBuyers >= INSIDER_CLUSTER_MIN_BUYERS && totalValue >= INSIDER_CLUSTER_MIN_VALUE) score = 25;
  else if (qualifying.length >= 1) score = 15;
  return { score, buys: qualifying, totalValue, distinctBuyers };
}

/** ≥3 tracked managers → 25; 2 → 20; 1 → 15; 0 → 0. */
export function computeInstitutionalScore(holdings: InstitutionHolding[]): InstitutionalSignal {
  const managers = new Set(holdings.map(h => h.manager));
  const n = managers.size;
  let score = 0;
  if (n >= 3) score = 25;
  else if (n === 2) score = 20;
  else if (n === 1) score = 15;
  return { score, holdings };
}

/** Any disclosed buy in 12 months → 20; sells only → 8; none → 0. */
export function computeCongressScore(trades: { type: CongressTradeType; date: string }[]): CongressSignal {
  const buys = trades.filter(t => t.type === 'BUY').length;
  const sells = trades.filter(t => t.type === 'SELL').length;
  const latestDate = trades.reduce<string | null>(
    (latest, t) => (t.date && (!latest || t.date > latest) ? t.date : latest),
    null,
  );
  let score = 0;
  if (buys > 0) score = 20;
  else if (sells > 0) score = 8;
  return { score, buys, sells, latestDate };
}

/** Short % of float: ≥20% → 30; ≥10% → 20; ≥5% → 10; else 0. Null → 0. */
export function computeSqueezeScore(
  shortPercentOfFloat: number | null,
  shortRatio: number | null,
): SqueezeSignal {
  let score = 0;
  if (typeof shortPercentOfFloat === 'number' && shortPercentOfFloat > 0) {
    if (shortPercentOfFloat >= 20) score = 30;
    else if (shortPercentOfFloat >= 10) score = 20;
    else if (shortPercentOfFloat >= 5) score = 10;
  }
  return { score, shortPercentOfFloat, shortRatio };
}

export function totalScore(
  insider: InsiderSignal,
  institutional: InstitutionalSignal,
  congress: CongressSignal,
  squeeze: SqueezeSignal,
): number {
  return insider.score + institutional.score + congress.score + squeeze.score;
}

export function classify(score: number): SmartMoneyRow['classification'] {
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Watch';
  if (score > 0) return 'Light';
  return 'None';
}

// ── 13F issuer-name → ticker matching ────────────────────────────────

const ISSUER_SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED',
  'PLC', 'THE', 'GROUP', 'HOLDINGS', 'HOLDING', 'SA', 'AG', 'NV', 'COM', 'CL', 'CLASS', 'A', 'B', 'C', 'AND',
]);

export function normalizeIssuerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t && !ISSUER_SUFFIXES.has(t))
    .join(' ')
    .trim();
}

/**
 * Match a 13F nameOfIssuer to a universe symbol by normalized-name equality
 * or prefix (min 4 chars so "COCA COLA CO" matches "COCA COLA"). 13F info
 * tables carry CUSIPs, not tickers — this is the documented approximation.
 */
export function matchUniverseByIssuer(issuer: string): string | null {
  const norm = normalizeIssuerName(issuer);
  if (norm.length < 4) return null;
  for (const u of UNIVERSE) {
    const target = normalizeIssuerName(u.name);
    if (target.length < 4) continue;
    if (norm === target || norm.startsWith(target) || target.startsWith(norm)) return u.symbol;
  }
  return null;
}

// ── Fetch helpers ────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function edgarGet(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(`/api/edgar?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function edgarGetText(url: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/edgar?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

let tickerCikMap: Map<string, string> | null = null;

export async function fetchTickerCikMap(): Promise<Map<string, string>> {
  if (tickerCikMap) return tickerCikMap;
  const json = (await edgarGet('https://www.sec.gov/files/company_tickers.json')) as
    | Record<string, { cik_str?: number; ticker?: string }>
    | null;
  const map = new Map<string, string>();
  if (json) {
    for (const key of Object.keys(json)) {
      const row = json[key];
      if (row?.ticker && row.cik_str) {
        map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'));
      }
    }
  }
  tickerCikMap = map;
  return map;
}

function textBetween(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

/** Parse one Form 4 XML for open-market "P" purchases. Ported from the AVS edge fn. */
export function parseForm4(xml: string): InsiderBuy | null {
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

/**
 * EDGAR submissions list Form 4 primaryDocuments with an `xslF345X0X/`
 * viewer prefix — fetching that path returns XSL-rendered HTML (no
 * transactionCode tags). Strip it to get the raw XML the parser needs.
 */
export function edgarPrimaryDocPath(primaryDocument: string): string {
  return primaryDocument.replace(/^xsl\w+\//, '');
}

/**
 * Scan a company's recent Form 4s (most recent `FORM4_SCAN_CAP` within the
 * 60-day window) for open-market purchases. Returns null when the company
 * could not be resolved/scanned (soft failure — score stays 0).
 */
export async function fetchInsiderBuys(
  cik: string,
  opts: { maxFilings?: number; onEach?: () => void } = {},
): Promise<InsiderBuy[] | null> {
  const maxFilings = opts.maxFilings ?? FORM4_SCAN_CAP;
  const submissions = (await edgarGet(`https://data.sec.gov/submissions/CIK${cik}.json`)) as {
    filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; primaryDocument?: string[] } };
  } | null;
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
    if (targets.length >= maxFilings) break;
  }

  const cikNum = String(Number(cik));
  const buys: InsiderBuy[] = [];
  for (let i = 0; i < targets.length; i += 4) {
    const chunk = targets.slice(i, i + 4);
    const parsed = await Promise.all(
      chunk.map(async t => {
        const xml = await edgarGetText(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${t.acc}/${t.doc}`);
        return xml ? parseForm4(xml) : null;
      }),
    );
    for (const p of parsed) if (p) buys.push(p);
    opts.onEach?.();
    if (i + 4 < targets.length) await sleep(500); // ~8 req/s — SEC fair-access pace
  }
  return buys;
}

/**
 * Latest 13F-HR info table for one manager, parsed to raw positions.
 * Returns null on any fetch/parse failure (soft).
 */
export async function fetchManager13f(cik: number): Promise<{ positions: RawPosition[]; filingDate: string } | null> {
  const submissions = (await edgarGet(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)) as
    | Parameters<typeof pick13fFilings>[0]
    | null;
  if (!submissions) return null;
  const [filing] = pick13fFilings(submissions, 1);
  if (!filing) return null;

  const indexJson = (await edgarGet(
    `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replace(/-/g, '')}/index.json`,
  )) as Parameters<typeof pickInfoTableFile>[0] | null;
  if (!indexJson) return null;
  const infoTable = pickInfoTableFile(indexJson, filing.primaryDocument);
  if (!infoTable) return null;

  const xml = await edgarGetText(
    `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replace(/-/g, '')}/${infoTable}`,
  );
  if (!xml) return null;
  const rows = parseInfoTable(xml);
  if (!rows || rows.length === 0) return null;
  const scale = valueScaleFor(filing.filingDate);
  return { positions: rows.map(r => ({ ...r, value: r.value * scale })), filingDate: filing.filingDate };
}

export type CongressSourceTrade = { symbol: string; transaction_type: string; transaction_date: string };

/**
 * Congress trades for the universe — one REST call per symbol (the same
 * politician_trades table the server proxies use). Per-symbol because the
 * project caps responses at 1000 rows, which an unfiltered year of trades
 * blows past. Returns a symbol→trades map; missing symbols simply have no
 * entries (soft — congress stage scores 0 for them).
 */
export async function fetchCongressTrades(symbols: readonly string[]): Promise<Map<string, CongressSourceTrade[]>> {
  const since = new Date(Date.now() - CONGRESS_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const out = new Map<string, CongressSourceTrade[]>();
  for (let i = 0; i < symbols.length; i += 6) {
    const batch = symbols.slice(i, i + 6);
    const results = await Promise.all(
      batch.map(async sym => {
        const rows = await edgeRest<CongressSourceTrade[]>(
          `politician_trades?select=symbol,transaction_type,transaction_date&symbol=eq.${encodeURIComponent(sym)}&transaction_date=gte.${since}`,
        );
        return [sym, Array.isArray(rows) ? rows : []] as const;
      }),
    );
    for (const [sym, rows] of results) if (rows.length) out.set(sym, rows);
    if (i + 6 < symbols.length) await sleep(200);
  }
  return out;
}

export interface QuoteShort {
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  shortPercentOfFloat: number | null; // percent
  shortRatio: number | null;
}

/** One quoteSummary call via the server's crumb'd Yahoo proxy. */
export async function fetchQuoteShort(symbol: string): Promise<QuoteShort> {
  const empty: QuoteShort = { price: null, changePercent: null, marketCap: null, shortPercentOfFloat: null, shortRatio: null };
  try {
    const res = await fetch(
      `/api/yahoo/quote-summary?symbol=${encodeURIComponent(symbol)}&modules=price,summaryDetail,defaultKeyStatistics`,
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      quoteSummary?: { result?: Array<{
        price?: { regularMarketPrice?: { raw?: number }; regularMarketChangePercent?: { raw?: number } };
        summaryDetail?: { marketCap?: { raw?: number } };
        defaultKeyStatistics?: { shortPercentOfFloat?: { raw?: number }; shortRatio?: { raw?: number } };
      }> };
    };
    const r = data?.quoteSummary?.result?.[0];
    if (!r) return empty;
    const spf = r.defaultKeyStatistics?.shortPercentOfFloat?.raw;
    const sr = r.defaultKeyStatistics?.shortRatio?.raw;
    return {
      price: typeof r.price?.regularMarketPrice?.raw === 'number' ? r.price.regularMarketPrice.raw : null,
      changePercent: typeof r.price?.regularMarketChangePercent?.raw === 'number' ? r.price.regularMarketChangePercent.raw : null,
      marketCap: typeof r.summaryDetail?.marketCap?.raw === 'number' ? r.summaryDetail.marketCap.raw : null,
      shortPercentOfFloat: typeof spf === 'number' ? spf * 100 : null, // Yahoo reports a fraction
      shortRatio: typeof sr === 'number' ? sr : null,
    };
  } catch {
    return empty;
  }
}

export type ScanStage = 'insider' | 'institutional' | 'congress' | 'quotes';
export interface ScanProgress {
  stage: ScanStage;
  done: number;
  total: number;
  label: string;
}

export interface ScanOptions {
  insiderCache?: Record<string, InsiderBuy[]>; // symbol → buys (skip cached)
  onInsiderCached?: (symbol: string, buys: InsiderBuy[]) => void;
  onProgress?: (p: ScanProgress) => void;
  abortSignal?: AbortSignal;
}

/**
 * Run the full four-stage scan. Stages are independent and soft-fail:
 * a broken source scores 0 for that signal rather than killing the screen.
 * First run over the SEC stages takes ~2 minutes; /api/edgar's 1h cache and
 * the caller's insider cache make re-runs fast.
 */
export async function runSmartMoneyScan(opts: ScanOptions = {}): Promise<SmartMoneyRow[]> {
  const { onProgress, abortSignal } = opts;
  const symbols = UNIVERSE.map(u => u.symbol);

  // Stage 1 — insider (slowest: paced Form 4 fetches per company)
  const cikMap = await fetchTickerCikMap();
  const insiderBySymbol = new Map<string, InsiderBuy[]>();
  let insiderDone = 0;
  onProgress?.({ stage: 'insider', done: 0, total: symbols.length, label: 'SEC Form 4 insider scan' });
  for (const symbol of symbols) {
    if (abortSignal?.aborted) throw new Error('Scan aborted');
    const cached = opts.insiderCache?.[symbol];
    if (cached) {
      insiderBySymbol.set(symbol, cached);
    } else {
      const cik = cikMap.get(symbol);
      const buys = cik ? await fetchInsiderBuys(cik) : null;
      if (buys) {
        insiderBySymbol.set(symbol, buys);
        opts.onInsiderCached?.(symbol, buys);
      }
      await sleep(200);
    }
    insiderDone++;
    onProgress?.({ stage: 'insider', done: insiderDone, total: symbols.length, label: 'SEC Form 4 insider scan' });
  }

  // Stage 2 — 13F (10 managers × ~3 requests)
  const institutionBySymbol = new Map<string, InstitutionHolding[]>();
  let instDone = 0;
  onProgress?.({ stage: 'institutional', done: 0, total: FAST_MANAGERS.length, label: '13F famous-manager scan' });
  for (const m of FAST_MANAGERS) {
    if (abortSignal?.aborted) throw new Error('Scan aborted');
    const result = await fetchManager13f(m.cik);
    if (result) {
      for (const p of result.positions) {
        const sym = matchUniverseByIssuer(p.issuer);
        if (!sym) continue;
        const list = institutionBySymbol.get(sym);
        const holding: InstitutionHolding = { manager: m.name, issuer: p.issuer, value: p.value, shares: p.shares };
        if (list) list.push(holding);
        else institutionBySymbol.set(sym, [holding]);
      }
    }
    instDone++;
    onProgress?.({ stage: 'institutional', done: instDone, total: FAST_MANAGERS.length, label: '13F famous-manager scan' });
    await sleep(300);
  }

  // Stage 3 — congress (single REST call)
  onProgress?.({ stage: 'congress', done: 0, total: 1, label: 'Congress trade disclosures' });
  const congressBySymbol = await fetchCongressTrades(symbols);
  onProgress?.({ stage: 'congress', done: 1, total: 1, label: 'Congress trade disclosures' });

  // Stage 4 — quotes + short interest (one Yahoo call per symbol, paced)
  const quoteBySymbol = new Map<string, QuoteShort>();
  let quoteDone = 0;
  onProgress?.({ stage: 'quotes', done: 0, total: symbols.length, label: 'Quotes & short interest' });
  for (const symbol of symbols) {
    if (abortSignal?.aborted) throw new Error('Scan aborted');
    quoteBySymbol.set(symbol, await fetchQuoteShort(symbol));
    quoteDone++;
    onProgress?.({ stage: 'quotes', done: quoteDone, total: symbols.length, label: 'Quotes & short interest' });
    await sleep(150);
  }

  // Assemble + score
  const congressType = (raw: string): CongressTradeType => {
    const t = String(raw ?? '').toUpperCase();
    if (t.includes('BUY') || t.includes('PURCHASE')) return 'BUY';
    if (t.includes('SELL') || t.includes('SALE')) return 'SELL';
    return 'OTHER';
  };

  return UNIVERSE.map(u => {
    const insider = computeInsiderScore(insiderBySymbol.get(u.symbol) ?? []);
    const institutional = computeInstitutionalScore(institutionBySymbol.get(u.symbol) ?? []);
    const congress = computeCongressScore(
      (congressBySymbol.get(u.symbol) ?? []).map(t => ({
        type: congressType(t.transaction_type),
        date: String(t.transaction_date ?? '').slice(0, 10),
      })),
    );
    const q = quoteBySymbol.get(u.symbol);
    const squeeze = computeSqueezeScore(q?.shortPercentOfFloat ?? null, q?.shortRatio ?? null);
    const score = totalScore(insider, institutional, congress, squeeze);
    return {
      symbol: u.symbol,
      name: u.name,
      sector: u.sector,
      capTier: u.capTier,
      price: q?.price ?? null,
      changePercent: q?.changePercent ?? null,
      marketCap: q?.marketCap ?? null,
      insider,
      institutional,
      congress,
      squeeze,
      score,
      classification: classify(score),
      detailError: q && q.price === null ? 'Quote unavailable (Yahoo throttled this symbol)' : null,
    } satisfies SmartMoneyRow;
  });
}
