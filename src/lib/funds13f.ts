/**
 * funds13f.ts — SEC EDGAR 13F-HR data handling for the /funds screen
 * (greeksoup's Funds port, data-only: EDGAR is the source, no AI/ML).
 *
 * Flow: data.sec.gov submissions JSON → latest two 13F-HR filings →
 * filing directory index.json → information-table XML → parsed rows →
 * aggregated portfolio with quarter-over-quarter share deltas.
 * All network calls go through the server's /api/proxy (EDGAR has CORS).
 */

/** Curated famous-manager picker: CIK verified against data.sec.gov. */
export interface Manager {
  cik: number;
  name: string;
}

export const MANAGERS: readonly Manager[] = [
  { cik: 1067983, name: 'Berkshire Hathaway' },
  { cik: 102909, name: 'Vanguard Group' },
  { cik: 1364742, name: 'BlackRock' },
  { cik: 93751, name: 'State Street' },
  { cik: 1423053, name: 'Citadel Advisors' },
  { cik: 1037389, name: 'Renaissance Technologies' },
  { cik: 1350694, name: 'Bridgewater Associates' },
  { cik: 1061768, name: 'Baupost Group' },
  { cik: 1336528, name: 'Pershing Square' },
  { cik: 1649339, name: 'Scion Asset Management' },
  { cik: 1029160, name: 'Soros Fund Management' },
  { cik: 1167483, name: 'Tiger Global' },
  { cik: 1079114, name: 'Greenlight Capital' },
  { cik: 1179392, name: 'Two Sigma Investments' },
  { cik: 1135730, name: 'Coatue Management' },
  { cik: 1061165, name: 'Lone Pine Capital' },
] as const;

export interface FilingRef {
  accession: string;
  filingDate: string;
  primaryDocument: string;
}

/** Latest `limit` original 13F-HR filings (newest first; amendments skipped). */
export function pick13fFilings(
  submissions: {
    filings?: {
      recent?: {
        form?: string[];
        accessionNumber?: string[];
        filingDate?: string[];
        primaryDocument?: string[];
      };
    };
  },
  limit = 2,
): FilingRef[] {
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const out: FilingRef[] = [];
  for (let i = 0; i < recent.form.length && out.length < limit; i++) {
    if (recent.form[i] === '13F-HR') {
      out.push({
        accession: recent.accessionNumber?.[i] ?? '',
        filingDate: recent.filingDate?.[i] ?? '',
        primaryDocument: recent.primaryDocument?.[i] ?? '',
      });
    }
  }
  return out;
}

/**
 * The information-table file inside a filing directory. EDGAR names it
 * inconsistently ("infotable.xml", "56757.xml", …), so prefer a name that
 * looks like an info table and otherwise take the non-primary XML.
 */
export function pickInfoTableFile(
  indexJson: { directory?: { item?: Array<{ name?: string }> } },
  primaryDocument: string,
): string | null {
  const items = indexJson?.directory?.item ?? [];
  const primaryName = primaryDocument.split('/').pop() ?? primaryDocument;
  const xmls = items
    .map(i => i.name ?? '')
    .filter(n => n.toLowerCase().endsWith('.xml') && n !== primaryName);
  if (!xmls.length) return null;
  return xmls.find(n => /info|table/i.test(n)) ?? xmls[0];
}

/**
 * 13F `value` units: whole dollars for filings on/after 2023-01-03
 * (SEC amendment), thousands of dollars before. Verified against a 2026
 * Berkshire filing (Σ values ≈ $299B = whole dollars).
 */
export function valueScaleFor(filingDate: string): 1 | 1000 {
  return filingDate >= '2023-01-03' ? 1 : 1000;
}

export interface RawPosition {
  cusip: string;
  issuer: string;
  value: number;   // as written in the XML (scale applies at aggregation)
  shares: number;
}

/**
 * Parse a 13F information-table XML string. Namespace-agnostic (EDGAR uses
 * a default xmlns). Returns null when the document is not parseable XML.
 */
export function parseInfoTable(xmlText: string): RawPosition[] | null {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const entries = doc.getElementsByTagName('infoTable');
  const rows: RawPosition[] = [];
  for (let i = 0; i < entries.length; i++) {
    const el = entries[i];
    const text = (tag: string): string =>
      el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
    const cusip = text('cusip');
    if (!cusip) continue;
    rows.push({
      cusip,
      issuer: text('nameOfIssuer').toUpperCase(),
      value: Number(text('value').replace(/,/g, '')) || 0,
      shares: Number(text('sshPrnamt').replace(/,/g, '')) || 0,
    });
  }
  return rows;
}

export interface FundPosition {
  cusip: string;
  issuer: string;
  value: number;             // dollars
  shares: number;
  pctOfPortfolio: number;    // 0–100
  prevShares: number | null; // null → absent in prior filing
  shareDelta: number | null; // current − prior; null when no prior data
  isNew: boolean;
}

export interface PortfolioSummary {
  total: number;             // dollars
  positions: FundPosition[]; // sorted by value desc
  newCount: number;
  exitedCount: number;
}

/**
 * Aggregate raw info-table rows into a portfolio: duplicate CUSIPs summed,
 * value scaled to dollars, percent of total, and quarter-over-quarter
 * share deltas against the prior filing's rows (optional).
 */
export function aggregatePortfolio(
  rows: RawPosition[],
  opts: {
    scale?: number;
    priorRows?: RawPosition[] | null;
  } = {},
): PortfolioSummary {
  const scale = opts.scale ?? 1;
  const byCusip = new Map<string, { issuer: string; value: number; shares: number }>();
  for (const r of rows) {
    const cur = byCusip.get(r.cusip);
    if (cur) {
      cur.value += r.value;
      cur.shares += r.shares;
    } else {
      byCusip.set(r.cusip, { issuer: r.issuer, value: r.value, shares: r.shares });
    }
  }

  const priorByCusip = new Map<string, number>();
  if (opts.priorRows) {
    // shares are unitless — value scale does not apply to them
    for (const r of opts.priorRows) {
      priorByCusip.set(r.cusip, (priorByCusip.get(r.cusip) ?? 0) + r.shares);
    }
  }

  let total = 0;
  for (const v of byCusip.values()) total += v.value * scale;
  const hasPrior = Boolean(opts.priorRows);

  const positions: FundPosition[] = [...byCusip.entries()].map(([cusip, v]) => {
    const value = v.value * scale;
    const prevShares = priorByCusip.has(cusip) ? priorByCusip.get(cusip)! : null;
    return {
      cusip,
      issuer: v.issuer,
      value,
      shares: v.shares,
      pctOfPortfolio: total > 0 ? (value / total) * 100 : 0,
      prevShares: hasPrior ? prevShares : null,
      shareDelta: hasPrior && prevShares !== null ? v.shares - prevShares : null,
      isNew: hasPrior && prevShares === null,
    };
  });
  positions.sort((a, b) => b.value - a.value);

  const newCount = positions.filter(p => p.isNew).length;
  const exitedCount = hasPrior
    ? [...priorByCusip.keys()].filter(c => !byCusip.has(c)).length
    : 0;

  return { total, positions, newCount, exitedCount };
}

/** Format dollars as $299.3B / $577.2M / $12.4K. */
export function formatUsd(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
