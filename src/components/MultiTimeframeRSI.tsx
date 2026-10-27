import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Activity, Lightbulb, CheckCircle2 } from 'lucide-react';
import { StockData, calculateRSI } from '@/lib/stockData';
import { cn } from '@/lib/utils';

interface MultiTimeframeRSIProps {
  data: StockData[];
}

type Direction = 'bullish' | 'bearish' | 'neutral';

interface RSISignal {
  type: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  label: string;
  description: string;
  direction: Direction;
}

interface RSIStance {
  timeframe: '7' | '14' | '21';
  label: string;
  value: number | null;
  tone: Direction;
  read: string;
}

// Per-timeframe stance reads. Oversold/overbought are treated as warning
// zones (R% is a mean-reversion oscillator), not as raw buy/sell votes.
function stanceFor(rsi: number | null, timeframe: string): RSIStance['tone'] {
  if (rsi === null) return 'neutral';
  if (rsi < 30) return 'bullish';
  if (rsi > 70) return 'bearish';
  return 'neutral';
}

function generateMultiRSISignal(rsi7: number | null, rsi14: number | null, rsi21: number | null): RSISignal {
  if (rsi7 === null || rsi14 === null || rsi21 === null) {
    return {
      type: 'neutral',
      label: 'Insufficient Data',
      description: 'Waiting for RSI calculations',
      direction: 'neutral',
    };
  }

  // All three timeframes in the same extreme zone.
  if (rsi7 < 30 && rsi14 < 30 && rsi21 < 30) {
    return {
      type: 'strong_buy',
      label: 'Deeply Oversold',
      description: 'All three timeframes are below 30 — stretched, and a bounce is statistically more common from here (not guaranteed).',
      direction: 'bullish',
    };
  }
  if (rsi7 > 70 && rsi14 > 70 && rsi21 > 70) {
    return {
      type: 'strong_sell',
      label: 'Deeply Overbought',
      description: 'All three timeframes are above 70 — stretched, and a pullback is statistically more common from here (not guaranteed).',
      direction: 'bearish',
    };
  }

  // Short-term stretched with medium-term support.
  if (rsi7 < 30 && rsi14 < 40) {
    return {
      type: 'buy',
      label: 'Oversold, Recovering',
      description: 'Short-term RSI is oversold while the medium timeframe is still weak — a bounce attempt may be starting.',
      direction: 'bullish',
    };
  }
  if (rsi7 > 70 && rsi14 > 60) {
    return {
      type: 'sell',
      label: 'Overbought, Weakening',
      description: 'Short-term RSI is overbought with the medium timeframe still stretched — a pullback attempt may be starting.',
      direction: 'bearish',
    };
  }

  // Crossover momentum.
  if (rsi7 > rsi14 && rsi7 < 50 && rsi14 < 45) {
    return {
      type: 'buy',
      label: 'Bullish Momentum',
      description: 'Short-term RSI crossed above the medium timeframe below 50 — early strength, needs confirmation.',
      direction: 'bullish',
    };
  }
  if (rsi7 < rsi14 && rsi7 > 50 && rsi14 > 55) {
    return {
      type: 'sell',
      label: 'Bearish Momentum',
      description: 'Short-term RSI crossed below the medium timeframe above 50 — early weakness, needs confirmation.',
      direction: 'bearish',
    };
  }

  return {
    type: 'neutral',
    label: 'Neutral',
    description: 'No clear signal — wait for an extreme or a confirmed crossover.',
    direction: 'neutral',
  };
}

export function MultiTimeframeRSI({ data }: MultiTimeframeRSIProps) {
  const { chartData, latestValues, signal, stances } = useMemo(() => {
    const slicedData = data.slice(-126);
    const rsi7 = calculateRSI(data, 7).slice(-126);
    const rsi14 = calculateRSI(data, 14).slice(-126);
    const rsi21 = calculateRSI(data, 21).slice(-126);

    const chartData = slicedData.map((d, i) => ({
      date: d.date,
      rsi7: rsi7[i],
      rsi14: rsi14[i],
      rsi21: rsi21[i],
    }));

    const latest = chartData[chartData.length - 1];
    const l7 = latest?.rsi7 ?? null;
    const l14 = latest?.rsi14 ?? null;
    const l21 = latest?.rsi21 ?? null;
    const signal = generateMultiRSISignal(l7, l14, l21);

    const stances: RSIStance[] = [
      { timeframe: '7', label: 'Short-term', value: l7, tone: stanceFor(l7, '7'), read: readFor(l7, 7) },
      { timeframe: '14', label: 'Standard', value: l14, tone: stanceFor(l14, '14'), read: readFor(l14, 14) },
      { timeframe: '21', label: 'Long-term', value: l21, tone: stanceFor(l21, '21'), read: readFor(l21, 21) },
    ];

    return { chartData, latestValues: { rsi7: l7, rsi14: l14, rsi21: l21 }, signal, stances };
  }, [data]);

  const directionalCount = stances.filter(s => s.tone !== 'neutral').length;
  const stancesBullish = stances.filter(s => s.tone === 'bullish').length;

  const badge = {
    bullish: { label: 'Bullish', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', Icon: TrendingUp },
    bearish: { label: 'Bearish', className: 'bg-red-500/15 text-red-500 border-red-500/30', Icon: TrendingDown },
    neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border', Icon: Minus },
  };
  const toneBadge: Record<Direction, { label: string; className: string }> = {
    bullish: { label: 'Oversold', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
    bearish: { label: 'Overbought', className: 'bg-red-500/15 text-red-500 border-red-500/30' },
    neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' },
  };

  const VerdictIcon = badge[signal.direction].Icon;

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Multi-Timeframe RSI
          </h3>
          <p className="text-sm text-muted-foreground">RSI(7) · RSI(14) · RSI(21) confluence</p>
        </div>
        <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold', badge[signal.direction].className)}>
          <VerdictIcon className="h-4 w-4" />
          {signal.label}
        </div>
      </div>

      {/* Hero verdict */}
      {signal.type !== 'neutral' && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            {directionalCount > 0 ? (
              <span><span className="font-semibold">{stancesBullish}/{directionalCount}</span> timeframes in an extreme zone</span>
            ) : (
              <span>No timeframes in an extreme zone — a crossover read</span>
            )}
          </div>
          <div className="flex items-start gap-2 rounded-md bg-background/70 px-2.5 py-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
            <p className="text-sm font-medium leading-snug">{signal.description}</p>
          </div>
        </div>
      )}

      {/* Per-timeframe stance cards */}
      <div className="grid grid-cols-3 gap-4">
        {stances.map(s => {
          const tb = toneBadge[s.tone];
          return (
            <div key={s.timeframe} className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs mb-1">
                <span>RSI ({s.timeframe})</span>
                <span className="opacity-70">{s.label}</span>
              </div>
              <div className={cn('font-mono font-bold text-lg', s.tone === 'bullish' ? 'text-bullish' : s.tone === 'bearish' ? 'text-bearish' : 'text-foreground')}>
                {s.value?.toFixed(1) || 'N/A'}
              </div>
              <div className="mt-1">
                <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold', tb.className)}>
                  {tb.label}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{s.read}</p>
            </div>
          );
        })}
      </div>

      {/* Chart */}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }}
              tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              minTickGap={50}
            />
            <YAxis
              domain={[0, 100]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }}
              ticks={[20, 30, 50, 70, 80]}
              width={30}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = { rsi7: 'RSI (7)', rsi14: 'RSI (14)', rsi21: 'RSI (21)' };
                return [value?.toFixed(2), labels[name] || name];
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '10px' }}
              formatter={(value) => {
                const labels: Record<string, string> = { rsi7: 'RSI (7)', rsi14: 'RSI (14)', rsi21: 'RSI (21)' };
                return <span className="text-muted-foreground text-xs">{labels[value] || value}</span>;
              }}
            />
            <ReferenceLine y={70} stroke="hsl(0, 72%, 51%)" strokeDasharray="4 4" opacity={0.5} />
            <ReferenceLine y={30} stroke="hsl(160, 84%, 39%)" strokeDasharray="4 4" opacity={0.5} />
            <ReferenceLine y={50} stroke="hsl(222, 30%, 30%)" strokeDasharray="2 2" opacity={0.3} />
            <Line type="monotone" dataKey="rsi7" stroke="hsl(173, 80%, 50%)" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="rsi14" stroke="hsl(280, 70%, 60%)" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="rsi21" stroke="hsl(38, 92%, 50%)" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footnote */}
      <div className="flex items-start gap-2 rounded-md bg-secondary/30 px-2.5 py-2">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground italic">
          RSI is a mean-reversion oscillator: below 30 = oversold, above 70 = overbought. These are stretched readings, not guaranteed turning points — not financial advice.
        </p>
      </div>
    </div>
  );
}

function readFor(rsi: number | null, period: number): string {
  if (rsi === null) return 'Not enough data yet.';
  if (rsi < 30) return `${period}-day RSI is oversold — stretched, bounces are statistically more common from here.`;
  if (rsi > 70) return `${period}-day RSI is overbought — stretched, pullbacks are statistically more common from here.`;
  if (rsi < 45) return `${period}-day RSI is on the soft side — momentum is weak but not extreme.`;
  if (rsi > 55) return `${period}-day RSI is on the firm side — momentum is healthy but not extreme.`;
  return `${period}-day RSI is mid-range — no edge either way.`;
}