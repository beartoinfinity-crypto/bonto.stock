import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Play, RefreshCw, TrendingUp, TrendingDown, Target, AlertTriangle,
  CalendarDays, RotateCcw, BarChart2, ArrowDownRight, Percent, GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { StockData, ForecastPoint, generateForecast, generateMonteCarloPaths, MonteCarloResult } from '@/lib/stockData';
import { cn } from '@/lib/utils';

interface ForecastSimulatorProps {
  data: StockData[];
  symbol: string;
}

const PATH_COUNT_OPTIONS = [10, 50, 100, 200];

export function ForecastSimulator({ data, symbol }: ForecastSimulatorProps) {
  const [forecastDays, setForecastDays] = useState(30);
  const [simCount, setSimCount] = useState(1);
  // single median path (original)
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  // multi-path Monte Carlo
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [numPaths, setNumPaths] = useState(50);
  const [isSimulating, setIsSimulating] = useState(false);
  const [backtestDays, setBacktestDays] = useState(0);

  const isBacktest = backtestDays > 0;
  const maxBacktestDays = Math.max(0, data.length - 100);
  const hasResult = forecast.length > 0 || mcResult !== null;

  const { simulationData, actualFuture, backtestDate } = useMemo(() => {
    if (backtestDays === 0 || backtestDays >= data.length) {
      return { simulationData: data, actualFuture: [] as StockData[], backtestDate: '' };
    }
    const cutoff = data.length - backtestDays;
    return {
      simulationData: data.slice(0, cutoff),
      actualFuture: data.slice(cutoff, cutoff + forecastDays),
      backtestDate: data[cutoff - 1]?.date || '',
    };
  }, [data, backtestDays, forecastDays]);

  const runSimulation = () => {
    setIsSimulating(true);
    setTimeout(() => {
      const singleForecast = generateForecast(simulationData, forecastDays);
      const mc = generateMonteCarloPaths(simulationData, forecastDays, numPaths);
      setForecast(singleForecast);
      setMcResult(mc);
      setSimCount(s => s + 1);
      setIsSimulating(false);
    }, 600);
  };

  const resetToLive = () => { setBacktestDays(0); setForecast([]); setMcResult(null); };

  // Build chart data: historical + percentile bands + sample paths + actual
  const chartData = useMemo(() => {
    const histSlice = simulationData.slice(-60).map(d => ({
      date: d.date,
      price: d.close,
      p10: undefined as number | undefined,
      p25: undefined as number | undefined,
      p50: undefined as number | undefined,
      p75: undefined as number | undefined,
      p90: undefined as number | undefined,
      actual: undefined as number | undefined,
      type: 'historical' as const,
    }));

    if (!mcResult) return histSlice;

    const forecastPoints = mcResult.dates.map((date, i) => ({
      date,
      price: undefined as number | undefined,
      p10: mcResult.p10[i],
      p25: mcResult.p25[i],
      p50: mcResult.p50[i],
      p75: mcResult.p75[i],
      p90: mcResult.p90[i],
      actual: isBacktest && actualFuture[i] ? actualFuture[i].close : undefined,
      type: 'forecast' as const,
    }));

    return [...histSlice, ...forecastPoints];
  }, [simulationData, mcResult, actualFuture, isBacktest]);

  // Sample paths for ghost lines (show up to 20 representative paths on chart)
  const samplePaths = useMemo(() => {
    if (!mcResult || mcResult.paths.length === 0) return [];
    const step = Math.max(1, Math.floor(mcResult.paths.length / 20));
    return mcResult.paths.filter((_, i) => i % step === 0).slice(0, 20);
  }, [mcResult]);

  // Build per-path series for chart
  const samplePathSeries = useMemo(() => {
    if (!mcResult || samplePaths.length === 0) return [];
    return samplePaths.map((p, pathIdx) => {
      const key = `path${pathIdx}`;
      return { key, data: p.path };
    });
  }, [mcResult, samplePaths]);

  const lastPrice = simulationData[simulationData.length - 1]?.close || 0;
  const p50Return = mcResult ? ((mcResult.p50[mcResult.p50.length - 1] - lastPrice) / lastPrice) * 100 : 0;
  const p10Return = mcResult ? ((mcResult.p10[mcResult.p10.length - 1] - lastPrice) / lastPrice) * 100 : 0;
  const p90Return = mcResult ? ((mcResult.p90[mcResult.p90.length - 1] - lastPrice) / lastPrice) * 100 : 0;

  // Return distribution stats
  const returnStats = useMemo(() => {
    if (!mcResult) return null;
    const returns = mcResult.paths.map(p => p.totalReturn);
    const bullish = returns.filter(r => r > 0).length;
    const bearish = returns.filter(r => r < 0).length;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length);
    return { bullish, bearish, total: returns.length, avgReturn, std };
  }, [mcResult]);

  // Backtest stats
  const backtestAccuracy = useMemo(() => {
    if (!isBacktest || !mcResult || actualFuture.length === 0) return null;
    const n = Math.min(mcResult.dates.length, actualFuture.length);
    const pairs = Array.from({ length: n }, (_, i) => ({
      predicted: mcResult.p50[i],
      actual: actualFuture[i].close,
    }));
    const mae = pairs.reduce((s, p) => s + Math.abs(p.predicted - p.actual), 0) / n;
    const maePercent = (mae / lastPrice) * 100;
    const rmse = Math.sqrt(pairs.reduce((s, p) => s + (p.predicted - p.actual) ** 2, 0) / n);
    const rmsePercent = (rmse / lastPrice) * 100;
    const directionCorrect = pairs.filter((p, i) => {
      const prevActual = i === 0 ? lastPrice : actualFuture[i - 1].close;
      const prevPred = i === 0 ? lastPrice : mcResult.p50[i - 1];
      return (p.predicted - prevPred) * (p.actual - prevActual) >= 0;
    }).length;
    const directionAccuracy = (directionCorrect / n) * 100;
    const lastActual = actualFuture[n - 1].close;
    const lastPred50 = mcResult.p50[n - 1];
    const endError = ((lastPred50 - lastActual) / lastActual) * 100;

    // How many paths captured actual price within P10-P90 band
    const inBand = Array.from({ length: n }, (_, i) =>
      actualFuture[i].close >= mcResult.p10[i] && actualFuture[i].close <= mcResult.p90[i]
    ).filter(Boolean).length;
    const coverageRate = (inBand / n) * 100;

    const maxDD = (prices: number[]) => {
      let peak = prices[0], maxD = 0;
      for (const p of prices) { if (p > peak) peak = p; const d = (peak - p) / peak; if (d > maxD) maxD = d; }
      return maxD * 100;
    };
    const predMaxDD = maxDD([lastPrice, ...mcResult.p50.slice(0, n)]);
    const actualMaxDD = maxDD([lastPrice, ...pairs.map(p => p.actual)]);

    return { mae: maePercent, rmse: rmsePercent, directionAccuracy, endError, coverageRate, predMaxDD, actualMaxDD, daysCompared: n };
  }, [isBacktest, mcResult, actualFuture, lastPrice]);

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            {isBacktest ? 'Backtest Simulator' : 'Monte Carlo Forecast'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isBacktest
              ? `Simulating from ${backtestDate} (${backtestDays} trading days ago)`
              : `${numPaths} independent paths · ${forecastDays}-day horizon`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isBacktest && (
            <Button variant="outline" size="sm" onClick={resetToLive} className="text-xs">
              <RotateCcw className="h-3 w-3 mr-1" /> Live Mode
            </Button>
          )}
          <Button
            onClick={runSimulation}
            disabled={isSimulating}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isSimulating ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {hasResult ? 'Re-simulate' : 'Run Simulation'}
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {/* Number of paths */}
        <div className="p-3 rounded-lg border border-border bg-secondary/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <GitBranch className="h-3.5 w-3.5 text-primary" /> Simulation Paths
            </div>
            <div className="flex gap-1">
              {PATH_COUNT_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => { setNumPaths(n); setMcResult(null); setForecast([]); }}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                    numPaths === n
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >{n}</button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">More paths = more accurate distribution</div>
        </div>

        {/* Backtest offset */}
        <div className="p-3 rounded-lg border border-border bg-secondary/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <CalendarDays className="h-3.5 w-3.5 text-primary" /> Backtest Offset
            </div>
            {backtestDays === 0
              ? <Badge variant="outline" className="text-[10px]">Live</Badge>
              : <Badge variant="secondary" className="text-[10px]">{backtestDays}d back · {backtestDate}</Badge>}
          </div>
          <Slider
            value={[backtestDays]}
            onValueChange={([v]) => { setBacktestDays(v); setForecast([]); setMcResult(null); }}
            min={0} max={maxBacktestDays} step={1}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Today</span>
            <span>{maxBacktestDays}d ago</span>
          </div>
        </div>
      </div>

      {isSimulating ? (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-secondary/50 rounded-lg p-3">
                <Skeleton className="h-3 w-20 mb-2" /><Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
          <div className="h-[300px] bg-secondary/30 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 text-primary mx-auto mb-3 animate-spin" />
              <p className="text-sm text-muted-foreground">Running {numPaths} Monte Carlo paths...</p>
            </div>
          </div>
        </div>
      ) : !hasResult ? (
        <div className="h-[300px] flex items-center justify-center bg-secondary/30 rounded-lg border border-dashed border-border">
          <div className="text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Click "Run Simulation" to generate {numPaths} Monte Carlo paths</p>
            <p className="text-xs text-muted-foreground mt-1">Displays P10/P25/P50/P75/P90 confidence bands</p>
          </div>
        </div>
      ) : (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="h-3 w-3" /> {isBacktest ? 'Start Price' : 'Current Price'}
              </div>
              <div className="font-mono font-bold text-lg">${lastPrice.toFixed(2)}</div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Target className="h-3 w-3" /> P50 Forecast
              </div>
              <div className="font-mono font-bold text-lg">${mcResult?.p50[mcResult.p50.length - 1].toFixed(2)}</div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                {p50Return >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                Median Return
              </div>
              <div className={cn('font-mono font-bold text-lg', p50Return >= 0 ? 'text-bullish' : 'text-bearish')}>
                {p50Return >= 0 ? '+' : ''}{p50Return.toFixed(2)}%
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <AlertTriangle className="h-3 w-3" /> Bullish Paths
              </div>
              <div className={cn('font-mono font-bold text-lg', (returnStats?.bullish ?? 0) >= numPaths / 2 ? 'text-bullish' : 'text-bearish')}>
                {returnStats ? Math.round((returnStats.bullish / returnStats.total) * 100) : 0}%
              </div>
            </div>
          </div>

          {/* Range row */}
          {mcResult && (
            <div className="mb-4 flex items-center gap-2 text-xs bg-secondary/30 rounded-lg px-3 py-2">
              <span className="text-muted-foreground">Range:</span>
              <span className={cn('font-mono font-semibold', p10Return < 0 ? 'text-bearish' : 'text-bullish')}>
                P10 {p10Return >= 0 ? '+' : ''}{p10Return.toFixed(1)}%
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={cn('font-mono font-semibold', p90Return >= 0 ? 'text-bullish' : 'text-bearish')}>
                P90 {p90Return >= 0 ? '+' : ''}{p90Return.toFixed(1)}%
              </span>
              {returnStats && (
                <>
                  <span className="text-muted-foreground ml-2">|</span>
                  <span className="text-muted-foreground">Avg: <span className={cn('font-mono font-semibold', returnStats.avgReturn >= 0 ? 'text-bullish' : 'text-bearish')}>{returnStats.avgReturn >= 0 ? '+' : ''}{returnStats.avgReturn.toFixed(2)}%</span></span>
                  <span className="text-muted-foreground">σ: <span className="font-mono font-semibold">{returnStats.std.toFixed(2)}%</span></span>
                </>
              )}
            </div>
          )}

          {/* Chart */}
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="bandOuter" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.08} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bandInner" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date" axisLine={false} tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={v => { const d = new Date(v); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }}
                  minTickGap={40}
                />
                <YAxis
                  axisLine={false} tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={v => `$${v.toFixed(0)}`}
                  orientation="right" width={60}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = { price: 'Price', p10: 'P10', p25: 'P25', p50: 'P50 (Median)', p75: 'P75', p90: 'P90', actual: 'Actual' };
                    return ['$' + value.toFixed(2), labels[name] || name];
                  }}
                />

                {/* P10–P90 outer band */}
                <Area type="monotone" dataKey="p90" stroke="none" fill="url(#bandOuter)" connectNulls />
                <Area type="monotone" dataKey="p10" stroke="none" fill="hsl(var(--background))" connectNulls />

                {/* P25–P75 inner band */}
                <Area type="monotone" dataKey="p75" stroke="none" fill="url(#bandInner)" connectNulls />
                <Area type="monotone" dataKey="p25" stroke="none" fill="hsl(var(--background))" connectNulls />

                {/* Band boundary lines */}
                <Line type="monotone" dataKey="p90" stroke="hsl(var(--primary))" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                <Line type="monotone" dataKey="p10" stroke="hsl(var(--primary))" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                <Line type="monotone" dataKey="p75" stroke="hsl(var(--primary))" strokeWidth={1} strokeOpacity={0.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="p25" stroke="hsl(var(--primary))" strokeWidth={1} strokeOpacity={0.5} dot={false} connectNulls />

                {/* Historical price */}
                <Line type="monotone" dataKey="price" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />

                {/* P50 median forecast */}
                <Line type="monotone" dataKey="p50" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} connectNulls />

                {/* Actual (backtest) */}
                {isBacktest && (
                  <Line type="monotone" dataKey="actual" stroke="hsl(45, 90%, 60%)" strokeWidth={2} dot={false} connectNulls />
                )}

                <ReferenceLine
                  x={simulationData[simulationData.length - 1]?.date}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="5 5"
                  label={{ value: isBacktest ? 'Backtest Start' : 'Today', fill: 'hsl(var(--primary))', fontSize: 11, position: 'top' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-foreground rounded" />
              <span className="text-muted-foreground">Historical</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-primary rounded" />
              <span className="text-muted-foreground">P50 Median</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm opacity-30 bg-primary" />
              <span className="text-muted-foreground">P25–P75 (50% CI)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm opacity-10 bg-primary" />
              <span className="text-muted-foreground">P10–P90 (80% CI)</span>
            </div>
            {isBacktest && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded" style={{ backgroundColor: 'hsl(45,90%,60%)' }} />
                <span className="text-muted-foreground">Actual</span>
              </div>
            )}
          </div>

          {/* Backtest stats */}
          {isBacktest && backtestAccuracy && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
              <div className="px-3 py-2 border-b border-primary/10 flex items-center justify-between">
                <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5" /> Backtest Results
                </p>
                <span className="text-[10px] text-muted-foreground">{backtestAccuracy.daysCompared} days · P50 vs Actual</span>
              </div>
              <div className="grid grid-cols-4 divide-x divide-border/50">
                {[
                  { label: 'MAE', value: backtestAccuracy.mae.toFixed(2) + '%', good: backtestAccuracy.mae < 3 },
                  { label: 'RMSE', value: backtestAccuracy.rmse.toFixed(2) + '%', good: backtestAccuracy.rmse < 5 },
                  { label: 'Direction Acc.', value: backtestAccuracy.directionAccuracy.toFixed(0) + '%', good: backtestAccuracy.directionAccuracy >= 55 },
                  { label: 'Band Coverage', value: backtestAccuracy.coverageRate.toFixed(0) + '%', good: backtestAccuracy.coverageRate >= 70 },
                ].map(({ label, value, good }) => (
                  <div key={label} className="px-3 py-2 text-xs">
                    <span className="text-muted-foreground block">{label}</span>
                    <span className={cn('font-mono font-semibold', good ? 'text-bullish' : 'text-bearish')}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 border-t border-primary/10 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Max Drawdown: </span>
                  <span className="text-muted-foreground">Pred </span>
                  <span className={cn('font-mono font-semibold', backtestAccuracy.predMaxDD < 10 ? 'text-bullish' : 'text-bearish')}>-{backtestAccuracy.predMaxDD.toFixed(1)}%</span>
                  <span className="text-muted-foreground"> vs Actual </span>
                  <span className={cn('font-mono font-semibold', backtestAccuracy.actualMaxDD < 10 ? 'text-bullish' : 'text-bearish')}>-{backtestAccuracy.actualMaxDD.toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">End Price Error: </span>
                  <span className={cn('font-mono font-semibold', Math.abs(backtestAccuracy.endError) < 5 ? 'text-bullish' : 'text-bearish')}>
                    {backtestAccuracy.endError >= 0 ? '+' : ''}{backtestAccuracy.endError.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              <span>
                {isBacktest
                  ? 'Band coverage shows what % of actual prices fell within the P10–P90 confidence band. High coverage = well-calibrated model.'
                  : 'Monte Carlo uses geometric Brownian motion with historical drift & volatility. Not financial advice.'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
