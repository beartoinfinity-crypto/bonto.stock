/**
 * macro.ts — curated macro dashboard data for the /macro screen (greeksoup's
 * Macro port). Series come from the Federal Reserve FRED API via the server's
 * /api/fred/observations proxy (key held server-side). Pure parsing/stat
 * helpers — no AI/ML.
 */

export type MacroCategory =
  | 'Rates' | 'Labor' | 'Prices' | 'Credit' | 'Currencies' | 'Energy' | 'Volatility';

export interface MacroSeriesMeta {
  id: string;
  name: string;
  unit: string;        // display suffix for the latest value
  digits: number;      // decimals when formatting the latest value
  category: MacroCategory;
  blurb: string;
}

/** Curated 12-series FRED basket (ids verified against the FRED API). */
export const MACRO_SERIES: readonly MacroSeriesMeta[] = [
  { id: 'DFF', name: 'Fed funds effective rate', unit: '%', digits: 2, category: 'Rates',
    blurb: 'Overnight depository rate — the Fed’s policy rate in practice.' },
  { id: 'DGS2', name: '2-year Treasury yield', unit: '%', digits: 2, category: 'Rates',
    blurb: 'Short-end yield — steers the market’s policy-rate expectations.' },
  { id: 'DGS10', name: '10-year Treasury yield', unit: '%', digits: 2, category: 'Rates',
    blurb: 'Benchmark long rate — anchors mortgages and equity discount rates.' },
  { id: 'T10Y2Y', name: '10y − 2y spread', unit: 'pp', digits: 2, category: 'Rates',
    blurb: 'Yield-curve slope; negative readings have preceded recessions.' },
  { id: 'UNRATE', name: 'Unemployment rate', unit: '%', digits: 1, category: 'Labor',
    blurb: 'Headline labor slack — a lagging but cycle-defining indicator.' },
  { id: 'PAYEMS', name: 'Nonfarm payrolls', unit: 'K', digits: 0, category: 'Labor',
    blurb: 'Total US jobs — monthly growth is the economy’s heartbeat.' },
  { id: 'ICSA', name: 'Initial jobless claims', unit: 'K', digits: 0, category: 'Labor',
    blurb: 'Weekly layoffs — the highest-frequency labor signal.' },
  { id: 'T5YIE', name: '5y inflation breakeven', unit: '%', digits: 2, category: 'Prices',
    blurb: 'Market-implied inflation over 5 years from TIPS.' },
  { id: 'BAMLH0A0HYM2', name: 'High-yield OAS', unit: '%', digits: 2, category: 'Credit',
    blurb: 'HY credit spread — the market’s risk-appetite gauge.' },
  { id: 'DTWEXBGS', name: 'Broad dollar index', unit: 'idx', digits: 2, category: 'Currencies',
    blurb: 'Trade-weighted USD vs major US trading partners.' },
  { id: 'DCOILWTICO', name: 'WTI crude oil', unit: '$', digits: 2, category: 'Energy',
    blurb: 'US benchmark crude — inflation input and cycle barometer.' },
  { id: 'VIXCLS', name: 'VIX', unit: 'idx', digits: 2, category: 'Volatility',
    blurb: 'S&P 500 implied volatility — the fear gauge.' },
] as const;

export const MACRO_CATEGORIES: readonly MacroCategory[] = [
  'Rates', 'Labor', 'Prices', 'Credit', 'Currencies', 'Energy', 'Volatility',
];

export interface MacroPoint {
  date: string;         // YYYY-MM-DD
  value: number | null; // FRED "." → null
}

/**
 * Parse one series' observations from the API payload. Numeric strings become
 * numbers, missing markers become null, malformed rows are dropped.
 */
export function parseObservations(raw: unknown): MacroPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: MacroPoint[] = [];
  for (const row of raw as Array<{ date?: unknown; value?: unknown }>) {
    if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (row.value === null || row.value === '.' || row.value === '') {
      out.push({ date: row.date, value: null });
      continue;
    }
    const n = typeof row.value === 'number' ? row.value : Number(row.value);
    out.push({ date: row.date, value: Number.isFinite(n) ? n : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface SeriesStat {
  latest: number | null;
  latestDate: string | null;
  /** value at the newest observation on/before one year before the latest */
  yearAgo: number | null;
  /** latest − yearAgo (null when no year-ago observation) */
  yoyChange: number | null;
  yoyPct: number | null;
}

/**
 * Latest value and year-over-year change (comparison point = newest
 * observation on/before latestDate − 365 days; null when the window has no
 * data). Windowed charts slice separately — this always uses the full series.
 */
export function summarize(points: readonly MacroPoint[]): SeriesStat {
  const nonNull = points.filter(p => p.value !== null);
  if (!nonNull.length) {
    return { latest: null, latestDate: null, yearAgo: null, yoyChange: null, yoyPct: null };
  }
  const latestPoint = nonNull[nonNull.length - 1];
  const latestDate = latestPoint.date;
  const cutoff = `${Number(latestDate.slice(0, 4)) - 1}${latestDate.slice(4)}`;
  let yearAgoPoint: MacroPoint | null = null;
  for (const p of nonNull) {
    if (p.date <= cutoff) yearAgoPoint = p;
    else break;
  }
  const yoyChange = yearAgoPoint
    ? latestPoint.value! - yearAgoPoint.value!
    : null;
  return {
    latest: latestPoint.value,
    latestDate,
    yearAgo: yearAgoPoint ? yearAgoPoint.value : null,
    yoyChange,
    yoyPct: yearAgoPoint && yearAgoPoint.value !== 0
      ? (yoyChange! / Math.abs(yearAgoPoint.value)) * 100
      : null,
  };
}

/** Slice a point list to the trailing window (days); keeps null gaps. */
export function windowPoints(points: readonly MacroPoint[], days: number, todayISO: string): MacroPoint[] {
  const cutoffMs = Date.parse(todayISO) - days * 86400000;
  if (!Number.isFinite(cutoffMs)) return [...points];
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
  return points.filter(p => p.date >= cutoff);
}

/** Latest value formatted with the series' unit ("4.31%", "159,746K"). */
export function formatMacroValue(meta: MacroSeriesMeta, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const body = v.toLocaleString('en-US', {
    minimumFractionDigits: meta.digits,
    maximumFractionDigits: meta.digits,
  });
  if (meta.unit === '$') return `$${body}`;
  if (meta.unit === '%' || meta.unit === 'pp') return `${body}${meta.unit === 'pp' ? ' pp' : '%'}`;
  if (meta.unit === 'K') return `${body}K`;
  return body;
}

/** Signed delta formatting for the YoY badge. */
export function formatMacroDelta(meta: MacroSeriesMeta, delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const abs = Math.abs(delta);
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: meta.digits,
    maximumFractionDigits: meta.digits,
  });
  if (meta.unit === '$') return `${sign}$${body}`;
  if (meta.unit === '%' || meta.unit === 'pp') return `${sign}${body}${meta.unit === 'pp' ? ' pp' : '%'}`;
  if (meta.unit === 'K') return `${sign}${body}K`;
  return `${sign}${body}`;
}
