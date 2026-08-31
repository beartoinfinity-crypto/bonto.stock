import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  TrendingUp, TrendingDown, Minus, BarChart3, Target, Activity,
  Zap, AlertTriangle, CheckCircle2, Clock, Calendar, CalendarDays,
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

interface Forecast {
  period: 'short' | 'mid' | 'long';
  label: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: 'High' | 'Medium' | 'Low';
  keyLevels: string[];
  insight: string;
}

interface Analysis {
  trend: { direction: 'bullish' | 'bearish' | 'neutral'; strength: number; description: string };
  movingAverages: { sma20: number | null; sma50: number | null; sma200: number | null; description: string };
  rsi: { value: number | null; zone: string; description: string };
  macd: { bullish: boolean; histogram: number; description: string };
  bollinger: { position: string; pct: number; description: string };
  supportResistance: { support: number; resistance: number; description: string };
  volume: { trend: string; description: string };
  priceAction: { description: string };
  outlook: { bias: 'bullish' | 'bearish' | 'neutral'; confidence: string; summary: string };
  forecasts: Forecast[];
}

function pickBias(bullish: number, bearish: number): 'bullish' | 'bearish' | 'neutral' {
  return bullish > bearish + 1 ? 'bullish' : bearish > bullish + 1 ? 'bearish' : 'neutral';
}

function pickConfidence(bullish: number, bearish: number): 'High' | 'Medium' | 'Low' {
  const diff = Math.abs(bullish - bearish);
  return diff >= 3 ? 'High' : diff >= 2 ? 'Medium' : 'Low';
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
  let trendDirection: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let trendStrength = 0;
  if (changeMonth > 3) { trendDirection = 'bullish'; trendStrength = Math.min(changeMonth / 10, 1); }
  else if (changeMonth < -3) { trendDirection = 'bearish'; trendStrength = Math.min(Math.abs(changeMonth) / 10, 1); }

  const trendDesc = trendDirection === 'bullish'
    ? `${last.symbol} is trending higher \u2014 up ${changeWeek.toFixed(1)}% this week, ${changeMonth.toFixed(1)}% this month, and ${change3Month.toFixed(1)}% over three months. ${changeDay > 0 ? 'Today\u2019s session added to the gains.' : 'A modest pullback today does not undermine the broader uptrend.'}`
    : trendDirection === 'bearish'
    ? `${last.symbol} is under distribution \u2014 down ${changeWeek.toFixed(1)}% this week, ${Math.abs(changeMonth).toFixed(1)}% this month, and ${Math.abs(change3Month).toFixed(1)}% over three months. ${changeDay < 0 ? 'Selling continued today.' : 'A bounce today may be a dead cat bounce unless confirmed by follow-through.'}`
    : `${last.symbol} is consolidating in a range. Week-over-week change is ${changeWeek.toFixed(1)}%, month-over-month ${changeMonth.toFixed(1)}%. No dominant trend \u2014 waiting for a catalyst.`;

  // -- Moving Averages ------------------------------------------------
  const sma20 = calculateSMA(data, 20);
  const sma50 = calculateSMA(data, 50);
  const sma200 = data.length >= 200 ? calculateSMA(data, 200) : null;
  const sma20Last = sma20[sma20.length - 1];
  const sma50Last = sma50[sma50.length - 1];
  const sma200Last = sma200 ? sma200[sma200.length - 1] : null;

  let crossProximity = '';
  if (sma200Last && sma50Last) {
    const gapPct = ((sma50Last - sma200Last) / sma200Last) * 100;
    if (Math.abs(gapPct) < 1) {
      crossProximity = gapPct > 0
        ? ' The 50-day SMA is converging toward the 200-day \u2014 a potential Golden Cross within reach.'
        : ' The 50-day SMA is converging toward the 200-day \u2014 a potential Death Cross looming.';
    }
  }

  let maDesc = '';
  if (sma20Last && sma50Last) {
    const dist20 = ((last.close - sma20Last) / sma20Last * 100).toFixed(1);
    const dist50 = ((last.close - sma50Last) / sma50Last * 100).toFixed(1);

    if (last.close > sma20Last && sma20Last > sma50Last) {
      maDesc = `Price ($${last.close.toFixed(2)}) trades ${dist20}% above the 20-day SMA ($${sma20Last.toFixed(2)}) and ${dist50}% above the 50-day SMA ($${sma50Last.toFixed(2)}) \u2014 a bullish "stacked" alignment where shorter MAs lead higher. `;
    } else if (last.close < sma20Last && sma20Last < sma50Last) {
      maDesc = `Price ($${last.close.toFixed(2)}) trades ${Math.abs(Number(dist20))}% below the 20-day SMA ($${sma20Last.toFixed(2)}) and ${Math.abs(Number(dist50))}% below the 50-day SMA ($${sma50Last.toFixed(2)}) \u2014 a bearish alignment where each MA acts as overhead resistance. `;
    } else {
      maDesc = `Price ($${last.close.toFixed(2)}) is tangled with the MAs \u2014 20-day at $${sma20Last.toFixed(2)} (${dist20}%), 50-day at $${sma50Last.toFixed(2)} (${dist50}%). The lack of clear separation signals indecision. `;
    }
    if (sma200Last) {
      const dist200 = ((last.close - sma200Last) / sma200Last * 100).toFixed(1);
      maDesc += last.close > sma200Last
        ? `Above the 200-day SMA ($${sma200Last.toFixed(2)}, +${dist200}%) \u2014 the long-term trend remains constructive.`
        : `Below the 200-day SMA ($${sma200Last.toFixed(2)}, ${dist200}%) \u2014 long-term momentum is negative. A reclaim of this level would be a significant bullish signal.`;
    }
    maDesc += crossProximity;
  }

  // -- RSI ------------------------------------------------------------
  const rsi = calculateRSI(data);
  const rsiLast = rsi[rsi.length - 1];
  const rsiPrev = rsi[rsi.length - 2];
  let rsiZone = 'neutral';
  let rsiDesc = '';
  if (rsiLast !== null) {
    const rsiTrend = rsiPrev !== null ? rsiLast - rsiPrev : 0;
    const rsiDir = rsiTrend > 1 ? 'rising' : rsiTrend < -1 ? 'falling' : 'flat';

    if (rsiLast < 30) {
      rsiZone = 'oversold';
      rsiDesc = `RSI at ${rsiLast.toFixed(1)} (${rsiDir}) \u2014 deeply oversold. Historically, readings below 30 have preceded mean-reversion rallies in most equities. Watch for bullish divergence or a candle reversal pattern as confirmation before entering.`;
    } else if (rsiLast > 70) {
      rsiZone = 'overbought';
      rsiDesc = `RSI at ${rsiLast.toFixed(1)} (${rsiDir}) \u2014 overbought territory. Strong momentum, but the risk/reward for new entries is unfavorable. A pullback toward the 40-50 zone would offer a better risk-adjusted entry.`;
    } else if (rsiLast < 40) {
      rsiDesc = `RSI at ${rsiLast.toFixed(1)} (${rsiDir}) \u2014 leaning bearish but not yet oversold. Momentum is weakening. A break below 30 would signal capitulation; a bounce from here would suggest buyers are stepping in.`;
    } else if (rsiLast > 60) {
      rsiDesc = `RSI at ${rsiLast.toFixed(1)} (${rsiDir}) \u2014 leaning bullish with room to run. Momentum favors buyers, but watch for exhaustion if RSI approaches 70 without price making new highs.`;
    } else {
      rsiDesc = `RSI at ${rsiLast.toFixed(1)} (${rsiDir}) \u2014 balanced momentum. Neither side has a clear edge. Wait for RSI to break above 60 (bullish) or below 40 (bearish) for a directional signal.`;
    }
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
  const histAccelerating = histLast !== null && histPrev !== null ? Math.abs(histLast) > Math.abs(histPrev) : false;

  const zeroLine = macdLast !== null ? (macdLast > 0 ? 'above' : 'below') : 'at';
  let macdDesc = '';
  if (macdCrossUp) {
    macdDesc = `MACD just crossed above the signal line \u2014 a fresh bullish crossover. Histogram turned positive, confirming upward momentum is building. This is one of the most reliable short-term buy signals when confirmed by volume.`;
  } else if (macdCrossDown) {
    macdDesc = `MACD just crossed below the signal line \u2014 a bearish crossover. Histogram turned negative, indicating selling pressure is increasing. Consider tightening stops if long.`;
  } else if (macdBullish) {
    macdDesc = `MACD (${macdLast?.toFixed(2)}) remains above the signal line (${signalLast?.toFixed(2)}), ${zeroLine} the zero line. ${histAccelerating ? 'Histogram is expanding \u2014 momentum is accelerating.' : 'Histogram is narrowing \u2014 momentum may be peaking.'}`;
  } else {
    macdDesc = `MACD (${macdLast?.toFixed(2)}) is below the signal line (${signalLast?.toFixed(2)}), ${zeroLine} the zero line. ${histAccelerating ? 'Histogram is expanding to the downside \u2014 bearish momentum is intensifying.' : 'Histogram is narrowing \u2014 bearish momentum may be decelerating.'}`;
  }

  // -- Bollinger Bands ------------------------------------------------
  const bb = calculateBollingerBands(data);
  const bbUpper = bb.upper[bb.upper.length - 1];
  const bbLower = bb.lower[bb.lower.length - 1];
  const bbMiddle = bb.middle[bb.middle.length - 1];
  let bbPosition = 'middle';
  let bbPct = 50;
  let bbDesc = '';
  if (bbUpper && bbLower) {
    const bbRange = bbUpper - bbLower;
    bbPct = bbRange > 0 ? ((last.close - bbLower) / bbRange) * 100 : 50;
    const bandwidth = bbMiddle ? ((bbRange / bbMiddle) * 100).toFixed(1) : '?';

    if (bbPct > 90) {
      bbPosition = 'upper';
      bbDesc = `Price sits at the upper band ($${bbUpper.toFixed(2)}), ${bbPct.toFixed(0)}% of band width. Bandwidth is ${bandwidth}% of middle band. ${last.close >= bbUpper ? 'A close at or above the upper band signals strong momentum \u2014 but watch for a reversion toward the mean.' : 'Approaching resistance at the upper band. A breakout above would open upside acceleration.'}`;
    } else if (bbPct < 10) {
      bbPosition = 'lower';
      bbDesc = `Price sits at the lower band ($${bbLower.toFixed(2)}), ${bbPct.toFixed(0)}% of band width. Bandwidth is ${bandwidth}% of middle band. ${last.close <= bbLower ? `A close at or below the lower band signals selling exhaustion \u2014 a bounce toward the middle band ($${bbMiddle?.toFixed(2) ?? '?'}) is statistically likely.` : 'Near support at the lower band. A break below would signal further downside.'}`;
    } else {
      bbDesc = `Price is in the middle zone at ${bbPct.toFixed(0)}% of band width ($${bbLower.toFixed(2)} \u2013 $${bbUpper.toFixed(2)}). Bandwidth is ${bandwidth}%. ${parseFloat(bandwidth) < 5 ? 'Tight bandwidth suggests a volatility squeeze \u2014 expect an expansion move soon.' : 'No extreme positioning. A move toward either band would set the near-term direction.'}`;
    }
  }

  // -- Support / Resistance -------------------------------------------
  const recentLows = data.slice(-60).map(d => d.low).sort((a, b) => a - b);
  const recentHighs = data.slice(-60).map(d => d.high).sort((a, b) => b - a);
  const support = recentLows[Math.floor(recentLows.length * 0.1)] ?? last.low;
  const resistance = recentHighs[Math.floor(recentHighs.length * 0.1)] ?? last.high;

  const distSupport = ((last.close - support) / support * 100).toFixed(1);
  const distResist = ((resistance - last.close) / last.close * 100).toFixed(1);
  const riskReward = (parseFloat(distResist) / (parseFloat(distSupport) || 1)).toFixed(1);

  const srDesc = `Support at $${support.toFixed(2)} (${distSupport}% below) \u2014 ${last.close > support ? 'price holds a cushion above this floor.' : 'price is testing this level; a decisive break would target the next support zone.'} Resistance at $${resistance.toFixed(2)} (${distResist}% above). ${parseFloat(riskReward) > 2 ? `Risk/reward skews favorably at ${riskReward}:1 from current levels.` : `Risk/reward is ${riskReward}:1 \u2014 the upside to resistance is modest relative to downside risk.`}`;

  // -- Volume ---------------------------------------------------------
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const avgVol50 = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const recentVolRatio = avgVol20 / (avgVol50 || 1);
  const lastVol = volumes[volumes.length - 1];
  const volConfirm = changeWeek > 0 && recentVolRatio > 1;

  let volDesc = '';
  if (recentVolRatio > 1.3) {
    volDesc = `20-day average volume is ${recentVolRatio.toFixed(1)}x the 50-day average \u2014 elevated participation confirms conviction behind the current trend.`;
  } else if (recentVolRatio < 0.7) {
    volDesc = `20-day average volume is ${recentVolRatio.toFixed(1)}x the 50-day average \u2014 declining participation suggests the move lacks institutional backing.`;
  } else {
    volDesc = `Volume is roughly in line with its 50-day average. No institutional accumulation or distribution signal.`;
  }
  if (lastVol > avgVol20 * 1.5) {
    volDesc += ` Today\u2019s volume (${(lastVol / 1_000_000).toFixed(1)}M) is ${((lastVol / avgVol20 - 1) * 100).toFixed(0)}% above average \u2014 a significant spike.`;
  }
  volDesc += volConfirm
    ? ' Volume confirms the upside move \u2014 a bullish sign.'
    : changeWeek > 0 && recentVolRatio < 1
    ? ' Price is rising on thin volume \u2014 a potential warning sign for the rally.'
    : '';

  // -- Price Action ---------------------------------------------------
  const candleRange = last.high - last.low;
  const bodyRange = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const isHammer = lowerWick > bodyRange * 2 && upperWick < bodyRange;
  const isShootingStar = upperWick > bodyRange * 2 && lowerWick < bodyRange;
  const isDoji = bodyRange < candleRange * 0.1;
  const bullishCandles = data.slice(-5).filter(d => d.close > d.open).length;
  const bearishCandles = 5 - bullishCandles;

  let paDesc = '';
  if (isDoji) {
    paDesc = `A doji candle today signals indecision \u2014 neither buyers nor sellers won the session. After ${changeWeek > 0 ? 'a recent rally' : 'recent weakness'}, this could mark a turning point. Confirm with tomorrow\u2019s close.`;
  } else if (isHammer) {
    paDesc = `A hammer pattern formed \u2014 the long lower wick shows buyers stepped in aggressively at the lows. In a downtrend, this is one of the most reliable reversal signals. Watch for confirmation with a bullish close tomorrow.`;
  } else if (isShootingStar) {
    paDesc = `A shooting star appeared \u2014 price surged to new highs but sellers pushed it back. This is a classic exhaustion pattern at tops. If confirmed by a bearish follow-through, expect a pullback toward support.`;
  } else {
    const bodyDir = last.close >= last.open ? 'bullish' : 'bearish';
    paDesc = `Today\u2019s ${bodyDir} candle (range $${candleRange.toFixed(2)}) ${last.close >= last.open ? 'closed near its highs' : 'closed near its lows'}. Over the last 5 sessions: ${bullishCandles} green, ${bearishCandles} red. ${bullishCandles >= 4 ? 'Buying pressure dominates.' : bearishCandles >= 4 ? 'Selling pressure dominates.' : 'Mixed session sequence \u2014 no clear dominance.'}`;
  }

  // -- Forecasts ------------------------------------------------------

  // Short-term (1-5 days): RSI, MACD crossover, Bollinger, candle pattern
  let shortBull = 0;
  let shortBear = 0;
  if (rsiLast !== null) {
    if (rsiLast < 30) shortBull += 3;
    else if (rsiLast < 40) shortBull += 1;
    else if (rsiLast > 70) shortBear += 3;
    else if (rsiLast > 60) shortBear += 1;
  }
  if (macdCrossUp) shortBull += 3;
  else if (macdBullish) shortBull += 1;
  else if (macdCrossDown) shortBear += 3;
  else shortBear += 1;
  if (bbPosition === 'lower') shortBull += 2;
  else if (bbPosition === 'upper') shortBear += 2;
  if (isHammer) shortBull += 2;
  else if (isShootingStar) shortBear += 2;
  else if (isDoji) { /* neutral */ }
  else if (last.close >= last.open) shortBull += 1;
  else shortBear += 1;

  const shortBias = pickBias(shortBull, shortBear);
  const shortConf = pickConfidence(shortBull, shortBear);
  const shortLevels = [
    `Support $${support.toFixed(2)}`,
    `Resistance $${resistance.toFixed(2)}`,
    bbLower ? `BB Lower $${bbLower.toFixed(2)}` : null,
    bbUpper ? `BB Upper $${bbUpper.toFixed(2)}` : null,
  ].filter(Boolean) as string[];
  const shortInsight = shortBias === 'bullish'
    ? `Bullish setup for the next 1-5 sessions. ${rsiLast !== null && rsiLast < 35 ? 'Oversold RSI suggests a bounce is due.' : 'Momentum indicators favor upside.'} Look for a move toward $${resistance.toFixed(2)} as the near-term target.`
    : shortBias === 'bearish'
    ? `Bearish pressure likely to persist over the next 1-5 sessions. ${rsiLast !== null && rsiLast > 65 ? 'Overbought RSI suggests a pullback.' : 'Momentum indicators favor downside.'} Risk stays toward $${support.toFixed(2)}.`
    : `Neutral \u2014 no strong edge in either direction for the next few sessions. Wait for a break above $${resistance.toFixed(2)} or below $${support.toFixed(2)} for direction.`;

  // Mid-term (1-4 weeks): MA alignment, trend, volume, S/R
  let midBull = 0;
  let midBear = 0;
  if (trendDirection === 'bullish') midBull += 2;
  else if (trendDirection === 'bearish') midBear += 2;
  if (sma20Last && sma50Last && last.close > sma20Last && sma20Last > sma50Last) midBull += 2;
  else if (sma20Last && sma50Last && last.close < sma20Last && sma20Last < sma50Last) midBear += 2;
  if (recentVolRatio > 1.2) {
    if (changeWeek > 0) midBull += 1; else midBear += 1;
  }
  if (last.close > support && ((last.close - support) / support * 100) < 3) midBull += 1;
  if (last.close < resistance && ((resistance - last.close) / last.close * 100) < 3) midBear += 1;
  if (sma200Last) {
    if (last.close > sma200Last) midBull += 1; else midBear += 1;
  }

  const midBias = pickBias(midBull, midBear);
  const midConf = pickConfidence(midBull, midBear);
  const midLevels = [
    sma20Last ? `SMA20 $${sma20Last.toFixed(2)}` : null,
    sma50Last ? `SMA50 $${sma50Last.toFixed(2)}` : null,
    `Support $${support.toFixed(2)}`,
    `Resistance $${resistance.toFixed(2)}`,
  ].filter(Boolean) as string[];
  const midInsight = midBias === 'bullish'
    ? `The 1-4 week outlook favors bulls. ${sma20Last && sma50Last ? 'Price holding above both the 20 and 50-day SMAs provides a rising floor.' : 'Trend structure supports further upside.'} A sustained close above $${resistance.toFixed(2)} would confirm a breakout toward new highs.`
    : midBias === 'bearish'
    ? `The 1-4 week outlook favors bears. ${sma20Last && sma50Last ? 'Price trapped below the 20 and 50-day SMAs keeps a lid on rallies.' : 'Trend structure suggests further downside.'} Watch $${support.toFixed(2)} as the critical support \u2014 a break below accelerates the selloff.`
    : `Consolidation is likely over the next 1-4 weeks. ${sma20Last && sma50Last ? 'Price is caught between the 20 and 50-day SMAs \u2014 a squeeze is forming.' : 'No clear trend edge.'} Wait for a decisive close above $${resistance.toFixed(2)} or below $${support.toFixed(2)} before committing.`;

  // Long-term (1-3 months): SMA200, 3-month trend, S/R, volume
  let longBull = 0;
  let longBear = 0;
  if (sma200Last) {
    if (last.close > sma200Last) longBull += 3; else longBear += 3;
    if (sma50Last && sma50Last > sma200Last) longBull += 1;
    else if (sma50Last && sma50Last < sma200Last) longBear += 1;
  }
  if (change3Month > 10) longBull += 2;
  else if (change3Month > 3) longBull += 1;
  else if (change3Month < -10) longBear += 2;
  else if (change3Month < -3) longBear += 1;
  if (recentVolRatio > 1.2 && change3Month > 0) longBull += 1;
  else if (recentVolRatio > 1.2 && change3Month < 0) longBear += 1;

  const longBias = pickBias(longBull, longBear);
  const longConf = pickConfidence(longBull, longBear);
  const longLevels = [
    sma200Last ? `SMA200 $${sma200Last.toFixed(2)}` : null,
    `3mo Low $${recentLows[0]?.toFixed(2) ?? '?'}`,
    `3mo High $${recentHighs[0]?.toFixed(2) ?? '?'}`,
    `Support $${support.toFixed(2)}`,
  ].filter(Boolean) as string[];
  const longInsight = longBias === 'bullish'
    ? `The 1-3 month outlook is constructive. ${sma200Last ? `Trading above the 200-day SMA ($${sma200Last.toFixed(2)}) confirms the long-term uptrend.` : 'Price structure is bullish on the quarterly timeframe.'} Accumulation on pullbacks toward $${support.toFixed(2)} is the preferred strategy.`
    : longBias === 'bearish'
    ? `The 1-3 month outlook is defensive. ${sma200Last ? `Trading below the 200-day SMA ($${sma200Last.toFixed(2)}) signals the long-term trend has turned negative.` : 'Price structure is bearish on the quarterly timeframe.'} Reduce exposure on rallies and wait for a reclaim of $${sma200Last?.toFixed(2) ?? resistance.toFixed(2)} before re-entering.`
    : `The 1-3 month outlook is range-bound. ${sma200Last ? `Price is near the 200-day SMA ($${sma200Last.toFixed(2)}) \u2014 a key decision point.` : 'No strong quarterly trend.'} A decisive break above $${resistance.toFixed(2)} or below $${support.toFixed(2)} will set the direction for the next 1-3 months.`;

  const forecasts: Forecast[] = [
    { period: 'short', label: '1\u20135 Days', direction: shortBias, confidence: shortConf, keyLevels: shortLevels, insight: shortInsight },
    { period: 'mid', label: '1\u20134 Weeks', direction: midBias, confidence: midConf, keyLevels: midLevels, insight: midInsight },
    { period: 'long', label: '1\u20133 Months', direction: longBias, confidence: longConf, keyLevels: longLevels, insight: longInsight },
  ];

  // -- Overall Outlook ------------------------------------------------
  let bullishScore = 0;
  let bearishScore = 0;
  const reasons: string[] = [];

  if (trendDirection === 'bullish') { bullishScore += 2; reasons.push('upward trend'); }
  else if (trendDirection === 'bearish') { bearishScore += 2; reasons.push('downward trend'); }

  if (sma20Last && sma50Last && last.close > sma20Last && sma20Last > sma50Last) { bullishScore += 1; reasons.push('bullish MA alignment'); }
  else if (sma20Last && sma50Last && last.close < sma20Last && sma20Last < sma50Last) { bearishScore += 1; reasons.push('bearish MA alignment'); }

  if (rsiLast !== null) {
    if (rsiLast < 30) { bullishScore += 1; reasons.push('oversold RSI'); }
    else if (rsiLast > 70) { bearishScore += 1; reasons.push('overbought RSI'); }
  }

  if (macdBullish) { bullishScore += 1; reasons.push('bullish MACD'); }
  else { bearishScore += 1; reasons.push('bearish MACD'); }

  const bias = pickBias(bullishScore, bearishScore);
  const confidence = pickConfidence(bullishScore, bearishScore);

  const biasLabel = bias === 'bullish' ? 'Bullish' : bias === 'bearish' ? 'Bearish' : 'Neutral';
  const summary = `${biasLabel} overall outlook (${confidence} confidence). Key drivers: ${reasons.slice(0, 3).join(', ')}. ` +
    (bias === 'bullish'
      ? 'Look for pullback entries toward support \u2014 the trend is your friend.'
      : bias === 'bearish'
      ? 'Reduce exposure on rallies or wait for a break above resistance to confirm reversal.'
      : 'Wait for a clear directional signal. Trade the range or sit on the sidelines.');

  return {
    trend: { direction: trendDirection, strength: trendStrength, description: trendDesc },
    movingAverages: { sma20: sma20Last, sma50: sma50Last, sma200: sma200Last, description: maDesc },
    rsi: { value: rsiLast, zone: rsiZone, description: rsiDesc },
    macd: { bullish: macdBullish, histogram: histLast ?? 0, description: macdDesc },
    bollinger: { position: bbPosition, pct: bbPct, description: bbDesc },
    supportResistance: { support, resistance, description: srDesc },
    volume: { trend: recentVolRatio > 1.3 ? 'high' : recentVolRatio < 0.7 ? 'low' : 'normal', description: volDesc },
    priceAction: { description: paDesc },
    outlook: { bias, confidence, summary },
    forecasts,
  };
}

const trendIcons = {
  bullish: TrendingUp,
  bearish: TrendingDown,
  neutral: Minus,
};

const trendBadge = {
  bullish: { label: 'Bullish', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  bearish: { label: 'Bearish', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' },
};

const forecastIcons = {
  short: Clock,
  mid: Calendar,
  long: CalendarDays,
};

export function ChartAnalyst({ data, symbol }: ChartAnalystProps) {
  const analysis = useMemo(() => analyze(data), [data]);

  if (!analysis) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Insufficient data for analysis. Need at least 50 data points.
        </CardContent>
      </Card>
    );
  }

  const { trend, movingAverages, rsi, macd, bollinger, supportResistance, volume, priceAction, outlook, forecasts } = analysis;
  const TrendIcon = trendIcons[outlook.bias];
  const outlookBadge = trendBadge[outlook.bias];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Analyst Commentary — {symbol}
          </CardTitle>
          <Badge variant="outline" className={cn('text-xs', outlookBadge.className)}>
            <TrendIcon className="h-3 w-3 mr-1" />
            {outlookBadge.label} · {outlook.confidence} Confidence
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">

        {/* Trend */}
        <Section icon={<TrendingUp className="h-3.5 w-3.5" />} title="Trend Analysis">
          {trend.description}
        </Section>

        <Separator />

        {/* Moving Averages */}
        <Section icon={<Activity className="h-3.5 w-3.5" />} title="Moving Averages">
          {movingAverages.description}
        </Section>

        <Separator />

        {/* RSI + MACD */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section icon={<Zap className="h-3.5 w-3.5" />} title="RSI (14)">
            {rsi.description}
          </Section>
          <Section icon={<Activity className="h-3.5 w-3.5" />} title="MACD">
            {macd.description}
          </Section>
        </div>

        <Separator />

        {/* Bollinger + Volume */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section icon={<BarChart3 className="h-3.5 w-3.5" />} title="Bollinger Bands">
            {bollinger.description}
          </Section>
          <Section icon={<BarChart3 className="h-3.5 w-3.5" />} title="Volume Analysis">
            {volume.description}
          </Section>
        </div>

        <Separator />

        {/* Support / Resistance */}
        <Section icon={<Target className="h-3.5 w-3.5" />} title="Key Levels & Risk/Reward">
          {supportResistance.description}
        </Section>

        <Separator />

        {/* Price Action */}
        <Section icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Price Action & Patterns">
          {priceAction.description}
        </Section>

        <Separator />

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
                  <div className="text-[10px] text-muted-foreground">
                    Confidence: {f.confidence}
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    {f.keyLevels.map((l, i) => (
                      <li key={i}>• {l}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-foreground/90 leading-relaxed">{f.insight}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Overall Outlook */}
        <div className={cn(
          'rounded-lg border p-4',
          outlook.bias === 'bullish' && 'bg-emerald-500/5 border-emerald-500/20',
          outlook.bias === 'bearish' && 'bg-red-500/5 border-red-500/20',
          outlook.bias === 'neutral' && 'bg-muted/50 border-border',
        )}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Analyst Outlook</span>
          </div>
          <p className="text-sm leading-relaxed">{outlook.summary}</p>
        </div>

      </CardContent>
    </Card>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {title}
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{children}</p>
    </div>
  );
}