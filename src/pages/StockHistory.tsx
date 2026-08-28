import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarPlus, Crown, History, TrendingUp, TrendingDown, Minus,
  DatabaseZap, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Header } from '@/components/Header';
import { loadMatrix, backfillStockHistory, BackfillResult } from '@/hooks/useMasterMatrix';
import { MASTER_ORDER } from '@/lib/masterAnalysis';
import { cn } from '@/lib/utils';

function verdictCellClass(v: string): string {
  switch (v) {
    case 'BUY': return 'bg-success/20 text-success border-success/30 font-bold';
    case 'HOLD': return 'bg-warning/20 text-warning border-warning/30';
    case 'SELL': return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'AVOID': return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'WATCH': return 'bg-muted text-muted-foreground border-border';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function signatureHelp(verdict: string): string {
  switch (verdict) {
    case 'BUY': return 'B';
    case 'HOLD': return 'H';
    case 'SELL': return 'S';
    case 'AVOID': return 'A';
    case 'WATCH': return 'W';
    default: return '—';
  }
}

const masterNames: Record<string, string> = {
  'buffett-graham': 'Buffett/Graham',
  'peter-lynch': 'Lynch',
  'greenblatt': 'Greenblatt',
  'livermore': 'Livermore',
  'munger': 'Munger',
  'marks': 'Marks',
  'templeton': 'Templeton',
  'minervini': 'Minervini',
  'oneil': "O'Neil",
  'weinstein': 'Weinstein',
  'darvas': 'Darvas',
  'wyckoff': 'Wyckoff',
};

export default function StockHistory() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = symbol?.toUpperCase() ?? '';

  const [refresh, setRefresh] = useState(0);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);

  const snapshots = useMemo(() => {
    const all = loadMatrix();
    return all
      .filter(s => s.stocks[sym])
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [sym, refresh]);

  const handleBackfill = async () => {
    if (!sym || backfilling) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const r = await backfillStockHistory(sym, 365);
      setBackfillResult(r);
      setRefresh(x => x + 1);
    } finally {
      setBackfilling(false);
    }
  };

  const rows = snapshots.map(s => ({ date: s.date, source: s.source, row: s.stocks[sym] }));
  const first = rows[0];
  const last = rows[rows.length - 1];

  const avgBuy = rows.length > 0
    ? Math.round(rows.reduce((sum, r) => sum + r.row.buyCount, 0) / rows.length)
    : 0;
  const maxBuy = rows.reduce((m, r) => Math.max(m, r.row.buyCount), 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="mb-6">
          <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
            <Link to="/masters-matrix">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Master Matrix
            </Link>
          </Button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <History className="h-8 w-8 text-primary" />
                <span className="font-mono">{sym || '—'}</span>
              </h1>
              <p className="text-muted-foreground mt-2">
                {rows.length} recorded day{rows.length === 1 ? '' : 's'} of 12-master analysis across the accumulated matrix.
              </p>
            </div>
            {last && (
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="outline" className="gap-1 font-mono">
                  <Crown className="h-3.5 w-3.5 text-warning" />
                  BUY {last.row.buyCount}/12
                </Badge>
                <Badge variant={last.source === 'supabase' ? 'default' : 'outline'} className="font-mono">
                  {last.source === 'supabase' ? 'Stored' : 'Live'}
                </Badge>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              className="gap-2"
              onClick={handleBackfill}
              disabled={backfilling || !sym}
              title="Run the 12 masters against stored OHLCV history for every day of the past year and fill in historical snapshots"
            >
              {backfilling
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <DatabaseZap className="h-4 w-4" />}
              {backfilling ? 'Backfilling...' : 'Backfill past year'}
            </Button>
            {backfillResult && (
              <span className={cn(
                'text-xs',
                backfillResult.ok ? 'text-success' : 'text-destructive'
              )}>
                {backfillResult.ok
                  ? `Backfilled ${backfillResult.daysBackfilled} days (${backfillResult.fromDate} → ${backfillResult.toDate})`
                  : backfillResult.error}
              </span>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No snapshots recorded yet for <span className="font-mono font-medium text-foreground">{sym || 'this symbol'}</span>.
              Go to the <Link to="/masters-matrix" className="text-primary underline">Master Matrix</Link>, run an analysis,
              then click <b>Record Today</b> each day to build up history.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-3xl font-bold text-primary">{rows.length}</div>
                  <div className="text-xs text-muted-foreground">Days tracked</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-3xl font-bold text-success">{avgBuy}/12</div>
                  <div className="text-xs text-muted-foreground">Avg BUY count</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-3xl font-bold text-warning">{maxBuy}/12</div>
                  <div className="text-xs text-muted-foreground">Peak BUY count</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-3xl font-bold text-foreground">{first?.source === 'supabase' ? 'S' : 'L'}</div>
                  <div className="text-xs text-muted-foreground">Source (Stored/Live)</div>
                </CardContent>
              </Card>
            </div>

            {/* History table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarPlus className="h-4 w-4 text-primary" />
                  Daily analysis history — {sym}
                </CardTitle>
                <CardDescription>
                  Each row is one day's snapshot. B=BUY H=HOLD W=WATCH S=SELL A=AVOID. The ▲/▼ column shows the
                  BUY count vs the previous recorded day.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[100px]">Date</TableHead>
                      <TableHead className="text-center">Src</TableHead>
                      <TableHead className="text-center">BUY#</TableHead>
                      <TableHead className="text-center">Δ</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Chg%</TableHead>
                      {MASTER_ORDER.map(id => (
                        <TableHead key={id} title={masterNames[id] ?? id} className="text-center min-w-[52px]">
                          <span className="text-[10px] text-muted-foreground">{masterNames[id]}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rows].reverse().map((r, i, arr) => {
                      const prev = arr[i + 1]; // previous day (rows are reversed to newest-first)
                      const delta = prev ? r.row.buyCount - prev.row.buyCount : null;
                      return (
                        <TableRow key={r.date}>
                          <TableCell className="font-mono font-medium whitespace-nowrap">{r.date}</TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] px-1.5 py-0',
                                r.source === 'supabase'
                                  ? 'border-primary/40 text-primary'
                                  : 'border-muted-foreground/40 text-muted-foreground'
                              )}
                            >
                              {r.source === 'supabase' ? 'S' : 'L'}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn('text-center font-mono font-bold', r.row.buyCount >= 6 ? 'text-success' : r.row.buyCount >= 3 ? 'text-warning' : 'text-muted-foreground')}>
                            {r.row.buyCount}/12
                          </TableCell>
                          <TableCell className="text-center">
                            {delta === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : delta === 0 ? (
                              <Minus className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
                            ) : delta > 0 ? (
                              <TrendingUp className="h-3.5 w-3.5 mx-auto text-success" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5 mx-auto text-destructive" />
                            )}
                          </TableCell>
                          <TableCell className="text-center font-mono">{r.row.score != null ? r.row.score.toFixed(1) : '—'}</TableCell>
                          <TableCell className="text-right font-mono">${r.row.price != null ? r.row.price.toFixed(2) : '—'}</TableCell>
                          <TableCell className={cn('text-right font-mono', r.row.changePercent != null && r.row.changePercent >= 0 ? 'text-success' : 'text-destructive')}>
                            {r.row.changePercent != null
                              ? (r.row.changePercent >= 0 ? '+' : '') + r.row.changePercent.toFixed(1) + '%'
                              : '—'}
                          </TableCell>
                          {MASTER_ORDER.map(id => {
                            const verdict = r.row.verdicts?.[id] ?? '—';
                            return (
                              <TableCell key={id} className="text-center">
                                <Badge className={cn('border px-1.5 py-0.5 text-[10px]', verdictCellClass(verdict))}>
                                  {signatureHelp(verdict)}
                                </Badge>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
