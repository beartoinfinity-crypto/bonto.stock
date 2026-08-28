import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Search, Filter, ArrowUpDown, Database, Grid3X3,
  CalendarPlus, CheckCircle2, Circle, Crown, TrendingUp, TrendingDown,
  Plus, X, Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Header } from '@/components/Header';
import { useMasterMatrix, VerdictFilter } from '@/hooks/useMasterMatrix';
import { UNIVERSES } from '@/lib/masterAnalysis';
import { cn } from '@/lib/utils';

function verdictCellClass(v: string): string {
  switch (v) {
    case 'BUY': return 'bg-success/20 text-success border-success/30 font-bold';
    case 'HOLD': return 'bg-warning/20 text-warning border-warning/30';
    case 'SELL': return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'AVOID': return 'bg-destructive/20 text-destructive border-destructive/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function signatureHelp(verdict: string): string {
  switch (verdict) {
    case 'BUY': return 'B';
    case 'HOLD': return 'H';
    case 'SELL': return 'S';
    case 'AVOID': return 'A';
    default: return 'W';
  }
}

export default function MasterMatrix() {
  const {
    results, isLoading, progress, totalStocks, lastUpdated, fromCache,
    search, setSearch, sectorFilter, setSectorFilter,
    verdictFilter, setVerdictFilter,
    universeId, setUniverseId,
    customSymbols, addCustomSymbol, removeCustomSymbol,
    snapshots, recordedToday, lastRecordedAt,
    runAnalysis, loadFromSupabase, dataSource, supabaseInfo,
    recordToday, masterLabels, sectors,
  } = useMasterMatrix();

  const [sortField, setSortField] = useState<'score' | 'price' | 'change' | 'symbol'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [customInput, setCustomInput] = useState('');

  const orderedResults = [...results].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'score') cmp = a.score - b.score;
    else if (sortField === 'price') cmp = a.price - b.price;
    else if (sortField === 'change') cmp = a.changePercent - b.changePercent;
    else cmp = a.symbol.localeCompare(b.symbol);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (field: 'score' | 'price' | 'change' | 'symbol') => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  // Accumulated tally across all recorded snapshots
  const accumulated = new Map<string, { days: number; totalBuy: number }>();
  for (const snap of snapshots) {
    for (const [symbol, row] of Object.entries(snap.stocks)) {
      const cur = accumulated.get(symbol) ?? { days: 0, totalBuy: 0 };
      cur.days += 1;
      cur.totalBuy += row.buyCount;
      accumulated.set(symbol, cur);
    }
  }

  const lastSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const isPositive = (v: number) => v >= 0;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Title */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Grid3X3 className="h-8 w-8 text-primary" />
              Master Matrix
            </h1>
            <p className="text-muted-foreground mt-2">
              Top {Math.min(totalStocks, 50)} stocks in the selected universe screened by the 12 trading
              masters. Each day's results are recorded into an accumulating matrix.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1">
                <Database className="h-3.5 w-3.5" />
                {dataSource === 'supabase' ? 'Stored (Supabase)' : fromCache ? 'Cached' : 'Live'} · {lastUpdated.toLocaleString()}
              </span>
            )}
            <Button
              variant={dataSource === 'supabase' ? 'default' : 'outline'}
              size="sm"
              className="gap-2"
              onClick={() => loadFromSupabase()}
              disabled={isLoading}
              title="Rebuild the matrix from OHLCV history already stored in Supabase (no live fetch)"
            >
              <Database className={cn('h-4 w-4', isLoading && dataSource === 'supabase' && 'animate-pulse')} />
              Stored Data
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => runAnalysis(true)} disabled={isLoading}>
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Live
            </Button>
            <Button size="sm" className="gap-2" onClick={recordToday} disabled={results.length === 0}>
              <CalendarPlus className="h-4 w-4" />
              Record Today
            </Button>
          </div>
        </div>

        {/* Progress */}
        {isLoading && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex justify-between mb-2 text-sm">
                <span className="text-muted-foreground">Analyzing the {UNIVERSES.find(u => u.id === universeId)?.label ?? 'S&amp;P 500'} universe with 12 masters...</span>
                <span className="font-mono">{progress} / {totalStocks}</span>
              </div>
              <Progress value={totalStocks > 0 ? (progress / totalStocks) * 100 : 0} className="h-2" />
            </CardContent>
          </Card>
        )}

        {/* Supabase stored-data status */}
        {supabaseInfo && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardContent className="py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                  <Database className="h-4 w-4" />
                  {dataSource === 'supabase' ? 'Built from stored Supabase history' : 'Supabase history loaded'}
                </span>
                <span className="text-muted-foreground">
                  {supabaseInfo.coveredSymbols.length} S&amp;P 500 stocks · {supabaseInfo.totalBars.toLocaleString()} daily bars
                </span>
                {supabaseInfo.lastBarDate && (
                  <span className="text-muted-foreground">through {supabaseInfo.lastBarDate}</span>
                )}
                {supabaseInfo.error && (
                  <span className="text-destructive">{supabaseInfo.error}</span>
                )}
                {(supabaseInfo.coveredSymbols.length > 0) && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {supabaseInfo.coveredSymbols.join(', ')}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Universe + custom stocks */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Universe &amp; Custom Stocks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Index universe</label>
                <div className="flex gap-2">
                  {UNIVERSES.map(u => (
                    <Button
                      key={u.id}
                      size="sm"
                      variant={universeId === u.id ? 'default' : 'outline'}
                      onClick={() => setUniverseId(u.id)}
                      disabled={isLoading}
                    >
                      {u.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5 flex-1 max-w-xs min-w-[220px]">
                <label className="text-xs text-muted-foreground">Add a stock by ticker</label>
                <div className="flex gap-2">
                  <Input
                    value={customInput}
                    onChange={e => setCustomInput(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (addCustomSymbol(customInput)) setCustomInput('');
                      }
                    }}
                    placeholder="e.g. SPY, NVDA, BRK.B"
                    className="font-mono"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => { if (addCustomSymbol(customInput)) setCustomInput(''); }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  1–6 letters (allow . and -). Live data or stored Supabase history is used if available.
                </p>
              </div>
            </div>

            {customSymbols.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Custom:</span>
                {customSymbols.map(sym => (
                  <Badge key={sym} variant="secondary" className="gap-1.5 font-mono">
                    {sym}
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeCustomSymbol(sym)}
                      aria-label={`Remove ${sym}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status + stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-primary">{results.length}</div>
              <div className="text-xs text-muted-foreground">Stocks shown</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-success">{results.filter(r => r.buyCount >= 6).length}</div>
              <div className="text-xs text-muted-foreground">Strong buy (&ge;6 BUY)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-warning">{snapshots.length}</div>
              <div className="text-xs text-muted-foreground">Days recorded</div>
            </CardContent>
          </Card>
          <Card className={cn(recordedToday ? 'bg-success/10 border-success/30' : '')}>
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold flex items-center justify-center gap-1.5">
                <CheckCircle2 className={cn('h-6 w-6', recordedToday ? 'text-success' : 'text-muted-foreground')} />
                {recordedToday ? 'Yes' : 'No'}
              </div>
              <div className="text-xs text-muted-foreground">Recorded today</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              Search &amp; Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5 flex-1 min-w-[200px] max-w-xs">
                <label className="text-xs text-muted-foreground">Search stock</label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Symbol or name (e.g. NVDA)"
                    className="pl-9 font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Sector</label>
                <Select value={sectorFilter} onValueChange={setSectorFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sectors</SelectItem>
                    {sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Master call</label>
                <Select value={verdictFilter} onValueChange={v => setVerdictFilter(v as VerdictFilter)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All calls</SelectItem>
                    <SelectItem value="any-buy">Any BUY</SelectItem>
                    <SelectItem value="BUY">BUY</SelectItem>
                    <SelectItem value="HOLD">HOLD</SelectItem>
                    <SelectItem value="WATCH">WATCH</SelectItem>
                    <SelectItem value="SELL">SELL</SelectItem>
                    <SelectItem value="AVOID">AVOID</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {lastRecordedAt && (
                <div className="text-xs text-muted-foreground pb-2">
                  Last snapshot: {new Date(lastRecordedAt).toLocaleString()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Master Matrix Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-warning" />
              Daily Master Matrix — {dataSource === 'supabase' ? `${results.length} stored` : `top ${MASTER_MATRIX_SIZE_LABEL}`}
            </CardTitle>
            <CardDescription>
              Rows are stocks; columns are the 12 masters. B=BUY H=HOLD W=WATCH S=SELL A=AVOID.
              Click a column header to sort. Records one snapshot per day, accumulated over time.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort('symbol')}>
                    <div className="flex items-center gap-1">Symbol {sortField === 'symbol' && <ArrowUpDown className="h-3 w-3" />}</div>
                  </TableHead>
                  <TableHead
                    className={cn('cursor-pointer hover:text-foreground', sortField === 'score' && 'text-warning')}
                    onClick={() => toggleSort('score')}
                  >
                    <div className="flex items-center gap-1">BUY# {sortField === 'score' && <ArrowUpDown className="h-3 w-3" />}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort('price')}>
                    <div className="flex items-center gap-1">Price {sortField === 'price' && <ArrowUpDown className="h-3 w-3" />}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => toggleSort('change')}>
                    <div className="flex items-center gap-1">Chg% {sortField === 'change' && <ArrowUpDown className="h-3 w-3" />}</div>
                  </TableHead>
                  {masterLabels.map(m => (
                    <TableHead key={m.id} title={m.name} className="text-center min-w-[52px]">
                      <span className="text-[10px] text-muted-foreground">{m.name}</span>
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Last</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedResults.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6 + masterLabels.length} className="text-center py-8 text-muted-foreground">
                      No stocks match your filters.
                    </TableCell>
                  </TableRow>
                ) : orderedResults.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6 + masterLabels.length} className="text-center py-8 text-muted-foreground">
                      <RefreshCw className="h-4 w-4 inline animate-spin mr-1" /> Analyzing...
                    </TableCell>
                  </TableRow>
                ) : (
                  orderedResults.map(r => {
                    const prev = lastSnapshot?.stocks[r.symbol];
                    const acc = accumulated.get(r.symbol);
                    return (
                      <TableRow key={r.symbol}>
                        <TableCell className="font-mono font-medium">
                          <Link to={`/?symbol=${r.symbol}`} className="hover:text-primary">{r.symbol}</Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className={cn('font-mono font-bold', r.buyCount >= 6 ? 'text-success' : r.buyCount >= 3 ? 'text-warning' : 'text-muted-foreground')}>
                              {r.buyCount}/12
                            </span>
                            {r.buyCount >= 6 && <Crown className="h-3.5 w-3.5 text-warning" />}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">${r.price?.toFixed(2) ?? '—'}</TableCell>
                        <TableCell className={cn('font-mono', isPositive(r.changePercent) ? 'text-success' : 'text-destructive')}>
                          {isPositive(r.changePercent) ? '+' : ''}{r.changePercent?.toFixed(1)}%
                        </TableCell>
                        {masterLabels.map(m => {
                          const master = r.analyses.find(a => a.id === m.id);
                          const verdict = master?.verdict ?? '—';
                          return (
                            <TableCell key={m.id} className="text-center">
                              <Badge className={cn('border px-1.5 py-0.5 text-[10px]', verdictCellClass(verdict))}>
                                {signatureHelp(verdict)}
                              </Badge>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center">
                          {prev ? (
                            <span className="text-xs flex items-center justify-center gap-1">
                              <span className="font-mono font-bold">{prev.buyCount}/12</span>
                              <span className={cn(
                                prev.buyCount === r.buyCount ? 'text-muted-foreground' : prev.buyCount < r.buyCount ? 'text-success' : 'text-destructive'
                              )}>
                                {prev.buyCount === r.buyCount ? '·' : prev.buyCount < r.buyCount ? '▲' : '▼'}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {acc && acc.days > 1 && (
                            <div className="text-[10px] text-muted-foreground">
                              {acc.days}d · avg {Math.round(acc.totalBuy / acc.days)} BUY
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Accumulated history */}
        <div className="mt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="history">
              <AccordionTrigger className="text-base font-semibold">
                <span className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Accumulated daily snapshots ({snapshots.length} days)
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {snapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No snapshots recorded yet. Run the analysis, then click <b>Record Today</b> to save a daily
                    snapshot. Over time each day accumulates into this history.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {[...snapshots].reverse().map(snap => {
                      const rows = Object.entries(snap.stocks)
                        .sort((a, b) => b[1].score - a[1].score)
                        .slice(0, 8);
                      return (
                        <div key={snap.date} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold flex items-center gap-2">
                              <CalendarPlus className="h-4 w-4 text-primary" />
                              {snap.date} — {Object.keys(snap.stocks).length} stocks
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(snap.capturedAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {rows.map(([symbol, row]) => (
                              <Link key={symbol} to={`/?symbol=${symbol}`}>
                                <Badge variant="outline" className="gap-1.5">
                                  <span className="font-mono">{symbol}</span>
                                  <span className="font-mono font-bold text-success">{row.buyCount}/12</span>
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-success/30 border border-success/40 inline-block" /> B = BUY</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-warning/30 border border-warning/40 inline-block" /> H = HOLD</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-destructive/30 border border-destructive/40 inline-block" /> S/A = SELL/AVOID</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted border border-border inline-block" /> W = WATCH</span>
          <span className="flex items-center gap-1"><Circle className="h-3 w-3" /> ▲/▼ = change vs last snapshot</span>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 p-4 rounded-lg bg-muted/30 border border-border text-center">
          <p className="text-xs text-muted-foreground">
            <TrendingDown className="h-3 w-3 inline mr-1" />
            Education only, not financial advice. Each master's call is a simplified approximation based on
            price and volume data. The matrix accumulates historical snapshots for review, not prediction.
          </p>
        </div>
      </div>
    </div>
  );
}

const MASTER_MATRIX_SIZE_LABEL = '50';
