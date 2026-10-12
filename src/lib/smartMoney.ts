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
import {
  SP500_MEMBERS,
  NASDAQ100_MEMBERS,
  buildIndexUnion,
  type IndexMember,
} from '@/lib/indexMembers';

// ── Universe ─────────────────────────────────────────────────────────

/** Row shape of public.smart_money_scan_rows written by the daily
 *  smart-money-scan edge fn. Signals are stored as JSONB columns. */
export interface SmartMoneyScanDbRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  cap_tier: string | null;
  price: number | null;
  change_percent: number | null;
  market_cap: number | null;
  insider: InsiderSignal | null;
  institutional: InstitutionalSignal | null;
  congress: CongressSignal | null;
  squeeze: SqueezeSignal | null;
  score: number | null;
  classification: SmartMoneyRow['classification'] | null;
  insider_pending: boolean | null;
  squeeze_loaded: boolean | null;
  scanned_at: string;
}

/** Map a stored scan row to the UI row shape. `scannedAt` (epoch ms) is
 *  surfaced as a soft note so a stale background scan is not mistaken for
 *  live data — the interactive "Run screen" still overrides it. */
export function mapScanDbRow(db: SmartMoneyScanDbRow): SmartMoneyRow {
  const insider = db.insider ?? computeInsiderScore([]);
  const institutional = db.institutional ?? computeInstitutionalScore([]);
  const congress = db.congress ?? computeCongressScore([]);
  const squeeze = db.squeeze ?? computeSqueezeScore(null, null);
  const score = db.score ?? totalScore(insider, institutional, congress, squeeze);
  const scannedAt = db.scanned_at ? Date.parse(db.scanned_at) : 0;
  const staleNote = Number.isFinite(scannedAt) && scannedAt > 0
    ? `Background scan ${new Date(scannedAt).toISOString().slice(0, 10)}`
    : null;
  return {
    symbol: db.symbol,
    name: db.name ?? db.symbol,
    sector: db.sector ?? 'Technology',
    capTier: db.cap_tier ?? capTierFromMarketCap(db.market_cap),
    price: db.price,
    changePercent: db.change_percent,
    marketCap: db.market_cap,
    insider,
    institutional,
    congress,
    squeeze,
    score,
    classification: db.classification ?? classify(score),
    detailError: staleNote,
    insiderPending: db.insider_pending ?? false,
    squeezeLoaded: db.squeeze_loaded ?? false,
  };
}

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

// ── Universe modes (Option B: full S&P500 / NASDAQ-100 screening) ────

export type UniverseMode = 'curated' | 'sp500' | 'ndx100' | 'index';

export const UNIVERSE_MODES: readonly { id: UniverseMode; label: string; note: string }[] = [
  { id: 'curated', label: 'Curated 41', note: 'The original hand-picked liquid/growth names' },
  { id: 'index', label: 'S&P 500 + NDX', note: 'All 501 unique index constituents' },
  { id: 'sp500', label: 'S&P 500', note: 'Full S&P 500 membership' },
  { id: 'ndx100', label: 'NASDAQ-100', note: 'Full NASDAQ-100 membership' },
];

/** Cap tier is static on curated entries but absent on index members (filled
 *  live from batch-quote marketCap). Use this to derive a tier at scan time. */
export function capTierFromMarketCap(mcap: number | null | undefined): UniverseEntry['capTier'] {
  if (typeof mcap !== 'number' || !Number.isFinite(mcap) || mcap <= 0) return 'large';
  if (mcap >= 200e9) return 'mega';
  if (mcap >= 10e9) return 'large';
  if (mcap >= 2e9) return 'mid';
  return 'small';
}

/** Build the UniverseEntry[] for a mode. Index members start with capTier
 *  'large' — refined live from batch quotes during the scan. */
export function universeForMode(mode: UniverseMode): UniverseEntry[] {
  if (mode === 'curated') return UNIVERSE.map(u => ({ ...u }));
  const members: IndexMember[] =
    mode === 'sp500' ? [...SP500_MEMBERS] :
    mode === 'ndx100' ? [...NASDAQ100_MEMBERS] :
    buildIndexUnion();
  return members.map(m => ({ symbol: m.symbol, name: m.name, sector: m.sector, capTier: 'large' as const }));
}

export function modeUniverseSize(mode: UniverseMode): number {
  return universeForMode(mode).length;
}

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
  /** True when the insider stage has not been scanned for this bucket yet
   *  (index universes scan ~100 Form 4 buckets at a time). */
  insiderPending?: boolean;
  /** True when short-interest hasn't been loaded (lazy for index universes). */
  squeezeLoaded?: boolean;
  /** UI-only flag while a lazy short-interest fetch is in flight. */
  squeezeLoading?: boolean;
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
 * `universe` defaults to the curated set; index scans pass the active universe.
 */
export function matchUniverseByIssuer(
  issuer: string,
  universe: readonly UniverseEntry[] = UNIVERSE,
): string | null {
  const norm = normalizeIssuerName(issuer);
  if (norm.length < 4) return null;
  for (const u of universe) {
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

const CONGRESS_PAGE_LIMIT = 1000; // project caps rows per REST response
const CONGRESS_YEAR_DAYS = 365;

/**
 * Fetch congress trades by month-windows rather than per-symbol. A 365-day
 * range is ~12 monthly GETs (each well under the 1000-row cap) instead of one
 * call per symbol. If a window still returns exactly the page cap, split it
 * in half down to a floor. Result is grouped by symbol; the caller filters to
 * its active universe (works unchanged for 41- or 500-symbol universes).
 */
export async function fetchCongressTradesBulk(): Promise<Map<string, CongressSourceTrade[]>> {
  const now = Date.now();
  const start = new Date(now - CONGRESS_YEAR_DAYS * 24 * 3600 * 1000);

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
    const rows = await edgeRest<CongressSourceTrade[]>(
      `politician_trades?select=symbol,transaction_type,transaction_date&transaction_date=gte.${fromIso}&transaction_date=lt.${toIso}&limit=${CONGRESS_PAGE_LIMIT}`,
    );
    if (Array.isArray(rows) && rows.length >= CONGRESS_PAGE_LIMIT && depth < 6) {
      const mid = new Date((from.getTime() + to.getTime()) / 2);
      await pull(from, mid, depth + 1);
      await pull(mid, to, depth + 1);
    } else if (Array.isArray(rows)) {
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
    if (list) list.push(row);
    else out.set(sym, [row]);
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

/** Batch quotes via /api/yahoo/batch-quote (max 50 symbols per call). This
 *  returns price/change/marketCap only — NOT short interest, which lives in
 *  the v10 quoteSummary modules and stays per-symbol/lazy. */
export interface BatchQuote {
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  name: string | null;
}

const BATCH_QUOTE_CHUNK = 50;

export async function fetchBatchQuotes(symbols: readonly string[]): Promise<Map<string, BatchQuote>> {
  const out = new Map<string, BatchQuote>();
  const list = [...new Set(symbols)];
  for (let i = 0; i < list.length; i += BATCH_QUOTE_CHUNK) {
    const chunk = list.slice(i, i + BATCH_QUOTE_CHUNK);
    try {
      const res = await fetch(
        `/api/yahoo/batch-quote?symbols=${encodeURIComponent(chunk.join(','))}&fields=price,change,marketCap,name`,
      );
      if (res.ok) {
        const data = (await res.json()) as { quotes?: Record<string, { price?: number; changePercent?: number; marketCap?: number; name?: string }> };
        for (const [sym, q] of Object.entries(data.quotes ?? {})) {
          out.set(sym, {
            price: typeof q.price === 'number' ? q.price : null,
            changePercent: typeof q.changePercent === 'number' ? q.changePercent : null,
            marketCap: typeof q.marketCap === 'number' ? q.marketCap : null,
            name: typeof q.name === 'string' ? q.name : null,
          });
        }
      }
    } catch { /* soft: leave missing */ }
    if (i + BATCH_QUOTE_CHUNK < list.length) await sleep(150);
  }
  return out;
}

export type ScanStage = 'insider' | 'institutional' | 'congress' | 'quotes';
export interface ScanProgress {
  stage: ScanStage;
  done: number;
  total: number;
  label: string;
}

export interface ScanOptions {
  /** Which universe to screen. Defaults to the curated 41. */
  universe?: readonly UniverseEntry[];
  insiderCache?: Record<string, InsiderBuy[]>; // symbol → buys (skip cached)
  onInsiderCached?: (symbol: string, buys: InsiderBuy[]) => void;
  onProgress?: (p: ScanProgress) => void;
  abortSignal?: AbortSignal;
  /** Index universes: only Form-4-scan this many un-scanned symbols this run
   *  (100 ≈ a few minutes of SEC-paced fetches). Remaining rows return with
   *  insiderPending=true so the page can offer "Scan next 100". */
  insiderBucket?: number;
}

/**
 * Run the full four-stage scan. Stages are independent and soft-fail:
 * a broken source scores 0 for that signal rather than killing the screen.
 *
 * Curated universe (~41): quoteSummary per symbol (full data incl. short
 * interest) — a few minutes first run.
 *
 * Index universes (S&P500 / NDX, ~500 symbols): prices via ~10 batch-quote
 * calls, congress via monthly bulk windows, insider Form 4s bucketed
 * (insiderBucket per run), and short interest fetched lazily for the top-100
 * by partial score (insider+13F+congress). The 13F stage cost is flat
 * regardless of universe size.
 */
export async function runSmartMoneyScan(opts: ScanOptions = {}): Promise<SmartMoneyRow[]> {
  const { onProgress, abortSignal } = opts;
  const universe = (opts.universe ?? UNIVERSE).map(u => ({ ...u }));
  const symbols = universe.map(u => u.symbol);
  const isIndex = universe.length > 60;

  // Stage 1 — insider (slowest: paced Form 4 fetches per company).
  // Index mode: only scan a bucket of the un-scanned symbols this run.
  const cikMap = await fetchTickerCikMap();
  const insiderBySymbol = new Map<string, InsiderBuy[]>();
  const insiderPending = new Set<string>();
  let insiderWork = symbols;
  if (isIndex && typeof opts.insiderBucket === 'number' && opts.insiderBucket > 0) {
    const unscanned = symbols.filter(s => !opts.insiderCache?.[s]);
    insiderWork = unscanned.slice(0, opts.insiderBucket);
    for (const s of unscanned.slice(opts.insiderBucket)) insiderPending.add(s);
  }
  let insiderDone = 0;
  onProgress?.({ stage: 'insider', done: 0, total: insiderWork.length, label: 'SEC Form 4 insider scan' });
  for (const symbol of insiderWork) {
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
      await sleep(isIndex ? 120 : 200);
    }
    insiderDone++;
    onProgress?.({ stage: 'insider', done: insiderDone, total: insiderWork.length, label: 'SEC Form 4 insider scan' });
  }

  // Stage 2 — 13F (10 managers × ~3 requests — flat regardless of universe)
  const institutionBySymbol = new Map<string, InstitutionHolding[]>();
  let instDone = 0;
  onProgress?.({ stage: 'institutional', done: 0, total: FAST_MANAGERS.length, label: '13F famous-manager scan' });
  for (const m of FAST_MANAGERS) {
    if (abortSignal?.aborted) throw new Error('Scan aborted');
    const result = await fetchManager13f(m.cik);
    if (result) {
      for (const p of result.positions) {
        const sym = matchUniverseByIssuer(p.issuer, universe);
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

  // Stage 3 — congress. Curated keeps per-symbol (tiny); index uses bulk
  // monthly windows then filters to this universe.
  const congressBySymbol = isIndex
    ? await filterToUniverse(await fetchCongressTradesBulk(), symbols)
    : await fetchCongressTrades(symbols);
  onProgress?.({ stage: 'congress', done: 1, total: 1, label: 'Congress trade disclosures' });

  // Stage 4 — quotes. Curated: per-symbol quoteSummary (has short interest).
  // Index: batch-quote for price/change/marketCap + name, and derive capTier
  // from live marketCap. Short interest is fetched lazily for a top-100 slice.
  const quoteBySymbol = new Map<string, QuoteShort>();
  if (!isIndex) {
    let quoteDone = 0;
    onProgress?.({ stage: 'quotes', done: 0, total: symbols.length, label: 'Quotes & short interest' });
    for (const symbol of symbols) {
      if (abortSignal?.aborted) throw new Error('Scan aborted');
      quoteBySymbol.set(symbol, await fetchQuoteShort(symbol));
      quoteDone++;
      onProgress?.({ stage: 'quotes', done: quoteDone, total: symbols.length, label: 'Quotes & short interest' });
      await sleep(150);
    }
  } else {
    onProgress?.({ stage: 'quotes', done: 0, total: 1, label: 'Batch quotes' });
    const batch = await fetchBatchQuotes(symbols);
    for (const u of universe) {
      const b = batch.get(u.symbol);
      const empty: QuoteShort = { price: null, changePercent: null, marketCap: null, shortPercentOfFloat: null, shortRatio: null };
      quoteBySymbol.set(u.symbol, b
        ? { price: b.price, changePercent: b.changePercent, marketCap: b.marketCap, shortPercentOfFloat: null, shortRatio: null }
        : empty);
      if (b?.marketCap != null) u.capTier = capTierFromMarketCap(b.marketCap);
    }
    onProgress?.({ stage: 'quotes', done: 1, total: 1, label: 'Batch quotes' });

    // Lazy short-interest for the top-N by partial (insider+13F+congress).
    const candidates = universe
      .filter(u => !insiderPending.has(u.symbol))
      .map(u => {
        const insider = computeInsiderScore(insiderBySymbol.get(u.symbol) ?? []);
        const institutional = computeInstitutionalScore(institutionBySymbol.get(u.symbol) ?? []);
        const congress = computeCongressScore((congressBySymbol.get(u.symbol) ?? []).map(t => ({
          type: congressType(t.transaction_type),
          date: String(t.transaction_date ?? '').slice(0, 10),
        })));
        return { symbol: u.symbol, partial: insider.score + institutional.score + congress.score };
      })
      .filter(c => c.partial > 0)
      .sort((a, b) => b.partial - a.partial)
      .slice(0, 100);

    let sqDone = 0;
    onProgress?.({ stage: 'quotes', done: 0, total: candidates.length, label: 'Short interest (top 100)' });
    for (const c of candidates) {
      if (abortSignal?.aborted) throw new Error('Scan aborted');
      const q = quoteBySymbol.get(c.symbol) ?? { price: null, changePercent: null, marketCap: null, shortPercentOfFloat: null, shortRatio: null };
      const full = await fetchQuoteShort(c.symbol);
      quoteBySymbol.set(c.symbol, { ...q, shortPercentOfFloat: full.shortPercentOfFloat, shortRatio: full.shortRatio });
      sqDone++;
      onProgress?.({ stage: 'quotes', done: sqDone, total: candidates.length, label: 'Short interest (top 100)' });
      await sleep(150);
    }
  }

  // Assemble + score
  const squeezeLoaded = new Set<string>();
  for (const [sym, q] of quoteBySymbol) {
    if (q.shortPercentOfFloat != null || q.shortRatio != null) squeezeLoaded.add(sym);
  }

  return universe.map(u => {
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
      name: q?.name && !isIndex ? u.name : (q?.name ?? u.name) || u.name,
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
      insiderPending: insiderPending.has(u.symbol) || undefined,
      squeezeLoaded: (isIndex ? squeezeLoaded.has(u.symbol) : true) || undefined,
    } satisfies SmartMoneyRow;
  });
}

function congressType(raw: string): CongressTradeType {
  const t = String(raw ?? '').toUpperCase();
  if (t.includes('BUY') || t.includes('PURCHASE')) return 'BUY';
  if (t.includes('SELL') || t.includes('SALE')) return 'SELL';
  return 'OTHER';
}

function filterToUniverse(
  bySymbol: Map<string, CongressSourceTrade[]>,
  universe: readonly string[],
): Map<string, CongressSourceTrade[]> {
  const keep = new Set(universe);
  const out = new Map<string, CongressSourceTrade[]>();
  for (const [sym, trades] of bySymbol) if (keep.has(sym)) out.set(sym, trades);
  return out;
}
