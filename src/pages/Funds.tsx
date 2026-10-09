import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import { Landmark, Loader2, RefreshCw } from 'lucide-react';
import {
  aggregatePortfolio, formatUsd, MANAGERS, parseInfoTable, pick13fFilings,
  pickInfoTableFile, valueScaleFor, type FundPosition,
} from '@/lib/funds13f';

const CIK_KEY = 'stockpulse_funds_cik';
const DEFAULT_CIK = '1067983'; // Berkshire Hathaway

interface FundsData {
  name: string;
  cik: number;
  filingDate: string;
  priorFilingDate: string | null;
  total: number;
  positions: FundPosition[];
  newCount: number;
  exitedCount: number;
  rowCount: number;
}

async function proxyJson<T>(url: string): Promise<T> {
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch { /* non-JSON body */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function proxyText(url: string): Promise<string> {
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).pathname.split('/').pop()}`);
  return res.text();
}

const archiveBase = (cik: number, accession: string): string =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}`;

async function fetchPortfolio(cik: number): Promise<FundsData> {
  const padded = String(cik).padStart(10, '0');
  const submissions = await proxyJson<{
    name?: string;
    filings?: { recent?: Record<string, string[]> };
  }>(`https://data.sec.gov/submissions/CIK${padded}.json`);

  const filings = pick13fFilings(
    submissions as Parameters<typeof pick13fFilings>[0],
    2,
  );
  if (!filings.length) throw new Error('No 13F-HR filings found for this CIK.');

  const loadTable = async (filing: typeof filings[number]) => {
    const base = archiveBase(cik, filing.accession);
    const index = await proxyJson<{ directory?: { item?: Array<{ name?: string }> } }>(
      `${base}/index.json`,
    );
    const file = pickInfoTableFile(index, filing.primaryDocument);
    if (!file) throw new Error(`No information table in filing ${filing.accession}.`);
    const xml = await proxyText(`${base}/${file}`);
    const rows = parseInfoTable(xml);
    if (rows === null) throw new Error('Information table was not parseable XML.');
    return rows;
  };

  const currentRows = await loadTable(filings[0]);
  let priorRows: ReturnType<typeof parseInfoTable> = null;
  let priorFilingDate: string | null = null;
  if (filings[1]) {
    try {
      priorRows = await loadTable(filings[1]);
      priorFilingDate = filings[1].filingDate;
    } catch {
      // prior filing is best-effort — deltas degrade to null
    }
  }

  const summary = aggregatePortfolio(currentRows, {
    scale: valueScaleFor(filings[0].filingDate),
    priorRows,
  });

  return {
    name: submissions.name ?? `CIK ${cik}`,
    cik,
    filingDate: filings[0].filingDate,
    priorFilingDate,
    total: summary.total,
    positions: summary.positions,
    newCount: summary.newCount,
    exitedCount: summary.exitedCount,
    rowCount: currentRows.length,
  };
}

export default function Funds() {
  const [cikInput, setCikInput] = useState<string>(
    () => localStorage.getItem(CIK_KEY) || DEFAULT_CIK,
  );
  const [data, setData] = useState<FundsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (rawCik: string) => {
    const digits = rawCik.trim().replace(/\D/g, '');
    if (!digits) {
      setError('Enter a numeric CIK.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPortfolio(Number(digits));
      localStorage.setItem(CIK_KEY, digits);
      setData(result);
      setShowAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const runRef = useRef(load);
  runRef.current = load;
  useEffect(() => {
    void runRef.current(localStorage.getItem(CIK_KEY) || DEFAULT_CIK);
    // mount-only initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = showAll ? data?.positions ?? [] : (data?.positions ?? []).slice(0, 100);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Landmark className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">13F Funds</h1>
              <p className="text-xs text-muted-foreground">
                {data
                  ? `${data.name} · filed ${data.filingDate}`
                      + (data.priorFilingDate ? ` · vs ${data.priorFilingDate}` : '')
                      + ` · ${data.rowCount.toLocaleString()} rows`
                  : 'Institutional portfolios from SEC EDGAR — data-only, no AI.'}
              </p>
            </div>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={e => { e.preventDefault(); void load(cikInput); }}
          >
            <Select
              value={MANAGERS.some(m => String(m.cik) === cikInput) ? cikInput : undefined}
              onValueChange={v => { setCikInput(v); void load(v); }}
            >
              <SelectTrigger className="w-48"><SelectValue placeholder="Pick a manager" /></SelectTrigger>
              <SelectContent>
                {MANAGERS.map(m => (
                  <SelectItem key={m.cik} value={String(m.cik)}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={cikInput}
              onChange={e => setCikInput(e.target.value.replace(/\D/g, ''))}
              placeholder="CIK"
              className="w-24 font-mono"
              aria-label="Custom CIK"
            />
            <Button size="sm" type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Load
            </Button>
          </form>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading && !data && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Fetching filing from SEC EDGAR…
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">Portfolio value</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">{formatUsd(data.total)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">Positions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">
                    {data.positions.length.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">New this filing</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-success">
                    {data.priorFilingDate ? data.newCount.toLocaleString() : '—'}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">Exited this filing</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-destructive">
                    {data.priorFilingDate ? data.exitedCount.toLocaleString() : '—'}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>Holdings <span className="text-xs font-normal text-muted-foreground">by value</span></span>
                  {data.positions.length > 100 && (
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowAll(v => !v)}>
                      {showAll ? 'Top 100 only' : `Show all (${data.positions.length.toLocaleString()})`}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="text-left border-b border-border">
                      <th className="py-1.5 pr-3">#</th>
                      <th className="py-1.5 pr-3">Issuer</th>
                      <th className="py-1.5 pr-3">CUSIP</th>
                      <th className="py-1.5 pr-3 text-right">Value</th>
                      <th className="py-1.5 pr-3 text-right">% of port</th>
                      <th className="py-1.5 pr-3 text-right">Shares</th>
                      <th className="py-1.5 text-right">QoQ shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p, i) => (
                      <tr key={p.cusip} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                        <td className="py-1.5 pr-3">{p.issuer}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{p.cusip}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{formatUsd(p.value)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{p.pctOfPortfolio.toFixed(1)}%</td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {p.shares.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {p.isNew ? (
                            <Badge variant="outline" className="text-success border-success/40">NEW</Badge>
                          ) : p.shareDelta !== null ? (
                            <span className={p.shareDelta > 0 ? 'text-success' : p.shareDelta < 0 ? 'text-destructive' : 'text-muted-foreground'}>
                              {p.shareDelta > 0 ? '+' : ''}{p.shareDelta.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-3 text-center text-xs text-muted-foreground">
                          No positions
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Source: SEC EDGAR Form 13F-HR (quarterly, filed up to 45 days after quarter end).
          Deltas compare against the previous original filing. For education only — not investment advice.
        </p>
      </div>
      <BackToTop />
    </div>
  );
}
