import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import {
  Activity, AlertTriangle, Loader2, PieChart, Plus, RefreshCw, ShieldAlert, Star, Trash2, TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { toast } from 'sonner';
import * as storage from '@/lib/storage';
import { fetchHistoricalData, fetchStockQuote } from '@/lib/stockApi';
import { popularStocks, StockData } from '@/lib/stockData';
import { computeRiskReport, type RiskReport } from '@/lib/portfolioRisk';

interface HoldingRow {
  symbol: string;
  weight: number;
}

const HOLDINGS_KEY = 'stockpulse_risk_holdings';
const BENCH_KEY = 'stockpulse_risk_benchmark';
const WINDOW_KEY = 'stockpulse_risk_window';
const WATCHLIST_KEY = 'stockpulse_watchlist';

const DEFAULT_HOLDINGS: HoldingRow[] = [
  { symbol: 'AAPL', weight: 25 },
  { symbol: 'MSFT', weight: 25 },
  { symbol: 'NVDA', weight: 25 },
  { symbol: 'JPM', weight: 25 },
];

const BENCHMARKS = ['SPY', 'QQQ', 'DIA', 'IWM'];
const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 126, label: '6 months' },
  { days: 252, label: '1 year' },
  { days: 756, label: '3 years' },
];

function loadHoldings(): HoldingRow[] {
  const stored = storage.getJson<HoldingRow[]>(HOLDINGS_KEY);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return DEFAULT_HOLDINGS;
}

/** Daily-bar count → % (fraction input). */
const fmtPct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`;
/** Already-percent value → % (drawdowns, returns). */
const fmtPctNum = (v: number, digits = 1): string => `${v.toFixed(digits)}%`;
/** Beta / correlation with degenerate-null guard. */
const fmtRatio = (v: number | null): string =>
  v !== null && Number.isFinite(v) ? v.toFixed(2) : '—';

export default function PortfolioRisk() {
  const [holdings, setHoldings] = useState<HoldingRow[]>(loadHoldings);
  const [benchmark, setBenchmark] = useState(() => storage.getItem(BENCH_KEY) ?? 'SPY');
  const [windowDays, setWindowDays] = useState(() => Number(storage.getItem(WINDOW_KEY)) || 252);
  const [report, setReport] = useState<RiskReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;

  const runAnalysis = async (rows: HoldingRow[], bench: string, days: number): Promise<void> => {
    setLoading(true);
    setError(null);
    setWarnings([]);
    setReport(null);
    try {
      const clean = rows
        .map(r => ({ symbol: r.symbol.trim().toUpperCase(), weight: r.weight }))
        .filter(r => r.symbol);
      if (!clean.length) {
        setError('Add at least one holding');
        return;
      }

      const symbols = [...new Set([bench, ...clean.map(r => r.symbol)])];
      const holdingSet = new Set(clean.map(r => r.symbol));
      const barsBySym = new Map<string, StockData[]>();
      const sectorBySym = new Map<string, string>();
      const warns: string[] = [];

      for (let i = 0; i < symbols.length; i += 4) {
        const chunk = symbols.slice(i, i + 4);
        await Promise.all(chunk.map(async sym => {
          try {
            const hist = await fetchHistoricalData(sym);
            if (hist.data && hist.data.length > 0 && hist.isRealData) {
              barsBySym.set(sym, hist.data);
            } else {
              warns.push(`${sym}: no real bar data — excluded`);
            }
          } catch (e) {
            warns.push(`${sym}: ${e instanceof Error ? e.message : 'bar fetch failed'}`);
          }
          if (holdingSet.has(sym)) {
            const curated = popularStocks.find(s => s.symbol === sym);
            if (curated?.sector && curated.sector !== 'Unknown') {
              sectorBySym.set(sym, curated.sector);
            } else {
              try {
                const quote = await fetchStockQuote(sym);
                if (quote.data?.sector && quote.data.sector !== 'Unknown') {
                  sectorBySym.set(sym, quote.data.sector);
                }
              } catch { /* sector stays Unknown */ }
            }
          }
        }));
        if (i + 4 < symbols.length) await new Promise(r => setTimeout(r, 120));
      }

      const { report: computed, error: computeError } = computeRiskReport({
        benchmarkSymbol: bench,
        benchmarkBars: barsBySym.get(bench) ?? [],
        holdings: clean.map(r => ({
          symbol: r.symbol,
          sector: sectorBySym.get(r.symbol) ?? 'Unknown',
          weight: r.weight,
          bars: barsBySym.get(r.symbol) ?? [],
        })),
        lookback: days,
      });
      if (computeError) setError(computeError);
      else setReport(computed);
      setWarnings(warns);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load market data');
    } finally {
      setLoading(false);
    }
  };

  const runRef = useRef(runAnalysis);
  runRef.current = runAnalysis;

  useEffect(() => {
    void runRef.current(holdingsRef.current, 'SPY', 252);
    // mount-only: later runs are explicit (Run button / saved controls)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { storage.setJson(HOLDINGS_KEY, holdings); }, [holdings]);
  useEffect(() => { storage.setItem(BENCH_KEY, benchmark); }, [benchmark]);
  useEffect(() => { storage.setItem(WINDOW_KEY, String(windowDays)); }, [windowDays]);

  const updateRow = (i: number, patch: Partial<HoldingRow>) =>
    setHoldings(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) => setHoldings(prev => prev.filter((_, j) => j !== i));

  const addRow = () => setHoldings(prev => [...prev, { symbol: '', weight: 10 }]);

  const importWatchlist = () => {
    const watchlist = storage.getJson<string[]>(WATCHLIST_KEY);
    if (!Array.isArray(watchlist) || watchlist.length === 0) {
      toast.info('Watchlist is empty — add symbols in Settings first');
      return;
    }
    const weight = Math.round((100 / watchlist.length) * 10) / 10;
    setHoldings(watchlist.map(symbol => ({ symbol, weight })));
    toast.success(`Loaded ${watchlist.length} watchlist symbols`);
  };

  const concentrationLabel = (hhi: number): { label: string; destructive: boolean } => {
    if (hhi > 0.25) return { label: 'Concentrated', destructive: true };
    if (hhi > 0.15) return { label: 'Moderate', destructive: false };
    return { label: 'Diversified', destructive: false };
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Activity className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Portfolio Risk</h1>
              <p className="text-xs text-muted-foreground">
                Beta, volatility, drawdown and sector concentration against a benchmark —
                computed from real daily bars, rule-based only.
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-2" onClick={() => void runAnalysis(holdings, benchmark, windowDays)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run analysis
          </Button>
        </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart className="h-4 w-4 text-primary" /> Book &amp; window
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Benchmark</label>
                <Select value={benchmark} onValueChange={setBenchmark}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BENCHMARKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Window</label>
                <Select value={String(windowDays)} onValueChange={v => setWindowDays(Number(v))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WINDOWS.map(w => (
                      <SelectItem key={w.days} value={String(w.days)}>{w.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Holdings (weight = % of capital)</label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={importWatchlist}>
                    <Star className="h-3.5 w-3.5" /> Use watchlist
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={addRow}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              </div>
              {holdings.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.symbol}
                    onChange={e => updateRow(i, { symbol: e.target.value.toUpperCase() })}
                    placeholder="SYMBOL"
                    className="w-32 uppercase"
                    aria-label={`Holding ${i + 1} symbol`}
                  />
                  <Input
                    type="number"
                    min={0}
                    value={row.weight}
                    onChange={e => updateRow(i, { weight: Number(e.target.value) })}
                    className="w-24"
                    aria-label={`Holding ${i + 1} weight percent`}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(i)}
                    disabled={holdings.length <= 1}
                    aria-label={`Remove holding ${row.symbol || i + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {warnings.length > 0 && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription>
              <ul className="list-disc list-inside space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && !report && !error && (
          <Card>
            <CardContent className="py-10 flex items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Fetching daily bars and computing risk…
            </CardContent>
          </Card>
        )}

        {report && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio beta</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{fmtRatio(report.portfolioBeta)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    vs {report.benchmark} · moves {report.portfolioBeta !== null && report.portfolioBeta > 1 ? 'harder' : 'softer'} than the index
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Volatility (annualized)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{fmtPct(report.portfolioVolatility)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {report.benchmark} {fmtPct(report.benchmarkVolatility)} ·
                    diversification {report.diversificationBenefit >= 0 ? '+' : ''}
                    {(report.diversificationBenefit * 100).toFixed(1)}pp
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Worst drawdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-destructive">{fmtPctNum(report.portfolioMaxDrawdown)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    peak-to-trough · {report.portfolioDrawdownDuration} sessions underwater
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">5% stress line</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {report.stressBenchmark5pct !== null
                      ? `≈ ${fmtPct(report.stressBenchmark5pct)}`
                      : '—'}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    if {report.benchmark} drops 5% (β-adjusted)
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Growth chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Growth of 100</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Portfolio {fmtPctNum(report.portfolioReturn)} vs {report.benchmark} {fmtPctNum(report.benchmarkReturn)}
                    {' · '}{report.startDate} → {report.endDate} · {report.observations} sessions
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={report.curve} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 30%)" opacity={0.4} />
                      <XAxis
                        dataKey="date"
                        minTickGap={60}
                        tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }}
                        tickFormatter={(v: string) => v.slice(2)}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        width={44}
                        tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{ background: 'hsl(220, 14%, 12%)', border: '1px solid hsl(215, 20%, 30%)', borderRadius: 8, fontSize: 12 }}
                        formatter={(value: number, name: string) => [value.toFixed(1), name]}
                        labelFormatter={(label: string) => label}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="benchmark" name={report.benchmark} stroke="hsl(45, 90%, 55%)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Holdings table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Holdings</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-2 pr-4">Symbol</th>
                      <th className="py-2 pr-4">Sector</th>
                      <th className="py-2 pr-4 text-right">Weight</th>
                      <th className="py-2 pr-4 text-right">Beta</th>
                      <th className="py-2 pr-4 text-right">Correlation</th>
                      <th className="py-2 pr-4 text-right">Ann. vol</th>
                      <th className="py-2 pr-4 text-right">Max DD</th>
                      <th className="py-2 text-right">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.holdings.map(h => (
                      <tr key={h.symbol} className="border-t border-border">
                        <td className="py-2 pr-4 font-medium">{h.symbol}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{h.sector}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmtPct(h.weight)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmtRatio(h.beta)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmtRatio(h.correlation)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmtPct(h.annualVol)}</td>
                        <td className="py-2 pr-4 text-right font-mono text-destructive">{fmtPctNum(h.worstDrawdown)}</td>
                        <td className={`py-2 text-right font-mono ${h.totalReturn >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {fmtPctNum(h.totalReturn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Sector concentration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span>Sector concentration</span>
                  <Badge variant={concentrationLabel(report.sectorHHI).destructive ? 'destructive' : 'secondary'}>
                    {concentrationLabel(report.sectorHHI).label} · HHI {report.sectorHHI.toFixed(2)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.sectors.map(s => (
                  <div key={s.sector} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{s.sector}</span>
                      <span className="font-mono text-muted-foreground">{fmtPct(s.weight)}</span>
                    </div>
                    <Progress value={s.weight * 100} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <BackToTop />
    </div>
  );
}
