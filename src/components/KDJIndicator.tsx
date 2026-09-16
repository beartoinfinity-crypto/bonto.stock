import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { StockData, calculateKDJ } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Zap, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';

interface KDJIndicatorProps {
  data: StockData[];
}

interface KDJSignal {
  type: 'buy' | 'sell' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  name: string;
  reason: string;
}

interface KDJAnalysis {
  signals: KDJSignal[];
  explanation: string;
  zone: string;
  zoneDescription: string;
  momentum: string;
  momentumDescription: string;
}

function detectKDJSignals(k: (number | null)[], d: (number | null)[], j: (number | null)[]): KDJSignal[] {
  const signals: KDJSignal[] = [];
  const len = k.length;

  if (len < 3) return signals;

  const latestK = k[len - 1];
  const latestD = d[len - 1];
  const latestJ = j[len - 1];
  const prevK = k[len - 2];
  const prevD = d[len - 2];
  const prevJ = j[len - 3];

  if (latestK === null || latestD === null || latestJ === null) return signals;
  if (prevK === null || prevD === null) return signals;

  // Golden Cross: K crosses above D
  if (prevK <= prevD && latestK > latestD) {
    const inOversold = latestK < 30;
    signals.push({
      type: 'buy',
      strength: inOversold ? 'strong' : 'moderate',
      name: inOversold ? 'Golden Cross (Oversold)' : 'Golden Cross',
      reason: inOversold
        ? `K (${latestK.toFixed(1)}) crossed above D (${latestD.toFixed(1)}) in oversold territory — high-probability reversal signal`
        : `K (${latestK.toFixed(1)}) crossed above D (${latestD.toFixed(1)}) — bullish momentum building`,
    });
  }

  // Death Cross: K crosses below D
  if (prevK >= prevD && latestK < latestD) {
    const inOverbought = latestK > 70;
    signals.push({
      type: 'sell',
      strength: inOverbought ? 'strong' : 'moderate',
      name: inOverbought ? 'Death Cross (Overbought)' : 'Death Cross',
      reason: inOverbought
        ? `K (${latestK.toFixed(1)}) crossed below D (${latestD.toFixed(1)}) in overbought territory — high-probability reversal signal`
        : `K (${latestK.toFixed(1)}) crossed below D (${latestD.toFixed(1)}) — bearish momentum building`,
    });
  }

  // J-line extreme zones
  if (latestJ > 100) {
    signals.push({
      type: 'sell',
      strength: latestJ > 110 ? 'strong' : 'moderate',
      name: 'J-Line Overbought',
      reason: `J at ${latestJ.toFixed(1)} (>100) — price is significantly extended above the K/D range, often precedes a pullback`,
    });
  } else if (latestJ < 0) {
    signals.push({
      type: 'buy',
      strength: latestJ < -10 ? 'strong' : 'moderate',
      name: 'J-Line Oversold',
      reason: `J at ${latestJ.toFixed(1)} (<0) — price is significantly below the K/D range, often precedes a bounce`,
    });
  }

  // K/D spread — momentum strength
  const spread = Math.abs(latestK - latestD);
  if (spread > 15) {
    signals.push({
      type: latestK > latestD ? 'buy' : 'sell',
      strength: 'moderate',
      name: 'Strong K/D Divergence',
      reason: `K-D spread at ${spread.toFixed(1)} — ${latestK > latestD ? 'bullish' : 'bearish'} momentum is unusually strong`,
    });
  }

  // K in extreme zones (standalone, not crossover)
  if (latestK > 80 && latestD > 80) {
    signals.push({
      type: 'sell',
      strength: 'weak',
      name: 'Both K & D Overbought',
      reason: `K=${latestK.toFixed(1)}, D=${latestD.toFixed(1)} both above 80 — the rally may be overextended`,
    });
  } else if (latestK < 20 && latestD < 20) {
    signals.push({
      type: 'buy',
      strength: 'weak',
      name: 'Both K & D Oversold',
      reason: `K=${latestK.toFixed(1)}, D=${latestD.toFixed(1)} both below 20 — selling pressure may be exhausted`,
    });
  }

  return signals;
}

function analyzeKDJ(data: StockData[], k: (number | null)[], d: (number | null)[], j: (number | null)[]): KDJAnalysis | null {
  if (data.length < 20) return null;

  const len = k.length;
  const latestK = k[len - 1];
  const latestD = d[len - 1];
  const latestJ = j[len - 1];

  if (latestK === null || latestD === null || latestJ === null) return null;

  const signals = detectKDJSignals(k, d, j);

  // Zone analysis
  let zone = '';
  let zoneDescription = '';
  if (latestJ > 100) {
    zone = 'Overbought';
    zoneDescription = 'J-line is above 100, indicating the price has moved too far, too fast. Historically, J > 100 often precedes a correction or consolidation. Consider taking profits or tightening stops.';
  } else if (latestJ > 80) {
    zone = 'Upper Zone';
    zoneDescription = 'K, D, and J are all in the upper range (80-100). The stock is showing strong upward momentum but may be approaching exhaustion. Watch for K/D crossover as an exit signal.';
  } else if (latestJ < 0) {
    zone = 'Oversold';
    zoneDescription = 'J-line is below 0, indicating the price has fallen too far, too fast. Historically, J < 0 often precedes a bounce or relief rally. This can be a high-probability entry zone.';
  } else if (latestJ < 20) {
    zone = 'Lower Zone';
    zoneDescription = 'K, D, and J are all in the lower range (0-20). The stock is under selling pressure but may be approaching a turning point. Watch for K/D golden cross as an entry signal.';
  } else {
    zone = 'Neutral';
    zoneDescription = 'K, D, and J are in the middle range (20-80). No extreme conditions — the stock is in a normal trading range. Rely on K/D crossovers and trend context for directional bias.';
  }

  // Momentum analysis
  let momentum = '';
  let momentumDescription = '';
  if (latestK > latestD && latestJ > latestK) {
    momentum = 'Bullish Acceleration';
    momentumDescription = 'K is above D and J is above K — all three lines are fanning upward. This is the strongest bullish configuration in the KDJ system. Momentum is accelerating to the upside.';
  } else if (latestK > latestD) {
    momentum = 'Bullish';
    momentumDescription = 'K is above D, indicating bullish momentum. However, J is not leading — the uptrend may be maturing. Watch for J crossing below K as an early warning of deceleration.';
  } else if (latestK < latestD && latestJ < latestK) {
    momentum = 'Bearish Acceleration';
    momentumDescription = 'K is below D and J is below K — all three lines are fanning downward. This is the strongest bearish configuration. Momentum is accelerating to the downside.';
  } else if (latestK < latestD) {
    momentum = 'Bearish';
    momentumDescription = 'K is below D, indicating bearish momentum. However, J is not leading lower — the downtrend may be maturing. Watch for J crossing above K as an early warning of deceleration.';
  } else {
    momentum = 'Neutral';
    momentumDescription = 'K and D are intertwined with no clear spread. The market lacks directional momentum — wait for a clear crossover to establish bias.';
  }

  // Generate explanation
  const hasBuy = signals.some(s => s.type === 'buy');
  const hasSell = signals.some(s => s.type === 'sell');
  const strongBuy = signals.filter(s => s.type === 'buy' && s.strength === 'strong').length;
  const strongSell = signals.filter(s => s.type === 'sell' && s.strength === 'strong').length;

  let explanation = '';
  if (strongBuy > 0 || strongSell > 0) {
    const dir = strongBuy > 0 ? 'buying' : 'selling';
    explanation = `Strong ${dir} signals detected. ${signals[0]?.reason || ''}. `;
  } else if (hasBuy && !hasSell) {
    explanation = 'Buy signals are present. ';
  } else if (hasSell && !hasBuy) {
    explanation = 'Sell signals are present. ';
  } else if (hasBuy && hasSell) {
    explanation = 'Conflicting signals — the market is at a decision point. ';
  } else {
    explanation = 'No strong KDJ signals at this time. ';
  }

  explanation += `${zoneDescription.split('.')[0]}. ${momentumDescription.split('.')[0]}.`;

  return { signals, explanation, zone, zoneDescription, momentum, momentumDescription };
}

export function KDJIndicator({ data }: KDJIndicatorProps) {
  const chartData = useMemo(() => {
    const slicedData = data.slice(-126);
    const { k, d, j } = calculateKDJ(data);
    const kSliced = k.slice(-126);
    const dSliced = d.slice(-126);
    const jSliced = j.slice(-126);

    return slicedData.map((d, i) => ({
      date: d.date,
      k: kSliced[i],
      d: dSliced[i],
      j: jSliced[i],
    }));
  }, [data]);

  const fullKDJ = useMemo(() => calculateKDJ(data), [data]);

  const analysis = useMemo(() => analyzeKDJ(data, fullKDJ.k, fullKDJ.d, fullKDJ.j), [data, fullKDJ]);

  const latest = chartData[chartData.length - 1];
  const latestK = latest?.k;
  const latestD = latest?.d;
  const latestJ = latest?.j;

  const getKDJStatus = (k: number | null, d: number | null, j: number | null) => {
    if (k === null || d === null || j === null) return { label: 'N/A', color: 'text-muted-foreground', icon: Minus };
    if (j > 100) return { label: 'Overbought', color: 'text-bearish', icon: AlertTriangle };
    if (j < 0) return { label: 'Oversold', color: 'text-bullish', icon: TrendingUp };
    if (k > d) return { label: 'Bullish', color: 'text-bullish', icon: TrendingUp };
    return { label: 'Bearish', color: 'text-bearish', icon: TrendingDown };
  };

  const status = getKDJStatus(latestK, latestD, latestJ);

  const getSignalIcon = (type: string) => {
    if (type === 'buy') return <ArrowUpCircle className="h-4 w-4 text-bullish" />;
    if (type === 'sell') return <ArrowDownCircle className="h-4 w-4 text-bearish" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getSignalBadge = (type: string, strength: string) => {
    if (strength === 'strong') {
      return <Badge variant={type === 'buy' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">{strength}</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{strength}</Badge>;
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 card-glow space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold">KDJ Indicator</h4>
          <p className="text-xs text-muted-foreground">Stochastic Oscillator with J-line</p>
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-lg">
            K:{latestK?.toFixed(1) || 'N/A'} D:{latestD?.toFixed(1) || 'N/A'} J:{latestJ?.toFixed(1) || 'N/A'}
          </div>
          <div className={cn("text-xs font-medium flex items-center gap-1 justify-end", status.color)}>
            <status.icon className="h-3 w-3" />
            {status.label}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis domain={[-20, 120]} axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} ticks={[0, 20, 50, 80, 100]} width={30} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }}
              formatter={(value: number, name: string) => [value?.toFixed(2), name.toUpperCase()]}
            />
            <ReferenceLine y={80} stroke="hsl(0, 72%, 51%)" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine y={20} stroke="hsl(160, 84%, 39%)" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine y={50} stroke="hsl(222, 30%, 30%)" strokeDasharray="2 2" opacity={0.3} />
            <Line type="monotone" dataKey="k" stroke="hsl(173, 80%, 50%)" strokeWidth={2} dot={false} connectNulls name="K" />
            <Line type="monotone" dataKey="d" stroke="hsl(280, 70%, 60%)" strokeWidth={2} dot={false} connectNulls name="D" />
            <Line type="monotone" dataKey="j" stroke="hsl(45, 93%, 50%)" strokeWidth={1.5} dot={false} connectNulls opacity={0.7} name="J" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-2 h-0.5 bg-bullish rounded" />
          <span>Oversold &lt;20</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-primary rounded" />
            <span>K</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-chart-maFast rounded" />
            <span>D</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-yellow-400 rounded" />
            <span>J</span>
          </div>
        </div>
        <span className="text-bearish">Overbought &gt;80</span>
      </div>

      {/* Signals Section */}
      {analysis && analysis.signals.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Signal Detection</h5>
          <div className="space-y-1.5">
            {analysis.signals.map((sig, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {getSignalIcon(sig.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{sig.name}</span>
                    {getSignalBadge(sig.type, sig.strength)}
                  </div>
                  <p className="text-muted-foreground mt-0.5 leading-relaxed">{sig.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zone & Momentum Analysis */}
      {analysis && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-muted/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Zone</div>
              <div className={cn("text-xs font-medium", analysis.zone === 'Overbought' || analysis.zone === 'Upper Zone' ? 'text-bearish' : analysis.zone === 'Oversold' || analysis.zone === 'Lower Zone' ? 'text-bullish' : 'text-neutral')}>
                {analysis.zone}
              </div>
            </div>
            <div className="flex-1 rounded-lg bg-muted/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Momentum</div>
              <div className={cn("text-xs font-medium", analysis.momentum.includes('Bullish') ? 'text-bullish' : analysis.momentum.includes('Bearish') ? 'text-bearish' : 'text-neutral')}>
                {analysis.momentum}
              </div>
            </div>
          </div>

          {/* Human Explanation */}
          <div className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <h5 className="text-xs font-semibold">Analysis</h5>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{analysis.explanation}</p>
          </div>

          {/* Detailed Readings */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-[10px] text-muted-foreground">K (Fast)</div>
              <div className="font-mono text-sm font-medium">{latestK?.toFixed(1) ?? '—'}</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-[10px] text-muted-foreground">D (Slow)</div>
              <div className="font-mono text-sm font-medium">{latestD?.toFixed(1) ?? '—'}</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-[10px] text-muted-foreground">J (Confirm)</div>
              <div className={cn("font-mono text-sm font-medium", (latestJ ?? 0) > 80 ? 'text-bearish' : (latestJ ?? 0) < 20 ? 'text-bullish' : '')}>
                {latestJ?.toFixed(1) ?? '—'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
