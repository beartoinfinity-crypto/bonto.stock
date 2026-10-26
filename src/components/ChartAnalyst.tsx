import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, Minus, BarChart3, Clock, Calendar, CalendarDays,
  Lightbulb, CheckCircle2,
} from 'lucide-react';
import {
  StockData,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '@/lib/stockData';
import { cn } from '@/lib/utils';

interface ChartAnalystProps {
  data: StockData[];
  symbol: string;
}

type Direction = 'bullish' | 'bearish' | 'neutral';

interface Forecast {
  period: 'short' | 'mid' | 'long';
  label: string;
  direction: Direction;
  confidence: 'High' | 'Medium' | 'Low';
  keyLevels: string[];
  insight: string;
}

interface MetricRow {
  name: string;
  value: string;
  tone: Direction;
  warn: boolean;
  read: string;
}

interface Analysis {
  asOf: string;
  bars: number;
  trend: {
    direction: Direction;
    strength: number;
    changeWeek: number;
    changeMonth: number;
    change3Month: number;
    changeDay: number;
  };
  movingAverages: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    direction: Direction;
  };
  rsi: { value: number | null; zone: string; direction: Direction };
  macd: {
    bullish: boolean;
    histogram: number;
    histogramPrev: number | null;
    crossover: 'up' | 'down' | 'none';
  };
  bollinger: { position: string; pct: number };
  supportResistance: { support: number; resistance: number; riskReward: number };
  volume: { trend: 'high' | 'low' | 'normal'; ratio: number; spike: boolean };
  priceAction: { direction: Direction; pattern: string; bullish5: number; bearish5: number };
  outlook: { bias: Direction; confidence: 'High' | 'Medium' | 'Low'; score: number; summary: string };
  forecasts: Forecast[];
  rows: MetricRow[];
}

function pickBias(bullish: number, bearish: number): Direction {
  return bullish > bearish + 1 ? 'bullish' : bearish > bullish + 1 ? 'bearish' : 'neutral';
}

function analyze(data: StockData[]): Analysis | null {
  if (data.length < 50) return null;

  const volumes = data.map(d => d.volume);

  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const weekAgo = data[Math.max(0, data.length - 5)];
  const monthAgo = data[Math.max(0, data.length - 21)];
  const threeMonthAgo = data[Math.max(0, data.length - 63)];

  const changeWeek = ((last.close - weekAgo.close) / weekAgo.close) * 100;
  const changeMonth = ((last.close - monthAgo.close) / monthAgo.close) * 100;
  const change3Month = ((last.close - threeMonthAgo.close) / threeMonthAgo.close) * 100;
  const changeDay = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;

  // -- Trend ----------------------------------------------------------
  let trendDirection: Direction = 'neutral';
  if (changeMonth > 3) trendDirection = 'bullish';
  else if (changeMonth < -3) trendDirection = 'bearish';

  // -- Moving Averages ------------------------------------------------
  const sma20 = calculateSMA(data, 20);
  const sma50 = calculateSMA(data, 50);
  const sma200 = data.length >= 200 ? calculateSMA(data, 200) : null;
  const sma20Last = sma20[sma20.length - 1];
  const sma50Last = sma50[sma50.length - 1];
  const sma200Last = sma200 ? sma200[sma200.length - 1] : null;

  let maDirection: Direction = 'neutral';
  if (sma20Last && sma50Last) {
    if (last.close > sma20Last && sma20Last > sma50Last) maDirection = 'bullish';
    else if (last.close < sma20Last && sma20Last < sma50Last) maDirection = 'bearish';
  }

  // -- RSI ------------------------------------------------------------
  const rsi = calculateRSI(data);
  const rsiLast = rsi[rsi.length - 1];
  let rsiZone = 'neutral';
  let rsiDirection: Direction = 'neutral';
  if (rsiLast !== null) {
    if (rsiLast < 30) { rsiZone = 'oversold'; rsiDirection = 'bullish'; }
    else if (rsiLast > 70) { rsiZone = 'overbought'; rsiDirection = 'bearish'; }
    else if (rsiLast < 45) rsiDirection = 'bullish';
    else if (rsiLast > 55) rsiDirection = 'bearish';
  }

  // -- MACD -----------------------------------------------------------
  const macd = calculateMACD(data);
  const macdLast = macd.macd[macd.macd.length - 1];
  const signalLast = macd.signal[macd.signal.length - 1];
  const histLast = macd.histogram[macd.histogram.length - 1];
  const histPrev = macd.histogram[macd.histogram.length - 2];
  const macdBullish = macdLast !== null && signalLast !== null && macdLast > signalLast;
  const macdCrossUp = histLast !== null && histPrev !== null && histLast > 0 && histPrev <= 0;
  const macdCrossDown = histLast !== null && histPrev !== null && histLast < 0 && histPrev >= 0;

  // -- Bollinger Bands ------------------------------------------------
  const bb = calculateBollingerBands(data);
  const bbUpper = bb.upper[bb.upper.length - 1];
  const bbLower = bb.lower[bb.lower.length - 1];
  let bbPosition = 'middle';
  let bbPct = 50;
  if (bbUpper && bbLower) {
    const bbRange = bbUpper - bbLower;
    bbPct = bbRange > 0 ? ((last.close - bbLower) / bbRange) * 100 : 50;
    if (bbPct > 90) bbPosition = 'upper';
    else if (bbPct < 10) bbPosition = 'lower';
  }

  // -- Support / Resistance -------------------------------------------
  const recentLows = data.slice(-60).map(d => d.low).sort((a, b) => a - b);
  const recentHighs = data.slice(-60).map(d => d.high).sort((a, b) => b - a);
  const support = recentLows[Math.floor(recentLows.length * 0.1)] ?? last.low;
  const resistance = recentHighs[Math.floor(recentHighs.length * 0.1)] ?? last.high;

  const distSupport = ((last.close - support) / support * 100).toFixed(1);
  const distResist = ((resistance - last.close) / last.close * 100).toFixed(1);
  const riskReward = Number((parseFloat(distResist) / (parseFloat(distSupport) || 1)).toFixed(1));

  // -- Volume ---------------------------------------------------------
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const avgVol50 = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const recentVolRatio = avgVol20 / (avgVol50 || 1);
  const lastVol = volumes[volumes.length - 1];
  const volTrend: 'high' | 'low' | 'normal' = recentVolRatio > 1.3 ? 'high' : recentVolRatio < 0.7 ? 'low' : 'normal';

  // -- Price Action ---------------------------------------------------
  const bullish5 = data.slice(-5).filter(d => d.close > d.open).length;
  const bearish5 = 5 - bullish5;
  const lastBody = Math.abs(last.close - last.open);
  const lastRange = Math.max(0.0001, last.high - last.low);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const upperWick = last.high - Math.max(last.close, last.open);
  let paPattern: string;
  let paDirection: Direction;
  if (lastBody < lastRange * 0.1) {
    paPattern = 'Doji';
    paDirection = 'neutral';
  } else if (lowerWick > lastBody * 2 && upperWick < lastBody) {
    paPattern = 'Hammer';
    paDirection = 'bullish';
  } else if (upperWick > lastBody * 2 && lowerWick < lastBody) {
    paPattern = 'Shooting star';
    paDirection = 'bearish';
  } else {
    paPattern = 'Trending day';
    paDirection = bullish5 >= 3 ? 'bullish' : bearish5 >= 3 ? 'bearish' : 'neutral';
  }

  // -- Forecasts (signals & confidence per timeframe) -----------------
  let shortBull = 0;
  let shortBear = 0;
  if (rsiLast !== null) {
    if (rsiLast < 30) shortBull += 3; else if (rsiLast < 40) shortBull += 1;
    else if (rsiLast > 70) shortBear += 3; else if (rsiLast > 60) shortBear += 1;
  }
  if (macdCrossUp) shortBull += 3; else if (macdBullish) shortBull += 1;
  else if (macdCrossDown) shortBear += 3; else shortBear += 1;
  if (bbPosition === 'lower') shortBull += 2; else if (bbPosition === 'upper') shortBear += 2;
  if (paPattern === 'Hammer') shortBull += 2;
  else if (paPattern === 'Shooting star') shortBear += 2;
  else if (last.close >= last.open) shortBull += 1; else shortBear += 1;

  let midBull = 0;
  let midBear = 0;
  if (trendDirection === 'bullish') midBull += 2; else if (trendDirection === 'bearish') midBear += 2;
  if (sma20Last && sma50Last && last.close > sma20Last && sma20Last > sma50Last) midBull += 2;
  else if (sma20Last && sma50Last && last.close < sma20Last && sma20Last < sma50Last) midBear += 2;
  if (recentVolRatio > 1.2) { if (changeWeek > 0) midBull += 1; else midBear += 1; }
  if (((last.close - support) / support * 100) < 3) midBull += 1;
  if (((resistance - last.close) / last.close * 100) < 3) midBear += 1;
  if (sma200Last) { if (last.close > sma200Last) midBull += 1; else midBear += 1; }

  let longBull = 0;
  let longBear = 0;
  if (sma200Last) {
    if (last.close > sma200Last) longBull += 3; else longBear += 3;
    if (sma50Last && sma50Last > sma200Last) longBull += 1;
    else if (sma50Last && sma50Last < sma200Last) longBear += 1;
  }
  if (change3Month > 10) longBull += 2; else if (change3Month > 3) longBull += 1;
  else if (change3Month < -10) longBear += 2; else if (change3Month < -3) longBear += 1;

  const shortBias = pickBias(shortBull, shortBear);
  const midBias = pickBias(midBull, midBear);
  const longBias = pickBias(longBull, longBear);

  const shortLevels = [
    `Support $${support.toFixed(2)}`,
    `Resistance $${resistance.toFixed(2)}`,
    bbLower ? `BB lower $${bbLower.toFixed(2)}` : null,
    bbUpper ? `BB upper $${bbUpper.toFixed(2)}` : null,
  ].filter(Boolean) as string[];
  const midLevels = [
    sma20Last ? `SMA20 $${sma20Last.toFixed(2)}` : null,
    sma50Last ? `SMA50 $${sma50Last.toFixed(2)}` : null,
    `Support $${support.toFixed(2)}`,
    `Resistance $${resistance.toFixed(2)}`,
  ].filter(Boolean) as string[];
  const longLevels = [
    sma200Last ? `SMA200 $${sma200Last.toFixed(2)}` : null,
    `3mo low $${recentLows[0]?.toFixed(2) ?? 'n/a'}`,
    `3mo high $${recentHighs[0]?.toFixed(2) ?? 'n/a'}`,
    `Support $${support.toFixed(2)}`,
  ].filter(Boolean) as string[];

  const shortInsight =
    shortBias === 'bullish'
      ? `Over the next 1-5 sessions the bias is modestly up. Watch a break of $${resistance.toFixed(2)} to confirm.`
      : shortBias === 'bearish'
      ? `Over the next 1-5 sessions the bias is modestly down. A break below $${support.toFixed(2)} would add conviction.`
      : `No clear edge over the next 1-5 sessions \u2014 wait for a break of $${resistance.toFixed(2)} or $${support.toFixed(2)}.`;
  const midInsight =
    midBias === 'bullish'
      ? `The 1-4 week view is constructive while price holds the 20/50-day averages. $${resistance.toFixed(2)} is the level to beat.`
      : midBias === 'bearish'
      ? `The 1-4 week view is cautious while price holds below the 20/50-day averages. $${support.toFixed(2)} is the level that matters.`
      : `Likely consolidation over 1-4 weeks \u2014 no strong trend edge until $${resistance.toFixed(2)} or $${support.toFixed(2)} gives way.`;
  const longInsight =
    longBias === 'bullish'
      ? `The 1-3 month trend is higher. Pullbacks toward $${support.toFixed(2)} have tended to hold.`
      : longBias === 'bearish'
      ? `The 1-3 month trend is lower. Rallies toward resistance have tended to fade.`
      : `The 1-3 month view is range-bound near $${support.toFixed(2)}-$${resistance.toFixed(2)} until a decisive break.`;

  const forecasts: Forecast[] = [
    { period: 'short', label: '1\u20135 Days', direction: shortBias, confidence: pickConfidence(shortBull, shortBear), keyLevels: shortLevels, insight: shortInsight },
    { period: 'mid', label: '1\u20134 Weeks', direction: midBias, confidence: pickConfidence(midBull, midBear), keyLevels: midLevels, insight: midInsight },
    { period: 'long', label: '1\u20133 Months', direction: longBias, confidence: pickConfidence(longBull, longBear), keyLevels: longLevels, insight: longInsight },
  ];

  // -- Overall outlook (aggregated across timeframes) -----------------
  const totalBull = shortBull + midBull * 2 + longBull * 3;
  const totalBear = shortBear + midBear * 2 + longBear * 3;
  const score = totalBull + totalBear > 0 ? Math.round((totalBull / (totalBull + totalBear)) * 100) : 50;
  const bias: Direction = score >= 62 ? 'bullish' : score <= 38 ? 'bearish' : 'neutral';
  const confidence = pickConfidence(totalBull, totalBear);

  const biasLabel = bias === 'bullish' ? 'Bullish' : bias === 'bearish' ? 'Bearish' : 'Neutral';
  const summary =
    bias === 'bullish'
      ? 'The multi-timeframe read leans bullish. Entries near support with a defined stop are safer than chasing strength.'
      : bias === 'bearish'
      ? 'The multi-timeframe read leans bearish. Rallies into resistance are more likely to fade than to break.'
      : 'Indicators are mixed \u2014 no persistent edge. Wait for a break above resistance or below support before committing.';

  // -- Compact metric rows --------------------------------------------
  const syntax = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;
  const rows: MetricRow[] = [];
  rows.push({
    name: 'Trend (3 mo)',
    value: syntax(change3Month),
    tone: trendDirection,
    warn: false,
    read:
      trendDirection === 'bullish'
        ? `Up ${syntax(changeWeek)} this week and ${syntax(changeMonth)} this month${changeDay > 0 ? '; green today.' : '; softer today.'}`
        : trendDirection === 'bearish'
        ? `Down ${syntax(changeWeek)} this week and ${syntax(changeMonth)} this month.`
        : `Range-bound \u2014 ${syntax(changeWeek)} this week, ${syntax(changeMonth)} this month.`,
  });
  rows.push({
    name: 'Moving Averages',
    value: sma20Last && sma50Last ? `$${sma20Last.toFixed(1)} / $${sma50Last.toFixed(1)}` : 'n/a',
    tone: maDirection,
    warn: false,
    read:
      maDirection === 'bullish'
        ? `Price above the 20 and 50-day averages${sma200Last ? `; ${last.close > sma200Last ? 'also above' : 'below'} the 200-day ($${sma200Last.toFixed(1)}).` : '.'}`
        : maDirection === 'bearish'
        ? `Price below the 20 and 50-day averages${sma200Last ? `; and ${last.close > sma200Last ? 'above' : 'below'} the 200-day ($${sma200Last.toFixed(1)}).` : '.'}`
        : `MAs are tangled \u2014 no clean alignment.`,
  });
  rows.push({
    name: 'RSI (14)',
    value: rsiLast !== null ? rsiLast.toFixed(0) : 'n/a',
    tone: rsiDirection,
    warn: rsiLast !== null && (rsiLast < 30 || rsiLast > 70),
    read:
      rsiLast === null ? 'No RSI data.'
        : rsiLast < 30 ? `Oversold at ${rsiLast.toFixed(0)} \u2014 bounces are possible but a falling-knife risk remains.`
        : rsiLast > 70 ? `Overbought at ${rsiLast.toFixed(0)} \u2014 stretched near-term, pullbacks are common.`
        : rsiLast < 45 ? `Leaning oversold at ${rsiLast.toFixed(0)} \u2014 room on the left side.`
        : rsiLast > 55 ? `Leaning overbought at ${rsiLast.toFixed(0)} \u2014 room on the right side.`
        : `Balanced momentum around ${rsiLast.toFixed(0)}.`,
  });
  rows.push({
    name: 'MACD',
    value: histLast !== null ? `${histLast >= 0 ? '+' : ''}${histLast.toFixed(2)}` : 'n/a',
    tone: macdBullish ? 'bullish' : 'bearish',
    warn: macdCrossUp || macdCrossDown,
    read:
      macdCrossUp ? 'Fresh golden cross \u2014 momentum turning up.'
        : macdCrossDown ? 'Fresh death cross \u2014 momentum turning down.'
        : macdBullish
        ? `MACD above signal${histPrev !== null && histLast !== null && Math.abs(histLast) > Math.abs(histPrev) ? ', histogram expanding' : ', histogram steady'} \u2014 mild up-lean.`
        : `MACD below signal${histPrev !== null && histLast !== null && Math.abs(histLast) > Math.abs(histPrev) ? ', histogram expanding' : ', histogram steady'} \u2014 mild down-lean.`,
  });
  rows.push({
    name: 'Bollinger (20,2)',
    value: `${bbPct.toFixed(0)}% of band`,
    tone: bbPosition === 'upper' ? 'bearish' : bbPosition === 'lower' ? 'bullish' : 'neutral',
    warn: bbPct > 90 || bbPct < 10,
    read:
      bbPct > 90 ? `Riding the upper band \u2014 extended vs the recent range, mean-reversion risk.`
        : bbPct < 10 ? `At the lower band \u2014 short-term stretched, a bounce is possible.`
        : `Mid-band \u2014 no extreme positioning.`,
  });
  rows.push({
    name: 'Key Levels',
    value: `S $${support.toFixed(2)} / R $${resistance.toFixed(2)}`,
    tone: riskReward >= 1 ? trendDirection : 'neutral',
    warn: riskReward < 1,
    read:
      riskReward < 1
        ? `Resistance is closer than support (R/R ${riskReward.toFixed(1)}:1) \u2014 the setup is not favourable right now.`
        : `Upside to $${resistance.toFixed(2)} vs downside to $${support.toFixed(2)} is about ${riskReward.toFixed(1)}:1.`,
  });
  rows.push({
    name: 'Volume',
    value: `${recentVolRatio.toFixed(1)}x`,
    tone: 'neutral',
    warn: recentVolRatio > 1.6 || recentVolRatio < 0.6 || (lastVol > avgVol20 * 1.5 && avgVol20 > 0),
    read:
      lastVol > avgVol20 * 1.5 && avgVol20 > 0
        ? `${(lastVol / 1_000_000).toFixed(1)}M shares today \u2014 a ${((lastVol / avgVol20 - 1) * 100).toFixed(0)}% spike above the 20-day norm.`
        : recentVolRatio > 1.6 ? `20-day volume ${recentVolRatio.toFixed(1)}x the 50-day \u2014 participation is elevated${changeWeek > 0 ? ' and confirms the move.' : ' but the move is fading.'}`
        : recentVolRatio < 0.6 ? `Volume has dried up (${recentVolRatio.toFixed(1)}x the 50-day) \u2014 low conviction both ways.`
        : `Volume roughly in line with the 50-day average.`,
  });
  rows.push({
    name: 'Price Action',
    value: paPattern,
    tone: paDirection,
    warn: paPattern === 'Shooting star' || (paPattern === 'Hammer' && changeWeek < 0) || paPattern === 'Doji',
    read:
      paPattern === 'Shooting star' ? 'Shooting star \u2014 sellers rejected an early push higher. A caution candle at the top.'
        : paPattern === 'Hammer' && changeWeek < 0 ? 'Hammer \u2014 buyers defended the lows during weakness. A potential reversal candle.'
        : paPattern === 'Doji' ? 'Doji \u2014 indecision; a pause or a turn, neither confirmed yet.'
        : paPattern === 'Trending day'
        ? `Closed near the ${last.close >= last.open ? 'highs (5s: ' : 'lows (5s: '}${bullish5} green / ${bearish5} red).`
        : `5 sessions: ${bullish5} green / ${bearish5} red.`,
  });
  rows.sort((a, b) => Number(b.warn) - Number(a.warn));

  return {
    asOf: last.date,
    bars: data.length,
    trend: { direction: trendDirection, strength: Math.min(Math.abs(changeMonth) / 10, 1), changeWeek, changeMonth, change3Month, changeDay },
    movingAverages: { sma20: sma20Last, sma50: sma50Last, sma200: sma200Last, direction: maDirection },
    rsi: { value: rsiLast, zone: rsiZone, direction: rsiDirection },
    macd: { bullish: macdBullish, histogram: histLast ?? 0, histogramPrev: histPrev, crossover: macdCrossUp ? 'up' : macdCrossDown ? 'down' : 'none' },
    bollinger: { position: bbPosition, pct: bbPct },
    supportResistance: { support, resistance, riskReward },
    volume: { trend: volTrend, ratio: recentVolRatio, spike: lastVol > avgVol20 * 1.5 && avgVol20 > 0 },
    priceAction: { direction: paDirection, pattern: paPattern, bullish5, bearish5 },
    outlook: { bias, confidence, score, summary },
    forecasts,
    rows,
  };
}

function pickConfidence(bullish: number, bearish: number): 'High' | 'Medium' | 'Low' {
  const diff = Math.abs(bullish - bearish);
  return diff >= 3 ? 'High' : diff >= 2 ? 'Medium' : 'Low';
}

const forecastIcons = {
  short: Clock,
  mid: Calendar,
  long: CalendarDays,
};

const trendBadge = {
  bullish: { label: 'Bullish', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  bearish: { label: 'Bearish', className: 'bg-red-500/15 text-red-500 border-red-500/30' },
  neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' },
};

const biasIcon = {
  bullish: TrendingUp,
  bearish: TrendingDown,
  neutral: Minus,
};

const rowTone = {
  bullish: { Icon: TrendingUp, className: 'text-emerald-500' },
  bearish: { Icon: TrendingDown, className: 'text-red-500' },
  neutral: { Icon: Minus, className: 'text-muted-foreground' },
};

export function ChartAnalyst({ data, symbol }: ChartAnalystProps) {
  const analysis = useMemo(() => analyze(data), [data]);

  if (!analysis) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Insufficient data for commentary. Need at least 50 data points.
        </CardContent>
      </Card>
    );
  }

  const { outlook, rows, forecasts } = analysis;
  const bias = trendBadge[outlook.bias];
  const BiasIcon = biasIcon[outlook.bias];
  const bullishCount = rows.filter(r => r.tone === 'bullish').length;
  const watchCount = rows.filter(r => r.warn).length;
  const filledSegments = Math.max(1, Math.round((outlook.score / 100) * 8));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Analyst Commentary — {symbol}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Hero verdict */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className={cn('flex items-center gap-2', bias.className)}>
                <BiasIcon className="h-5 w-5" />
                <span className="text-2xl font-bold leading-none">{bias.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold">{bullishCount} of {rows.length} indicators bullish</span>
                {watchCount > 0 && <span className="text-orange-500"> · {watchCount} to watch</span>}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Technical score</p>
              <p className={cn('text-2xl font-bold tabular-nums leading-none', bias.className)}>
                {outlook.score}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </p>
              <p className="text-[10px] text-muted-foreground">{outlook.confidence} confidence</p>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className={cn('h-1.5 flex-1 rounded-full', i < filledSegments ? (outlook.bias === 'bullish' ? 'bg-emerald-500' : outlook.bias === 'bearish' ? 'bg-red-500' : 'bg-yellow-500') : 'bg-border')}
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
            <p className="text-sm font-medium leading-snug">{outlook.summary}</p>
          </div>
        </div>

        {/* Metric rows */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Indicators</span>
            <span className="text-xs text-muted-foreground">{bullishCount}/{rows.length} bullish{watchCount > 0 && ` · ${watchCount} watch`}</span>
          </div>

          {rows.map((r) => {
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

        {/* Forecasts */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Multi-Timeframe Forecast
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {forecasts.map((f) => {
              const Icon = forecastIcons[f.period];
              const badge = trendBadge[f.direction];
              return (
                <div
                  key={f.period}
                  className={cn(
                    'rounded-lg border p-3 space-y-2',
                    f.direction === 'bullish' && 'bg-emerald-500/5 border-emerald-500/20',
                    f.direction === 'bearish' && 'bg-red-500/5 border-red-500/20',
                    f.direction === 'neutral' && 'bg-muted/50 border-border',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" /> {f.label}
                    </div>
                    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', badge.className)}>
                      {badge.label}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Confidence: {f.confidence}</div>
                  <p className="text-xs text-foreground/90 leading-relaxed">{f.insight}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Data basis */}
        <div className="flex items-start gap-2 rounded-md bg-secondary/30 px-2.5 py-2">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground italic">
            {symbol} · based on {analysis.bars.toLocaleString()} daily closes through {analysis.asOf}. Derived from price and volume only — not financial advice.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}