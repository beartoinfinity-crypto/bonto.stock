import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Eye, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import type { StockData } from '@/lib/stockData';
import { cn } from '@/lib/utils';

interface MarketStructureProps {
  data: StockData[];
  symbol: string;
}

type SwingKind = 'high' | 'low';
type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL';
type Structure = 'uptrend' | 'downtrend' | 'range';

interface SwingPoint {
  index: number;
  kind: SwingKind;
  price: number;
  label: SwingLabel | null;
}

interface StructurePoint extends StockData {
  swingValue: number | null;
  swingLabel?: SwingLabel;
  swingKind?: SwingKind;
}

const PIVOT_BARS = 3;
const DISPLAY_BARS = 75;

function findConfirmedSwings(data: StockData[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  let previousHigh: number | null = null;
  let previousLow: number | null = null;

  for (let index = PIVOT_BARS; index < data.length - PIVOT_BARS; index++) {
    const bar = data[index];
    const before = data.slice(index - PIVOT_BARS, index);
    const after = data.slice(index + 1, index + PIVOT_BARS + 1);
    const isHigh = [...before, ...after].every(candidate => bar.high > candidate.high);
    const isLow = [...before, ...after].every(candidate => bar.low < candidate.low);

    if (isHigh) {
      swings.push({
        index,
        kind: 'high',
        price: bar.high,
        label: previousHigh === null ? null : bar.high > previousHigh ? 'HH' : 'LH',
      });
      previousHigh = bar.high;
    }
    if (isLow) {
      swings.push({
        index,
        kind: 'low',
        price: bar.low,
        label: previousLow === null ? null : bar.low > previousLow ? 'HL' : 'LL',
      });
      previousLow = bar.low;
    }
  }

  return swings;
}

function getStructure(swings: SwingPoint[]): Structure {
  const highs = swings.filter(swing => swing.kind === 'high').slice(-2);
  const lows = swings.filter(swing => swing.kind === 'low').slice(-2);
  if (highs.length < 2 || lows.length < 2) return 'range';
  if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) return 'uptrend';
  if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) return 'downtrend';
  return 'range';
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SwingDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: StructurePoint }) {
  if (!payload?.swingLabel || cx == null || cy == null) return null;
  const isHigh = payload.swingKind === 'high';
  const color = isHigh ? '#fb7185' : '#5eead4';
  const labelY = isHigh ? cy - 13 : cy + 20;

  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="#0b1220" strokeWidth={2} />
      <text x={cx} y={labelY} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>
        {payload.swingLabel}
      </text>
    </g>
  );
}

export function MarketStructure({ data, symbol }: MarketStructureProps) {
  const analysis = useMemo(() => {
    const visible = data.slice(-DISPLAY_BARS);
    const swings = findConfirmedSwings(visible);
    const structure = getStructure(swings);
    const latestHigh = [...swings].reverse().find(swing => swing.kind === 'high') ?? null;
    const latestLow = [...swings].reverse().find(swing => swing.kind === 'low') ?? null;
    const byIndex = new Map(swings.map(swing => [swing.index, swing]));
    const chartData: StructurePoint[] = visible.map((bar, index) => {
      const swing = byIndex.get(index);
      return {
        ...bar,
        swingValue: swing?.price ?? null,
        swingLabel: swing?.label ?? undefined,
        swingKind: swing?.kind ?? undefined,
      };
    });
    return { chartData, structure, latestHigh, latestLow, swingCount: swings.length };
  }, [data]);

  if (analysis.chartData.length < PIVOT_BARS * 2 + 2) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Not enough daily price history to map market structure.</div>;
  }

  const { chartData, structure, latestHigh, latestLow, swingCount } = analysis;
  const prices = chartData.flatMap(bar => [bar.low, bar.high]);
  const minPrice = Math.min(...prices) * 0.985;
  const maxPrice = Math.max(...prices) * 1.015;
  const currentPrice = chartData[chartData.length - 1].close;
  const structureCopy = {
    uptrend: {
      title: 'Uptrend: higher highs + higher lows',
      summary: 'Higher highs and higher lows are confirmed by recent swing points.',
      badge: 'Constructive',
      badgeClass: 'border-emerald-500/45 bg-emerald-500/10 text-emerald-400',
      icon: TrendingUp,
      accent: 'text-emerald-400',
    },
    downtrend: {
      title: 'Downtrend: lower highs + lower lows',
      summary: 'Lower highs and lower lows are confirmed by recent swing points.',
      badge: 'Defensive',
      badgeClass: 'border-rose-500/45 bg-rose-500/10 text-rose-400',
      icon: TrendingDown,
      accent: 'text-rose-400',
    },
    range: {
      title: 'Mixed structure: no confirmed directional sequence',
      summary: 'Recent swing highs and lows are not yet forming a consistent trend.',
      badge: 'Neutral',
      badgeClass: 'border-amber-500/45 bg-amber-500/10 text-amber-400',
      icon: Activity,
      accent: 'text-amber-400',
    },
  }[structure];
  const StructureIcon = structureCopy.icon;

  const confirmation = structure === 'uptrend'
    ? `A daily close above the latest swing high at $${latestHigh?.price.toFixed(2) ?? '—'} would confirm continued demand.`
    : structure === 'downtrend'
      ? `A daily close below the latest swing low at $${latestLow?.price.toFixed(2) ?? '—'} would confirm continued selling pressure.`
      : `A decisive daily close beyond the latest swing range would establish a clearer direction.`;
  const invalidation = structure === 'uptrend'
    ? `A daily close below the latest higher low at $${latestLow?.price.toFixed(2) ?? '—'} would damage the uptrend structure.`
    : structure === 'downtrend'
      ? `A daily close above the latest lower high at $${latestHigh?.price.toFixed(2) ?? '—'} would damage the downtrend structure.`
      : `A close through either recent swing extreme would invalidate the current range assumption.`;

  return (
    <section className="rounded-xl border border-border bg-card p-6 card-glow" aria-label="Market structure analysis">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-5 w-5 text-primary" />
            Market Structure
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{symbol} · confirmed daily swing points — a visual guide, not a prediction.</p>
        </div>
        <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold', structureCopy.badgeClass)}>{structureCopy.badge}</span>
      </div>

      <div className="mb-5 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
        <p className="flex items-center gap-2 font-semibold"><StructureIcon className={cn('h-4 w-4', structureCopy.accent)} />Current structure: {structureCopy.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{structureCopy.summary}</p>
      </div>

      <div className="h-[310px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 28, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="structureAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
            <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={52} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }} tickFormatter={formatDate} />
            <YAxis domain={[minPrice, maxPrice]} orientation="right" axisLine={false} tickLine={false} width={58} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }} tickFormatter={(value: number) => `$${value.toFixed(0)}`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: 8 }}
              labelFormatter={formatDate}
              formatter={(value: number, name: string) => [name === 'close' ? `$${value.toFixed(2)}` : value, name === 'close' ? 'Close' : name]}
            />
            {latestHigh && <ReferenceLine y={latestHigh.price} stroke="#fb7185" strokeDasharray="5 4" label={{ value: `Resistance $${latestHigh.price.toFixed(2)}`, fill: '#fb7185', fontSize: 11, position: 'insideRight' }} />}
            {latestLow && <ReferenceLine y={latestLow.price} stroke="#5eead4" strokeDasharray="5 4" label={{ value: `Support $${latestLow.price.toFixed(2)}`, fill: '#5eead4', fontSize: 11, position: 'insideRight' }} />}
            <Area type="monotone" dataKey="close" stroke="none" fill="url(#structureAreaGradient)" />
            <Line type="monotone" dataKey="close" stroke="#4eead7" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
            <Line type="linear" dataKey="swingValue" stroke="#fbbf24" strokeWidth={1.8} strokeDasharray="4 4" connectNulls dot={<SwingDot />} activeDot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">HH = higher high · HL = higher low · LH = lower high · LL = lower low. Labels appear only after {PIVOT_BARS} later daily bars confirm the swing ({swingCount} confirmed swings shown).</p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-secondary/45 p-4">
          <p className="flex items-center gap-2 text-sm font-medium"><Eye className="h-4 w-4 text-primary" />What it means</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{structure === 'uptrend' ? 'Each confirmed pullback has held above the previous swing low. This is the structure behind a “buy a pullback near support” idea — it is not a guarantee.' : structure === 'downtrend' ? 'Each confirmed rebound has failed below the previous swing high. This is the structure behind a defensive or trend-following approach — it is not a guarantee.' : 'Price is alternating without a confirmed sequence of higher highs/higher lows or lower highs/lower lows. Waiting for a break can reduce noise.'}</p>
        </div>
        <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-400"><TrendingUp className="h-4 w-4" />Confirmation</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{confirmation}</p>
        </div>
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-rose-400"><ShieldCheck className="h-4 w-4" />Invalidation</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{invalidation}</p>
        </div>
      </div>
      <p className="mt-3 text-right text-xs text-muted-foreground">Latest close: ${currentPrice.toFixed(2)}</p>
    </section>
  );
}
