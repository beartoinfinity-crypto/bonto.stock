import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useStockData } from '@/hooks/useStockData';
import { Header } from '@/components/Header';
import { fetchEarningsSurprises, EarningsSurpriseRow } from '@/lib/stockApi';
import {
  computePEAD, PEADResult, PEADEvent, EarningsSurpriseDirection, QuarterlyEarnings,
} from '@/lib/peadAnalysis';
import { toast } from 'sonner';
import {
  SearchCode, TrendingUp, TrendingDown, Minus, AlertTriangle, Loader2, Waves, CalendarDays,
} from 'lucide-react';

const DIRECTION_META: Record<string, { label: string; cls: string; bar: string; desc: string; icon: React.ReactNode }> = {
  BEAT: { label: 'Bullish (Drift Long)', cls: 'text-emerald-400', bar: 'bg-emerald-500', desc: 'Earnings surprise is positive — the post-earnings drift argues for a long / hold position while the window is fresh.', icon: <TrendingUp className="h-4 w-4" /> },
  MISS: { label: 'Bearish (Drift Short/Flat)', cls: 'text-red-400', bar: 'bg-red-500', desc: 'Earnings surprise is negative — the post-earnings drift argues against holding (short or flatten) while the window is fresh.', icon: <TrendingDown className="h-4 w-4" /> },
  NO_VIEW: { label: 'No View (Abstain)', cls: 'text-muted-foreground', bar: 'bg-muted', desc: 'No recent BEAT/MISS surprise is on record, so the alpha model expresses no conviction.', icon: <Minus className="h-4 w-4" /> },
};

const SURPRISE_BADGE: Record<EarningsSurpriseDirection, { variant: 'default' | 'destructive' | 'secondary'; cls: string }> = {
  BEAT: { variant: 'default', cls: '' },
  MISS: { variant: 'destructive', cls: '' },
  INLINE: { variant: 'secondary', cls: '' },
};

function toQuarterly(rows: EarningsSurpriseRow[]): QuarterlyEarnings[] {
  return rows.map((r) => ({
    period: r.period,
    actual: r.actual,
    estimate: r.estimate,
    surprise: r.surprise,
    surprisePercent: r.surprisePercent,
  }));
}

export default function HedgeFundPage() {
  const { selectedStock, setSelectedStock } = useStockData();
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [withEarnings, setWithEarnings] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PEADResult | null>(null);

  const symbol = selectedStock.symbol;

  const analyze = async (s: string) => {
    const sym = s.trim().toUpperCase();
    if (!sym) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setWithEarnings(null);
    try {
      const rows = await fetchEarningsSurprises(sym);
      if (rows && rows.length > 0) {
        const res = computePEAD(sym, toQuarterly(rows), new Date().toISOString());
        setWithEarnings(true);
        setResult(res);
        setSelectedStock({ ...selectedStock, symbol: sym });
      } else {
        setWithEarnings(false);
        toast.warning(`No earnings-surprise data available for "${sym}".`, { duration: 5000 });
      }
      setSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not analyze "${sym}".`);
    } finally {
      setRunning(false);
    }
  };

  const recent = result?.recentEvent;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-6xl mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Waves className="h-6 w-6 text-primary" />
            Hedge Fund — PEAD Alpha Model
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            A rule-based React port of the <b>Post-Earnings Announcement Drift</b> alpha model from the
            ai-hedge-fund quant stack. Quarterly EPS surprises (BEAT / MISS) drive a conviction in [-1, +1];
            the market tends to underreact to a surprise and drift in its direction for weeks. No AI APIs —
            deterministic math over earnings actuals vs estimates.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch">
              <div className="flex-1 flex gap-2">
                <Input
                  placeholder="Enter ticker, e.g. NVDA, AAPL"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && analyze(search)}
                  disabled={running}
                />
                <Button variant="outline" onClick={() => analyze(search)} disabled={running} className="shrink-0">
                  Search
                </Button>
              </div>
              <Button onClick={() => analyze(search.trim() ? search : symbol)} disabled={running} className="gap-2 shrink-0">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Waves className="h-4 w-4" />}
                {running ? 'Analyzing…' : 'Run PEAD'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Now analyzing</span>
              <Badge variant="outline" className="font-mono">{symbol || '—'}</Badge>
              {!running && !result && (
                <span className="hidden sm:inline">— type a ticker and hit <b>Run PEAD</b> to score the drift signal</span>
              )}
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </CardContent>
          </Card>
        )}

        {withEarnings === false && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
              <p>No earnings-surprise (BEAT/MISS) history is available for {symbol} from the data provider.</p>
            </CardContent>
          </Card>
        )}

        {!result && !running && withEarnings === null && (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              <SearchCode className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
              <p>Select or type a symbol and press <b>Run PEAD</b> to score {symbol || 'your stock'} for post-earnings-announcement drift.</p>
            </CardContent>
          </Card>
        )}

        {result && <Report result={result} />}
      </main>
    </div>
  );
}

function Report({ result }: { result: PEADResult }) {
  const meta = DIRECTION_META[result.direction] ?? DIRECTION_META.NO_VIEW;
  const recent = result.recentEvent;
  const pct = Math.abs(Math.round(result.signal * 100));

  return (
    <div className="space-y-5">
      {/* Hero */}
      <Card className="overflow-hidden">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-bold">{result.symbol}</h2>
                <span className="text-muted-foreground">PEAD · Post-Earnings Drift</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground uppercase tracking-wide">As of {result.asOf.slice(0, 10)}</div>
            </div>
            <div className="text-right">
              <div className={`flex items-center gap-2 text-2xl font-extrabold ${meta.cls}`}>
                {meta.icon} {meta.label}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{meta.desc}</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Drift conviction</span>
            <span className="font-mono">{result.signal >= 0 ? '+' : ''}{result.signal.toFixed(2)} · {pct}%</span>
          </div>
          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
            <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${pct}%` }} />
          </div>

          {recent && (
            <div className="rounded-lg border p-3 text-sm">
              <div className="text-xs font-medium text-muted-foreground mb-1">Driving event</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={recent.direction === 'BEAT' ? 'default' : 'destructive'} className="gap-1">
                  {DIRECTION_META[recent.direction].icon} {recent.direction}
                </Badge>
                <span className="font-mono">{recent.period}</span>
                <Badge variant={result.windowOpen ? 'default' : 'secondary'}>
                  <CalendarDays className="h-3 w-3 mr-1" /> {result.windowOpen ? 'Drift window fresh' : 'Drift stale'}
                </Badge>
                {recent.surprisePercent != null && (
                  <span className={`font-mono ${recent.surprisePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    surprise {recent.surprisePercent >= 0 ? '+' : ''}{recent.surprisePercent.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">{result.reasoning}</p>
        </CardContent>
      </Card>

      {/* Earnings history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-primary" /> Quarterly Earnings Surprises
          </CardTitle>
        </CardHeader>
        <CardContent>
          {result.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usable earnings actual/estimate pairs in the returned data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                  <TableHead className="text-right">Surprise %</TableHead>
                  <TableHead>Verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.history.slice().reverse().map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{e.period}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.quarterEnd ?? '—'}</TableCell>
                    <TableCell className="text-right text-sm">{e.surprise != null ? e.surprise.toFixed(2) : '—'}</TableCell>
                    <TableCell className="text-right text-sm">{e.surprisePercent != null ? e.surprisePercent.toFixed(1) + '%' : '—'}</TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      <span className={e.surprisePercent != null && e.surprisePercent >= 0 ? 'text-emerald-500' : e.surprisePercent != null && e.surprisePercent < 0 ? 'text-red-500' : ''}>
                        {e.surprisePercent != null ? (e.surprisePercent >= 0 ? '+' : '') + e.surprisePercent.toFixed(1) + '%' : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SURPRISE_BADGE[e.direction].variant} className={SURPRISE_BADGE[e.direction].cls}>
                        {e.direction}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Why it works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-primary" /> The Drift &amp; How This Page Scores It
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <b>PEAD</b> is a well-documented anomaly: after a company reports an earnings surprise, its stock tends
            to keep drifting in the surprise direction over the following days and weeks as the market slowly
            reprices the news. This alpha model exploits that underreaction.
          </p>
          <ul className="list-disc ml-5 space-y-1">
            <li>Each quarter is classified <Badge variant="default">BEAT</Badge>, <Badge variant="destructive">MISS</Badge>, or <Badge variant="secondary">INLINE</Badge> from the surprise %, with a ±1% tolerance band.</li>
            <li>The most recent non-INLINE surprise drives the signal: a BEAT pushes conviction toward <b>+1</b>, a MISS toward <b>-1</b>, scaled by surprise magnitude (±25% saturates).</li>
            <li>A fresh surprise (within the 45-day drift window) counts at full conviction; an older one still reports a residual lean but is flagged <b>stale</b>.</li>
            <li>No surprise on record → conviction falls to <b>0</b> and the model abstains (no view).</li>
          </ul>
          <p>
            Like the rest of this app, everything here is <b>rule-based — no AI/ML/LLM APIs</b> are called; this is a TypeScript
            port of the ai-hedge-fund <code>pead.py</code> alpha model.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
