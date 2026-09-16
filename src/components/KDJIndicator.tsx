import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { StockData, calculateKDJ, calculateSMA } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, ArrowUpCircle, ArrowDownCircle,
  Activity, BarChart3,
} from 'lucide-react';

interface KDJIndicatorProps {
  data: StockData[];
}

interface KDJSignal {
  type: 'buy' | 'sell' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  name: string;
  reason: string;
  category: 'kdj' | 'sma' | 'combined';
}

interface SMAState {
  sma20: number | null;
  sma50: number | null;
  prevSma20: number | null;
  prevSma50: number | null;
  price: number;
  prevPrice: number;
  priceAboveSma20: boolean;
  priceAboveSma50: boolean;
  sma20AboveSma50: boolean;
}

interface KDJAnalysis {
  signals: KDJSignal[];
  explanation: string;
  zone: string;
  zoneDescription: string;
  momentum: string;
  momentumDescription: string;
  smaState: SMAState;
  trendConfirmation: string;
}

function getSMAState(data: StockData[], sma20: (number | null)[], sma50: (number | null)[]): SMAState | null {
  const len = data.length;
  if (len < 50) return null;

  const latest = data[len - 1];
  const prev = data[len - 2];
  const latestSma20 = sma20[len - 1];
  const latestSma50 = sma50[len - 1];
  const prevSma20 = sma20[len - 2];
  const prevSma50 = sma50[len - 2];

  if (latestSma20 === null || latestSma50 === null) return null;

  return {
    sma20: latestSma20,
    sma50: latestSma50,
    prevSma20,
    prevSma50,
    price: latest.close,
    prevPrice: prev.close,
    priceAboveSma20: latest.close > latestSma20,
    priceAboveSma50: latest.close > latestSma50,
    sma20AboveSma50: latestSma20 > latestSma50,
  };
}

function detectSMASignals(smaState: SMAState | null): KDJSignal[] {
  if (!smaState) return [];
  const signals: KDJSignal[] = [];
  const { sma20, sma50, prevSma20, prevSma50, price, prevPrice, priceAboveSma20, priceAboveSma50, sma20AboveSma50 } = smaState;

  if (sma20 === null || sma50 === null || prevSma20 === null || prevSma50 === null) return signals;

  // Price crossing SMA20
  if (prevPrice <= prevSma20! && price > sma20!) {
    signals.push({
      type: 'buy',
      strength: 'moderate',
      name: 'Price Crosses Above SMA20',
      reason: `Price ($${price.toFixed(2)}) crossed above SMA20 ($${sma20.toFixed(2)}) — short-term trend turning bullish`,
      category: 'sma',
    });
  } else if (prevPrice >= prevSma20! && price < sma20!) {
    signals.push({
      type: 'sell',
      strength: 'moderate',
      name: 'Price Crosses Below SMA20',
      reason: `Price ($${price.toFixed(2)}) crossed below SMA20 ($${sma20.toFixed(2)}) — short-term trend turning bearish`,
      category: 'sma',
    });
  }

  // Price crossing SMA50
  if (prevPrice <= prevSma50! && price > sma50!) {
    signals.push({
      type: 'buy',
      strength: 'strong',
      name: 'Price Crosses Above SMA50',
      reason: `Price ($${price.toFixed(2)}) crossed above SMA50 ($${sma50.toFixed(2)}) — medium-term trend turning bullish`,
      category: 'sma',
    });
  } else if (prevPrice >= prevSma50! && price < sma50!) {
    signals.push({
      type: 'sell',
      strength: 'strong',
      name: 'Price Crosses Below SMA50',
      reason: `Price ($${price.toFixed(2)}) crossed below SMA50 ($${sma50.toFixed(2)}) — medium-term trend turning bearish`,
      category: 'sma',
    });
  }

  // SMA20 / SMA50 Golden Cross / Death Cross
  if (prevSma20! <= prevSma50! && sma20! > sma50!) {
    signals.push({
      type: 'buy',
      strength: 'strong',
      name: 'Golden Cross (SMA20 > SMA50)',
      reason: `SMA20 ($${sma20.toFixed(2)}) crossed above SMA50 ($${sma50.toFixed(2)}) — classic bullish trend confirmation`,
      category: 'sma',
    });
  } else if (prevSma20! >= prevSma50! && sma20! < sma50!) {
    signals.push({
      type: 'sell',
      strength: 'strong',
      name: 'Death Cross (SMA20 < SMA50)',
      reason: `SMA20 ($${sma20.toFixed(2)}) crossed below SMA50 ($${sma50.toFixed(2)}) — classic bearish trend confirmation`,
      category: 'sma',
    });
  }

  return signals;
}

function detectKDJSignals(k: (number | null)[], d: (number | null)[], j: (number | null)[], smaState: SMAState | null): KDJSignal[] {
  const signals: KDJSignal[] = [];
  const len = k.length;

  if (len < 3) return signals;

  const latestK = k[len - 1];
  const latestD = d[len - 1];
  const latestJ = j[len - 1];
  const prevK = k[len - 2];
  const prevD = d[len - 2];

  if (latestK === null || latestD === null || latestJ === null) return signals;
  if (prevK === null || prevD === null) return signals;

  // Golden Cross: K crosses above D
  if (prevK <= prevD && latestK > latestD) {
    const inOversold = latestK < 30;
    const trendAligned = smaState?.priceAboveSma20;
    const strength = inOversold ? 'strong' : trendAligned ? 'moderate' : 'weak';
    signals.push({
      type: 'buy',
      strength,
      name: inOversold ? 'KDJ Golden Cross (Oversold)' : trendAligned ? 'KDJ Golden Cross (Trend Confirmed)' : 'KDJ Golden Cross',
      reason: inOversold
        ? `K (${latestK.toFixed(1)}) crossed above D (${latestD.toFixed(1)}) in oversold territory — high-probability reversal`
        : trendAligned
        ? `K (${latestK.toFixed(1)}) crossed above D (${latestD.toFixed(1)}) with price above SMA20 — bullish momentum confirmed by trend`
        : `K (${latestK.toFixed(1)}) crossed above D (${latestD.toFixed(1)}) — bullish momentum building`,
      category: 'kdj',
    });
  }

  // Death Cross: K crosses below D
  if (prevK >= prevD && latestK < latestD) {
    const inOverbought = latestK > 70;
    const trendAligned = smaState && !smaState.priceAboveSma20;
    const strength = inOverbought ? 'strong' : trendAligned ? 'moderate' : 'weak';
    signals.push({
      type: 'sell',
      strength,
      name: inOverbought ? 'KDJ Death Cross (Overbought)' : trendAligned ? 'KDJ Death Cross (Trend Confirmed)' : 'KDJ Death Cross',
      reason: inOverbought
        ? `K (${latestK.toFixed(1)}) crossed below D (${latestD.toFixed(1)}) in overbought territory — high-probability reversal`
        : trendAligned
        ? `K (${latestK.toFixed(1)}) crossed below D (${latestD.toFixed(1)}) with price below SMA20 — bearish momentum confirmed by trend`
        : `K (${latestK.toFixed(1)}) crossed below D (${latestD.toFixed(1)}) — bearish momentum building`,
      category: 'kdj',
    });
  }

  // J-line extreme zones
  if (latestJ > 100) {
    signals.push({
      type: 'sell',
      strength: latestJ > 110 ? 'strong' : 'moderate',
      name: 'J-Line Overbought',
      reason: `J at ${latestJ.toFixed(1)} (>100) — price significantly extended, often precedes a pullback`,
      category: 'kdj',
    });
  } else if (latestJ < 0) {
    signals.push({
      type: 'buy',
      strength: latestJ < -10 ? 'strong' : 'moderate',
      name: 'J-Line Oversold',
      reason: `J at ${latestJ.toFixed(1)} (<0) — price significantly oversold, often precedes a bounce`,
      category: 'kdj',
    });
  }

  // K/D spread — momentum strength
  const spread = Math.abs(latestK - latestD);
  if (spread > 15) {
    signals.push({
      type: latestK > latestD ? 'buy' : 'sell',
      strength: 'moderate',
      name: 'Strong K/D Divergence',
      reason: `K-D spread at ${spread.toFixed(1)} — ${latestK > latestD ? 'bullish' : 'bearish'} momentum unusually strong`,
      category: 'kdj',
    });
  }

  // K in extreme zones
  if (latestK > 80 && latestD > 80) {
    signals.push({
      type: 'sell',
      strength: 'weak',
      name: 'Both K & D Overbought',
      reason: `K=${latestK.toFixed(1)}, D=${latestD.toFixed(1)} both above 80 — rally may be overextended`,
      category: 'kdj',
    });
  } else if (latestK < 20 && latestD < 20) {
    signals.push({
      type: 'buy',
      strength: 'weak',
      name: 'Both K & D Oversold',
      reason: `K=${latestK.toFixed(1)}, D=${latestD.toFixed(1)} both below 20 — selling pressure may be exhausted`,
      category: 'kdj',
    });
  }

  return signals;
}

function detectCombinedSignals(kdjSignals: KDJSignal[], smaSignals: KDJSignal[], smaState: SMAState | null): KDJSignal[] {
  const combined: KDJSignal[] = [];
  if (!smaState) return combined;

  const kdjBuys = kdjSignals.filter(s => s.type === 'buy');
  const kdjSells = kdjSignals.filter(s => s.type === 'sell');
  const smaBuys = smaSignals.filter(s => s.type === 'buy');
  const smaSells = smaSignals.filter(s => s.type === 'sell');

  // KDJ + SMA both bullish
  if (kdjBuys.length > 0 && smaBuys.length > 0) {
    combined.push({
      type: 'buy',
      strength: 'strong',
      name: 'KDJ + SMA Bullish Alignment',
      reason: `Both KDJ and SMA signals agree on bullish direction — high-conviction buy setup`,
      category: 'combined',
    });
  }

  // KDJ + SMA both bearish
  if (kdjSells.length > 0 && smaSells.length > 0) {
    combined.push({
      type: 'sell',
      strength: 'strong',
      name: 'KDJ + SMA Bearish Alignment',
      reason: `Both KDJ and SMA signals agree on bearish direction — high-conviction sell setup`,
      category: 'combined',
    });
  }

  // KDJ buy but SMA bearish (counter-trend)
  if (kdjBuys.length > 0 && smaSells.length > 0) {
    combined.push({
      type: 'buy',
      strength: 'weak',
      name: 'KDJ Buy vs SMA Bearish (Counter-Trend)',
      reason: `KDJ suggests buying but SMA trend is bearish — this is a counter-trend trade, higher risk`,
      category: 'combined',
    });
  }

  // KDJ sell but SMA bullish (counter-trend)
  if (kdjSells.length > 0 && smaBuys.length > 0) {
    combined.push({
      type: 'sell',
      strength: 'weak',
      name: 'KDJ Sell vs SMA Bullish (Counter-Trend)',
      reason: `KDJ suggests selling but SMA trend is bullish — this is a counter-trend trade, higher risk`,
      category: 'combined',
    });
  }

  return combined;
}

function analyzeKDJ(data: StockData[], k: (number | null)[], d: (number | null)[], j: (number | null)[], sma20: (number | null)[], sma50: (number | null)[]): KDJAnalysis | null {
  if (data.length < 50) return null;

  const len = k.length;
  const latestK = k[len - 1];
  const latestD = d[len - 1];
  const latestJ = j[len - 1];

  if (latestK === null || latestD === null || latestJ === null) return null;

  const smaState = getSMAState(data, sma20, sma50);
  const kdjSignals = detectKDJSignals(k, d, j, smaState);
  const smaSignals = detectSMASignals(smaState);
  const combinedSignals = detectCombinedSignals(kdjSignals, smaSignals, smaState);
  const signals = [...combinedSignals, ...kdjSignals, ...smaSignals];

  // Zone analysis
  let zone = '';
  let zoneDescription = '';
  if (latestJ > 100) {
    zone = 'Overbought';
    zoneDescription = 'J-line above 100 — price extended too far, too fast. Often precedes a correction.';
  } else if (latestJ > 80) {
    zone = 'Upper Zone';
    zoneDescription = 'K, D, J in upper range (80-100). Strong momentum but approaching exhaustion.';
  } else if (latestJ < 0) {
    zone = 'Oversold';
    zoneDescription = 'J-line below 0 — price fallen too far, too fast. Often precedes a bounce.';
  } else if (latestJ < 20) {
    zone = 'Lower Zone';
    zoneDescription = 'K, D, J in lower range (0-20). Selling pressure but approaching a turning point.';
  } else {
    zone = 'Neutral';
    zoneDescription = 'K, D, J in middle range (20-80). Normal trading — rely on crossovers and trend.';
  }

  // Momentum analysis
  let momentum = '';
  let momentumDescription = '';
  if (latestK > latestD && latestJ > latestK) {
    momentum = 'Bullish Acceleration';
    momentumDescription = 'K above D, J above K — all three fanning upward. Strongest bullish configuration.';
  } else if (latestK > latestD) {
    momentum = 'Bullish';
    momentumDescription = 'K above D — bullish momentum. J not leading may indicate maturing uptrend.';
  } else if (latestK < latestD && latestJ < latestK) {
    momentum = 'Bearish Acceleration';
    momentumDescription = 'K below D, J below K — all three fanning downward. Strongest bearish configuration.';
  } else if (latestK < latestD) {
    momentum = 'Bearish';
    momentumDescription = 'K below D — bearish momentum. J not leading lower may indicate maturing downtrend.';
  } else {
    momentum = 'Neutral';
    momentumDescription = 'K and D intertwined — no directional momentum. Wait for a clear crossover.';
  }

  // Trend confirmation
  let trendConfirmation = '';
  if (smaState) {
    const { priceAboveSma20, priceAboveSma50, sma20AboveSma50 } = smaState;
    if (priceAboveSma20 && priceAboveSma50 && sma20AboveSma50) {
      trendConfirmation = 'Strong uptrend: price above both SMA20 and SMA50, with SMA20 above SMA50. KDJ buy signals are trend-aligned.';
    } else if (!priceAboveSma20 && !priceAboveSma50 && !sma20AboveSma50) {
      trendConfirmation = 'Strong downtrend: price below both SMA20 and SMA50, with SMA20 below SMA50. KDJ sell signals are trend-aligned.';
    } else if (priceAboveSma20 && !priceAboveSma50) {
      trendConfirmation = 'Mixed: price above SMA20 but below SMA50. Short-term bullish, medium-term bearish. Wait for alignment.';
    } else if (!priceAboveSma20 && priceAboveSma50) {
      trendConfirmation = 'Mixed: price below SMA20 but above SMA50. Short-term bearish, medium-term bullish. Pullback in uptrend.';
    } else {
      trendConfirmation = 'Trend context: price and SMAs are in transition. Watch for clear directional alignment.';
    }
  }

  // Generate explanation
  const hasBuy = signals.some(s => s.type === 'buy');
  const hasSell = signals.some(s => s.type === 'sell');
  const strongBuy = signals.filter(s => s.type === 'buy' && s.strength === 'strong').length;
  const strongSell = signals.filter(s => s.type === 'sell' && s.strength === 'strong').length;

  let explanation = '';
  if (strongBuy > 0 || strongSell > 0) {
    const dir = strongBuy > 0 ? 'buying' : 'selling';
    explanation = `Strong ${dir} signals detected. `;
  } else if (hasBuy && !hasSell) {
    explanation = 'Buy signals present. ';
  } else if (hasSell && !hasBuy) {
    explanation = 'Sell signals present. ';
  } else if (hasBuy && hasSell) {
    explanation = 'Conflicting signals — market at a decision point. ';
  } else {
    explanation = 'No strong signals at this time. ';
  }

  if (smaState) {
    const trendWord = smaState.priceAboveSma20 ? 'above' : 'below';
    explanation += `Price is ${trendWord} SMA20. `;
  }

  explanation += `${zoneDescription.split('.')[0]}. ${momentumDescription.split('.')[0]}.`;

  return { signals, explanation, zone, zoneDescription, momentum, momentumDescription, smaState: smaState!, trendConfirmation };
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

    return slicedData.map((d, i) => ({
      date: d.date,
      k: kSliced[i],
      d: dSliced[i],
      j: jSliced[i],
    }));
  }, [data, fullKDJ]);

  const analysis = useMemo(
    () => analyzeKDJ(data, fullKDJ.k, fullKDJ.d, fullKDJ.j, sma20, sma50),
    [data, fullKDJ, sma20, sma50],
  );

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

  const getSignalBadge = (type: string, strength: string, category: string) => {
    const catLabel = category === 'combined' ? 'combo' : category;
    if (strength === 'strong') {
      return <Badge variant={type === 'buy' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">{strength}</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{strength}</Badge>;
  };

  const getCategoryBadge = (category: string) => {
    if (category === 'combined') return <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/50 text-primary">KDJ+SMA</Badge>;
    if (category === 'sma') return <Badge variant="outline" className="text-[9px] px-1 py-0 border-chart-maFast/50 text-chart-maFast">SMA</Badge>;
    return <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/50 text-primary">KDJ</Badge>;
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 card-glow space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold">KDJ + SMA Indicator</h4>
          <p className="text-xs text-muted-foreground">Stochastic Oscillator with SMA trend confirmation</p>
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

      {/* SMA Trend Context */}
      {analysis?.smaState && (
        <div className="flex gap-2">
          <div className={cn("flex-1 rounded-lg p-2.5 border", analysis.smaState.priceAboveSma20 ? "bg-bullish/10 border-bullish/20" : "bg-bearish/10 border-bearish/20")}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Price vs SMA20</div>
            <div className={cn("text-xs font-medium", analysis.smaState.priceAboveSma20 ? 'text-bullish' : 'text-bearish')}>
              {analysis.smaState.priceAboveSma20 ? 'Above' : 'Below'} (${analysis.smaState.sma20?.toFixed(2)})
            </div>
          </div>
          <div className={cn("flex-1 rounded-lg p-2.5 border", analysis.smaState.priceAboveSma50 ? "bg-bullish/10 border-bullish/20" : "bg-bearish/10 border-bearish/20")}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Price vs SMA50</div>
            <div className={cn("text-xs font-medium", analysis.smaState.priceAboveSma50 ? 'text-bullish' : 'text-bearish')}>
              {analysis.smaState.priceAboveSma50 ? 'Above' : 'Below'} (${analysis.smaState.sma50?.toFixed(2)})
            </div>
          </div>
          <div className={cn("flex-1 rounded-lg p-2.5 border", analysis.smaState.sma20AboveSma50 ? "bg-bullish/10 border-bullish/20" : "bg-bearish/10 border-bearish/20")}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">SMA20 vs SMA50</div>
            <div className={cn("text-xs font-medium", analysis.smaState.sma20AboveSma50 ? 'text-bullish' : 'text-bearish')}>
              {analysis.smaState.sma20AboveSma50 ? 'Golden' : 'Death'} Cross
            </div>
          </div>
        </div>
      )}

      {/* Signals Section */}
      {analysis && analysis.signals.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Signal Detection</h5>
          <div className="space-y-1.5">
            {analysis.signals.map((sig, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {getSignalIcon(sig.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{sig.name}</span>
                    {getCategoryBadge(sig.category)}
                    {getSignalBadge(sig.type, sig.strength, sig.category)}
                  </div>
                  <p className="text-muted-foreground mt-0.5 leading-relaxed">{sig.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zone & Momentum */}
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

          {/* Trend Confirmation */}
          {analysis.trendConfirmation && (
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-primary" />
                <h5 className="text-xs font-semibold">Trend Context</h5>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{analysis.trendConfirmation}</p>
            </div>
          )}

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
