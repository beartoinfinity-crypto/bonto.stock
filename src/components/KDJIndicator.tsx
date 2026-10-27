import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { StockData, calculateKDJ, calculateSMA } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, Minus, Activity, Lightbulb, CheckCircle2,
} from 'lucide-react';

interface KDJIndicatorProps {
  data: StockData[];
}

type Direction = 'bullish' | 'bearish' | 'neutral';

interface MetricRow {
  name: string;
  value: string;
  tone: Direction;
  warn: boolean;
  read: string;
}

interface SMAState {
  sma20: number | null;
  sma50: number | null;
  price: number;
  priceAboveSma20: boolean;
  priceAboveSma50: boolean;
  sma20AboveSma50: boolean;
}

interface KDJAnalysis {
  rows: MetricRow[];
  bias: Direction | 'mixed';
  score: number;
  bullishCount: number;
  watchCount: number;
  summary: string;
  zone: string;
  momentum: string;
  trendConfirmation: string;
  latestK: number | null;
  latestD: number | null;
  latestJ: number | null;
}

function getSMAState(data: StockData[], sma20: (number | null)[], sma50: (number | null)[]): SMAState | null {
  const len = data.length;
  if (len < 50) return null;
  const latest = data[len - 1];
  const latestSma20 = sma20[len - 1];
  const latestSma50 = sma50[len - 1];
  if (latestSma20 === null || latestSma50 === null) return null;
  return {
    sma20: latestSma20,
    sma50: latestSma50,
    price: latest.close,
    priceAboveSma20: latest.close > latestSma20,
    priceAboveSma50: latest.close > latestSma50,
    sma20AboveSma50: latestSma20 > latestSma50,
  };
}

function analyzeKDJ(data: StockData[], k: (number | null)[], d: (number | null)[], j: (number | null)[], sma20: (number | null)[], sma50: (number | null)[]): KDJAnalysis | null {
  if (data.length < 50) return null;

  const len = k.length;
  const latestK = k[len - 1];
  const latestD = d[len - 1];
  const latestJ = j[len - 1];

  if (latestK === null || latestD === null || latestJ === null) return null;

  const smaState = getSMAState(data, sma20, sma50);

  const rows: MetricRow[] = [];
  let bull = 0;
  let bear = 0;

  // -- KDJ zone (J extreme) -------------------------------------------
  let zone = 'Neutral';
  let zoneRead = 'K, D, J sit in the middle range — normal drift, wait for a crossover.';
  if (latestJ > 100) {
    zone = 'Overbought';
    zoneRead = 'J is above 100 — price has extended fast. Pullbacks have been more common here; not guaranteed.';
    bear += 2;
  } else if (latestJ < 0) {
    zone = 'Oversold';
    zoneRead = 'J is below 0 — price has fallen fast. Bounces have been more common here; not guaranteed.';
    bull += 2;
  } else if (latestJ > 80) {
    zone = 'Upper zone';
    zoneRead = 'J in the upper range — momentum is strong but getting extended.';
  } else if (latestJ < 20) {
    zone = 'Lower zone';
    zoneRead = 'J in the lower range — selling pressure but a turning point may be nearer.';
  }
  rows.push({
    name: 'J Extreme Zone',
    value: zone,
    tone: latestJ > 80 ? 'bearish' : latestJ < 20 ? 'bullish' : 'neutral',
    warn: latestJ > 100 || latestJ < 0,
    read: zoneRead,
  });

  // -- KDJ crossover --------------------------------------------------
  const spread = Math.abs(latestK - latestD);
  let crossTone: Direction = 'neutral';
  let crossRead = 'K and D are intertwined — no directional momentum.';
  if (latestK > latestD) {
    crossTone = 'bullish';
    bull += spread > 15 ? 2 : 1;
    crossRead = `K (${latestK.toFixed(1)}) is above D (${latestD.toFixed(1)}) — momentum has turned up${spread > 15 ? ' and is unusually strong' : ''}.`;
  } else {
    crossTone = 'bearish';
    bear += spread > 15 ? 2 : 1;
    crossRead = `K (${latestK.toFixed(1)}) is below D (${latestD.toFixed(1)}) — momentum has turned down${spread > 15 ? ' and is unusually strong' : ''}.`;
  }
  rows.push({
    name: 'KDJ Crossover',
    value: `K ${latestK.toFixed(1)} · D ${latestD.toFixed(1)}`,
    tone: crossTone,
    warn: spread > 15,
    read: crossRead,
  });

  // -- K/D spread -----------------------------------------------------
  rows.push({
    name: 'K–D Spread',
    value: spread.toFixed(1),
    tone: spread > 15 ? (crossTone === 'bullish' ? 'bullish' : 'bearish') : 'neutral',
    warn: spread > 15,
    read: spread > 15
      ? `Spread of ${spread.toFixed(1)} — momentum is running one way faster than usual. Can mean an extended move rather than a fresh one.`
      : 'Spread within a normal range — no extreme momentum reading.',
  });

  // -- Price vs SMA20 -------------------------------------------------
  if (smaState) {
    rows.push({
      name: 'Price vs SMA20',
      value: smaState.priceAboveSma20 ? `Above $${smaState.sma20?.toFixed(2)}` : `Below $${smaState.sma20?.toFixed(2)}`,
      tone: smaState.priceAboveSma20 ? 'bullish' : 'bearish',
      warn: false,
      read: smaState.priceAboveSma20
        ? 'Price holds above the 20-day average — short-term trend supportive for longs.'
        : 'Price sits below the 20-day average — short-term trend is not supportive for longs.',
      });
    if (smaState.priceAboveSma20) bull += 1; else bear += 1;

    // -- Price vs SMA50 ------------------------------------------------
    rows.push({
      name: 'Price vs SMA50',
      value: smaState.priceAboveSma50 ? `Above $${smaState.sma50?.toFixed(2)}` : `Below $${smaState.sma50?.toFixed(2)}`,
      tone: smaState.priceAboveSma50 ? 'bullish' : 'bearish',
      warn: false,
      read: smaState.priceAboveSma50
        ? 'Price holds above the 50-day average — medium-term trend supportive.'
        : 'Price sits below the 50-day average — medium-term trend is not supportive.',
      });
    if (smaState.priceAboveSma50) bull += 2; else bear += 2;

    // -- SMA20 vs SMA50 ------------------------------------------------
    const crossName = smaState.sma20AboveSma50 ? 'Golden (SMA20 > SMA50)' : 'Death (SMA20 < SMA50)';
    const crossTone2: Direction = smaState.sma20AboveSma50 ? 'bullish' : 'bearish';
    rows.push({
      name: 'SMA20 vs SMA50',
      value: crossName,
      tone: crossTone2,
      warn: false,
      read: smaState.sma20AboveSma50
        ? 'The 20-day average is above the 50-day — the classic bullish alignment.'
        : 'The 20-day average is below the 50-day — the classic bearish alignment.',
      });
    if (smaState.sma20AboveSma50) bull += 2; else bear += 2;
  }

  // -- Trend confirmation ---------------------------------------------
  let trendConfirmation = 'Trend context: not enough SMA data to confirm a trend.';
  if (smaState) {
    const { priceAboveSma20: p20, priceAboveSma50: p50, sma20AboveSma50: g } = smaState;
    if (p20 && p50 && g) {
      trendConfirmation = 'Strong uptrend: price above both averages, 20-day above 50-day.';
      bull += 2;
    } else if (!p20 && !p50 && !g) {
      trendConfirmation = 'Strong downtrend: price below both averages, 20-day below 50-day.';
      bear += 2;
    } else if (p20 && !p50) {
      trendConfirmation = 'Mixed: price above SMA20 but below SMA50 — short up, medium down.';
    } else if (!p20 && p50) {
      trendConfirmation = 'Mixed: price below SMA20 but above SMA50 — pullback inside an uptrend.';
    } else {
      trendConfirmation = 'Trend context: price and averages are in transition.';
    }
  }
  rows.push({
    name: 'Trend Context',
    value: smaState && smaState.priceAboveSma20 && smaState.priceAboveSma50 ? 'Aligned' : smaState && !smaState.priceAboveSma20 && !smaState.priceAboveSma50 ? 'Weak' : 'Mixed',
    tone: (trendConfirmation.startsWith('Strong') ? (trendConfirmation.includes('uptrend') ? 'bullish' : 'bearish') : smaState ? 'neutral' : 'neutral'),
    warn: trendConfirmation.startsWith('Mixed'),
    read: trendConfirmation,
  });

  // -- Momentum summary -----------------------------------------------
  let momentum: string;
  if (latestK > latestD && latestJ > latestK) momentum = 'Bullish acceleration (J leading)';
  else if (latestK > latestD) momentum = 'Bullish';
  else if (latestK < latestD && latestJ < latestK) momentum = 'Bearish acceleration (J leading)';
  else if (latestK < latestD) momentum = 'Bearish';
  else momentum = 'Neutral';

  // -- Verdict ---------------------------------------------------------
  // Short-term KDJ momentum and medium-term SMA trend are scored separately
  // so a disagreement shows as "Mixed" instead of one side swallowing the
  // other. Only aligned reads get a directional score.
  const kdjNet = (() => {
    let b = 0;
    if (latestJ > 100) b -= 2; else if (latestJ < 0) b += 2;
    if (latestK > latestD) b += spread > 15 ? 2 : 1; else b -= spread > 15 ? 2 : 1;
    return b;
  })();
  const smaNet = (() => {
    let b = 0;
    if (smaState) {
      if (smaState.priceAboveSma20) b += 1; else b -= 1;
      if (smaState.priceAboveSma50) b += 2; else b -= 2;
      if (smaState.sma20AboveSma50) b += 2; else b -= 2;
    }
    if (trendConfirmation.startsWith('Strong uptrend')) b += 2;
    else if (trendConfirmation.startsWith('Strong downtrend')) b -= 2;
    return b;
  })();
  const kdjSide: Direction | 'neutral' = kdjNet > 0 ? 'bullish' : kdjNet < 0 ? 'bearish' : 'neutral';
  const smaSide: Direction | 'neutral' = smaNet > 0 ? 'bullish' : smaNet < 0 ? 'bearish' : 'neutral';

  let bias: Direction | 'mixed';
  if (kdjSide === 'neutral' && smaSide === 'neutral') bias = 'neutral';
  else if (kdjSide === smaSide) bias = kdjSide;
  else if (kdjSide === 'neutral') bias = smaSide;
  else if (smaSide === 'neutral') bias = kdjSide;
  else bias = 'mixed';

  const total = bull + bear;
  const score = bias === 'mixed' || total === 0 ? 50 : Math.round((bull / total) * 100);

  const bullishCount = rows.filter(r => r.tone === 'bullish').length;
  const watchCount = rows.filter(r => r.warn).length;

  let summary: string;
  if (bias === 'mixed') {
    summary = 'Short-term KDJ momentum is pulling one way while the 20/50-day trend pulls the other — the read is mixed. A clear move in either momentum or the averages would resolve it.';
  } else if (bias === 'bullish') {
    summary = 'KDJ momentum and the 20/50-day averages are both firm — the technical read is bullish. A move back below the 20-day average would soften it.';
  } else if (bias === 'bearish') {
    summary = 'KDJ momentum and the 20/50-day averages are both soft — the technical read is bearish. A reclaim of the 20-day average would soften it.';
  } else {
    summary = 'No strong KDJ or average signal right now — momentum is mid-range and unconfirmed.';
  }

  return { rows, bias, score, bullishCount, watchCount, summary, zone, momentum, trendConfirmation, latestK, latestD, latestJ };
}

export function KDJIndicator({ data }: KDJIndicatorProps) {
  const fullKDJ = useMemo(() => calculateKDJ(data), [data]);
  const sma20 = useMemo(() => calculateSMA(data, 20), [data]);
  const sma50 = useMemo(() => calculateSMA(data, 50), [data]);

  const chartData = useMemo(() => {
    const slicedData = data.slice(-126);
    const kSliced = fullKDJ.k.slice(-126);
    const dSliced = fullKDJ.d.slice(-126);
    const jSliced = fullKDJ.j.slice(-126);
    const sma20Sliced = sma20.slice(-126);
    const sma50Sliced = sma50.slice(-126);

    return slicedData.map((d, i) => ({
      date: d.date,
      k: kSliced[i],
      d: dSliced[i],
      j: jSliced[i],
      sma20: sma20Sliced[i],
      sma50: sma50Sliced[i],
    }));
  }, [data, fullKDJ, sma20, sma50]);

  const analysis = useMemo(
    () => analyzeKDJ(data, fullKDJ.k, fullKDJ.d, fullKDJ.j, sma20, sma50),
    [data, fullKDJ, sma20, sma50],
  );

  const badge = {
    bullish: { label: 'Bullish', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', Icon: TrendingUp },
    bearish: { label: 'Bearish', className: 'bg-red-500/15 text-red-500 border-red-500/30', Icon: TrendingDown },
    neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border', Icon: Minus },
    mixed: { label: 'Mixed', className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30', Icon: Activity },
  };

  const rowTone = {
    bullish: { Icon: TrendingUp, className: 'text-emerald-500' },
    bearish: { Icon: TrendingDown, className: 'text-red-500' },
    neutral: { Icon: Minus, className: 'text-muted-foreground' },
  };

  if (!analysis) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 text-sm text-muted-foreground card-glow">
        KDJ / SMA analysis needs at least 50 daily data points.
      </div>
    );
  }

  const VerdictBadge = badge[analysis.bias];
  const filledSegments = Math.max(1, Math.round((analysis.score / 100) * 8));

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            KDJ + SMA Indicator
          </h3>
          <p className="text-sm text-muted-foreground">Stochastic oscillator with SMA trend confirmation</p>
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-lg">
            K:{analysis.latestK?.toFixed(1) ?? 'N/A'} D:{analysis.latestD?.toFixed(1) ?? 'N/A'} J:{analysis.latestJ?.toFixed(1) ?? 'N/A'}
          </div>
        </div>
      </div>

      {/* Hero verdict */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className={cn('flex items-center gap-2 rounded-md px-2 py-0.5 border', VerdictBadge.className)}>
              <VerdictBadge.Icon className="h-4 w-4" />
              <span className="text-lg font-bold leading-none">{VerdictBadge.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">{analysis.bullishCount} of {analysis.rows.length} indicators bullish</span>
              {analysis.watchCount > 0 && <span className="text-orange-500"> · {analysis.watchCount} to watch</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Technical score</p>
            <p className={cn('text-2xl font-bold tabular-nums leading-none', VerdictBadge.className)}>
              {analysis.score}
              <span className="text-sm font-normal text-muted-foreground">/100</span>
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex gap-1" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={cn('h-1.5 flex-1 rounded-full', i < filledSegments ? (analysis.bias === 'bullish' ? 'bg-emerald-500' : analysis.bias === 'bearish' ? 'bg-red-500' : 'bg-yellow-500') : 'bg-border')}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Bearish</span>
            <span>Bullish</span>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-background/70 px-2.5 py-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
          <p className="text-sm font-medium leading-snug">{analysis.summary}</p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 55, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis yAxisId="kdj" domain={[-20, 120]} axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} ticks={[0, 20, 50, 80, 100]} width={30} />
            <YAxis yAxisId="price" orientation="right" axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} width={50} tickFormatter={(v) => `$${v.toFixed(0)}`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }}
              formatter={(value: number, name: string) => {
                if (name === 'sma20' || name === 'sma50') return [`$${value?.toFixed(2)}`, name.toUpperCase()];
                return [value?.toFixed(2), name.toUpperCase()];
              }}
            />
            <ReferenceLine yAxisId="kdj" y={80} stroke="hsl(0, 72%, 51%)" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine yAxisId="kdj" y={20} stroke="hsl(160, 84%, 39%)" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine yAxisId="kdj" y={50} stroke="hsl(222, 30%, 30%)" strokeDasharray="2 2" opacity={0.3} />
            <Line yAxisId="kdj" type="monotone" dataKey="k" stroke="hsl(173, 80%, 50%)" strokeWidth={2} dot={false} connectNulls name="K" />
            <Line yAxisId="kdj" type="monotone" dataKey="d" stroke="hsl(280, 70%, 60%)" strokeWidth={2} dot={false} connectNulls name="D" />
            <Line yAxisId="kdj" type="monotone" dataKey="j" stroke="hsl(45, 93%, 50%)" strokeWidth={1.5} dot={false} connectNulls opacity={0.7} name="J" />
            <Line yAxisId="price" type="monotone" dataKey="sma20" stroke="hsl(210, 80%, 50%)" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" name="SMA20" />
            <Line yAxisId="price" type="monotone" dataKey="sma50" stroke="hsl(350, 70%, 55%)" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" name="SMA50" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-primary rounded" /><span>K</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-chart-maFast rounded" /><span>D</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-yellow-400 rounded" /><span>J</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-[hsl(210,80%,50%)] rounded" style={{ borderTop: '1px dashed' }} /><span>SMA20</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-[hsl(350,70%,55%)] rounded" style={{ borderTop: '1px dashed' }} /><span>SMA50</span></div>
        <span className="text-bearish">Overbought &gt;80</span>
        <span className="text-bullish">Oversold &lt;20</span>
      </div>

      {/* Metric rows */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Indicators</span>
          <span className="text-xs text-muted-foreground">{analysis.bullishCount}/{analysis.rows.length} bullish{analysis.watchCount > 0 && ` · ${analysis.watchCount} watch`}</span>
        </div>

        {analysis.rows.map((r) => {
          const Icon = rowTone[r.tone].Icon;
          return (
            <div
              key={r.name}
              className={cn(
                'rounded-md border px-3 py-2',
                r.warn ? 'border-orange-500/30 bg-orange-500/5' : 'border-border bg-muted/20',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={cn('h-4 w-4 shrink-0', rowTone[r.tone].className)} />
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  {r.warn && (
                    <span className="shrink-0 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-500">
                      Watch
                    </span>
                  )}
                </div>
                <span className={cn('shrink-0 text-sm font-bold tabular-nums', r.warn ? 'text-orange-500' : 'text-foreground')}>
                  {r.value}
                </span>
              </div>
              <p
                className={cn(
                  'mt-1 pl-6 text-xs leading-relaxed text-muted-foreground',
                  r.warn ? 'line-clamp-2' : 'truncate',
                )}
                title={r.read}
              >
                {r.read}
              </p>
            </div>
          );
        })}
      </div>

      {/* Readout */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[10px] text-muted-foreground">Zone</div>
          <div className={cn('text-sm font-medium', analysis.zone === 'Overbought' || analysis.zone === 'Upper zone' ? 'text-bearish' : analysis.zone === 'Oversold' || analysis.zone === 'Lower zone' ? 'text-bullish' : 'text-neutral')}>
            {analysis.zone}
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[10px] text-muted-foreground">Momentum</div>
          <div className={cn('text-sm font-medium', analysis.momentum.startsWith('Bullish') ? 'text-bullish' : analysis.momentum.startsWith('Bearish') ? 'text-bearish' : 'text-neutral')}>
            {analysis.momentum}
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-[10px] text-muted-foreground">Trend</div>
          <div className={cn('text-sm font-medium', analysis.trendConfirmation.startsWith('Strong') ? (analysis.trendConfirmation.includes('uptrend') ? 'text-bullish' : 'text-bearish') : analysis.trendConfirmation.startsWith('Mixed') ? 'text-yellow-500' : 'text-neutral')}>
            {analysis.trendConfirmation.startsWith('Strong') ? (analysis.trendConfirmation.includes('uptrend') ? 'Uptrend' : 'Downtrend') : analysis.trendConfirmation.startsWith('Mixed') ? 'Mixed' : 'Transition'}
          </div>
        </div>
      </div>

      {/* Footnote */}
      <div className="flex items-start gap-2 rounded-md bg-secondary/30 px-2.5 py-2">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground italic">
          Rule-based read on stochastic momentum (K/D/J) and 20/50-day averages. Derived from price only — not financial advice.
        </p>
      </div>
    </div>
  );
}