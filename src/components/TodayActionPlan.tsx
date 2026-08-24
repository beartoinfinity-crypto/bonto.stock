import { useMemo, useState, useRef, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Target,
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
  Shield,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  GitBranch,
  RefreshCw,
  CheckCircle2,
  XCircle,
  BarChart3,
  Activity,
  Gauge,
  ChevronDown,
  ChevronUp,
  History,
} from 'lucide-react';
import { StockData, Signal, calculateSMA, calculateBollingerBands, generateMonteCarloPaths, calculateRSI, calculateMACD } from '@/lib/stockData';
import { getStrategyRecommendations } from '@/lib/strategyRecommendation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage, TranslationKey } from '@/lib/i18n';
import { toast } from 'sonner';

interface TodayActionPlanProps {
  data: StockData[];
  signals: Signal[];
  symbol: string;
  currentPrice?: number;  // real-time quote price (overrides historical last close)
}

interface ConfidenceFactor {
  name: string;
  score: number;      // 0-100
  weight: number;     // weight in final calculation
  description: string;
  positive: boolean;  // whether this factor supports the action
}

interface ActionAdvice {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  confidenceFactors: ConfidenceFactor[];
  headline: string;
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  supportLevel: number;
  resistanceLevel: number;
  reasoning: string[];
  riskReward: string;
  p50ProjectedPrice: number | null;
  p50ProjectedReturn: number | null;
  p50Days: number;
}

interface ConfidenceHistoryPoint {
  date: string;
  confidence: number;
  price: number;
  action: 'BUY' | 'SELL' | 'HOLD';
}

// Simplified confidence calculation for historical points (no Monte Carlo to avoid slowness)
function computeConfidenceOnly(data: StockData[]): { confidence: number; action: 'BUY' | 'SELL' | 'HOLD' } | null {
  if (data.length < 100) return null;

  try {
    const result = getStrategyRecommendations(data);
    const { marketCondition, topPick } = result;
    const latestIdx = data.length - 1;
    const currentPrice = data[latestIdx].close;

    const sma20 = calculateSMA(data, 20);
    const sma50 = calculateSMA(data, 50);
    const { upper, lower } = calculateBollingerBands(data, 20, 2);
    const latestSma20 = sma20[latestIdx] ?? currentPrice;
    const latestSma50 = sma50[latestIdx] ?? currentPrice;
    const latestUpper = upper[latestIdx] ?? currentPrice;
    const latestLower = lower[latestIdx] ?? currentPrice;

    const rsiValues = calculateRSI(data, 14);
    const latestRSI = rsiValues[latestIdx] ?? 50;
    const macdData = calculateMACD(data);
    const latestMACD = macdData.macd[latestIdx] ?? 0;
    const latestMACDSignal = macdData.signal[latestIdx] ?? 0;
    const latestHistogram = macdData.histogram[latestIdx] ?? 0;

    const recentVolume = data.slice(-5).reduce((a, d) => a + d.volume, 0) / 5;
    const avgVolume = data.slice(-20).reduce((a, d) => a + d.volume, 0) / 20;
    const volumeRatio = recentVolume / avgVolume;

    // Determine action based on regime
    let action: 'BUY' | 'SELL' | 'HOLD';
    if (marketCondition.regime === 'uptrend' || marketCondition.regime === 'strong_uptrend') {
      action = 'BUY';
    } else if (marketCondition.regime === 'downtrend' || marketCondition.regime === 'strong_downtrend') {
      action = 'SELL';
    } else {
      action = 'HOLD';
    }

    // Calculate confidence factors (simplified)
    let totalScore = 0;
    let totalWeight = 0;

    // Signal Agreement (25%)
    const trendAligned = (action === 'BUY' && (marketCondition.regime === 'uptrend' || marketCondition.regime === 'strong_uptrend')) ||
                         (action === 'SELL' && (marketCondition.regime === 'downtrend' || marketCondition.regime === 'strong_downtrend'));
    totalScore += (trendAligned ? 85 : 50) * 25;
    totalWeight += 25;

    // Trend (20%)
    totalScore += (trendAligned ? 90 : 50) * 20;
    totalWeight += 20;

    // RSI (15%)
    let rsiScore = 50;
    if (action === 'BUY') {
      rsiScore = latestRSI < 30 ? 95 : latestRSI < 50 ? 75 : latestRSI < 70 ? 50 : 25;
    } else if (action === 'SELL') {
      rsiScore = latestRSI > 70 ? 95 : latestRSI > 50 ? 75 : latestRSI > 30 ? 50 : 25;
    }
    totalScore += rsiScore * 15;
    totalWeight += 15;

    // MACD (15%)
    const macdBullish = latestMACD > latestMACDSignal && latestHistogram > 0;
    const macdBearish = latestMACD < latestMACDSignal && latestHistogram < 0;
    let macdScore = 50;
    if (action === 'BUY') macdScore = macdBullish ? 90 : 30;
    else if (action === 'SELL') macdScore = macdBearish ? 90 : 30;
    totalScore += macdScore * 15;
    totalWeight += 15;

    // Volume (10%)
    const volumeScore = volumeRatio > 1.2 ? 85 : volumeRatio < 0.8 ? 40 : 60;
    totalScore += volumeScore * 10;
    totalWeight += 10;

    // Price Position (10%)
    const bbWidth = latestUpper - latestLower;
    const priceToLower = bbWidth > 0 ? (currentPrice - latestLower) / bbWidth : 0.5;
    let priceScore = 50;
    if (action === 'BUY' && priceToLower < 0.3) priceScore = 85;
    else if (action === 'SELL' && priceToLower > 0.7) priceScore = 85;
    totalScore += priceScore * 10;
    totalWeight += 10;

    // Forecast placeholder (5%) - use neutral since we skip Monte Carlo for speed
    totalScore += 50 * 5;
    totalWeight += 5;

    const confidence = Math.round(totalScore / totalWeight);
    return { confidence: Math.min(100, Math.max(10, confidence)), action };
  } catch {
    return null;
  }
}

// Compute historical confidence for past N trading days
function computeConfidenceHistory(data: StockData[], daysBack: number = 7): ConfidenceHistoryPoint[] {
  const history: ConfidenceHistoryPoint[] = [];
  
  // We need at least 100 + daysBack data points
  if (data.length < 100 + daysBack) {
    // Just compute for available days
    const availableDays = Math.max(0, data.length - 100);
    for (let i = 0; i < availableDays; i++) {
      const slicedData = data.slice(0, data.length - availableDays + i + 1);
      const result = computeConfidenceOnly(slicedData);
      if (result) {
        history.push({
          date: slicedData[slicedData.length - 1].date,
          confidence: result.confidence,
          price: slicedData[slicedData.length - 1].close,
          action: result.action,
        });
      }
    }
    return history;
  }

  for (let i = daysBack; i >= 0; i--) {
    const slicedData = data.slice(0, data.length - i);
    const result = computeConfidenceOnly(slicedData);
    if (result) {
      history.push({
        date: slicedData[slicedData.length - 1].date,
        confidence: result.confidence,
        price: slicedData[slicedData.length - 1].close,
        action: result.action,
      });
    }
  }

  return history;
}

function computeActionAdvice(
  data: StockData[], 
  signals: Signal[],
  symbol: string,
  t: (key: TranslationKey) => string,
  rerollCount: number = 0,
  forecastDays: number = 30,
  forecastPaths: number = 100,
  quotePrice?: number
): ActionAdvice | null {
  if (data.length < 100) return null;

  try {
    const result = getStrategyRecommendations(data);
    const { marketCondition, topPick } = result;
    const latestIdx = data.length - 1;
    const currentPrice = quotePrice ?? data[latestIdx].close;
    const prevClose = data[latestIdx - 1]?.close ?? currentPrice;

    const hashStringToSeed = (str: string) => {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };

    // Generate Monte Carlo forecast for forward-looking insights (seeded to avoid changing every re-render)
    const seed = hashStringToSeed(
      `${symbol}|${data[latestIdx].date}|${currentPrice.toFixed(4)}|${forecastDays}|${forecastPaths}|${rerollCount}`
    );
    const mcResult = generateMonteCarloPaths(data, forecastDays, forecastPaths, { seed });
    const p50FinalPrice = mcResult.p50[mcResult.p50.length - 1];
    const p50Return = ((p50FinalPrice - currentPrice) / currentPrice) * 100;

    // Calculate key levels
    const sma20 = calculateSMA(data, 20);
    const sma50 = calculateSMA(data, 50);
    const { upper, lower } = calculateBollingerBands(data, 20, 2);
    const latestSma20 = sma20[latestIdx] ?? currentPrice;
    const latestSma50 = sma50[latestIdx] ?? currentPrice;
    const latestUpper = upper[latestIdx] ?? currentPrice;
    const latestLower = lower[latestIdx] ?? currentPrice;

    // Find recent swing high/low (last 20 bars)
    const recentData = data.slice(-20);
    const recentHigh = Math.max(...recentData.map(d => d.high));
    const recentLow = Math.min(...recentData.map(d => d.low));

    // Aggregate signal direction
    const buyCount = signals.filter(s => s.type === 'buy').length;
    const sellCount = signals.filter(s => s.type === 'sell').length;
    const buyWeight = signals.filter(s => s.type === 'buy').reduce((a, s) => a + (s.strength === 'strong' ? 3 : s.strength === 'moderate' ? 2 : 1), 0);
    const sellWeight = signals.filter(s => s.type === 'sell').reduce((a, s) => a + (s.strength === 'strong' ? 3 : s.strength === 'moderate' ? 2 : 1), 0);

    // Calculate RSI and MACD for confidence factors
    const rsiValues = calculateRSI(data, 14);
    const latestRSI = rsiValues[latestIdx] ?? 50;
    const macdData = calculateMACD(data);
    const latestMACD = macdData.macd[latestIdx] ?? 0;
    const latestMACDSignal = macdData.signal[latestIdx] ?? 0;
    const latestHistogram = macdData.histogram[latestIdx] ?? 0;

    // Calculate volume trend (average of last 5 days vs last 20 days)
    const recentVolume = data.slice(-5).reduce((a, d) => a + d.volume, 0) / 5;
    const avgVolume = data.slice(-20).reduce((a, d) => a + d.volume, 0) / 20;
    const volumeRatio = recentVolume / avgVolume;

    // Weight forecast into decision
    const forecastBullish = p50Return > 3;
    const forecastBearish = p50Return < -3;

    // Determine base action
    let action: 'BUY' | 'SELL' | 'HOLD';
    const reasoning: string[] = [];

    if (buyWeight > sellWeight + 2 && (marketCondition.regime === 'uptrend' || marketCondition.regime === 'strong_uptrend')) {
      action = 'BUY';
      reasoning.push(t('reasonBuySignalsTrend').replace('{count}', String(buyCount)).replace('{regime}', marketCondition.regime.replace('_', ' ')));
    } else if (sellWeight > buyWeight + 2 && (marketCondition.regime === 'downtrend' || marketCondition.regime === 'strong_downtrend')) {
      action = 'SELL';
      reasoning.push(t('reasonSellSignalsTrend').replace('{count}', String(sellCount)).replace('{regime}', marketCondition.regime.replace('_', ' ')));
    } else if (buyWeight > sellWeight) {
      action = 'BUY';
      reasoning.push(t('reasonBullishBias').replace('{buy}', String(buyCount)).replace('{sell}', String(sellCount)));
    } else if (sellWeight > buyWeight) {
      action = 'SELL';
      reasoning.push(t('reasonBearishBias').replace('{sell}', String(sellCount)).replace('{buy}', String(buyCount)));
    } else if (forecastBullish) {
      action = 'BUY';
      reasoning.push(t('reasonForecastBullish'));
    } else if (forecastBearish) {
      action = 'SELL';
      reasoning.push(t('reasonForecastBearish'));
    } else {
      action = 'HOLD';
      reasoning.push(t('reasonMixed'));
    }

    // ============= MULTI-FACTOR CONFIDENCE CALCULATION =============
    const confidenceFactors: ConfidenceFactor[] = [];

    // Factor 1: Signal Agreement (信號一致性) - Weight: 25%
    const totalSignals = buyCount + sellCount;
    const dominantWeight = Math.max(buyWeight, sellWeight);
    const totalWeight = buyWeight + sellWeight;
    const signalAgreementRatio = totalWeight > 0 ? dominantWeight / totalWeight : 0.5;
    const signalAgreementScore = Math.round(signalAgreementRatio * 100);
    const signalSupportsAction = (action === 'BUY' && buyWeight > sellWeight) || 
                                  (action === 'SELL' && sellWeight > buyWeight) ||
                                  (action === 'HOLD');
    confidenceFactors.push({
      name: t('factorSignalAgreement'),
      score: signalAgreementScore,
      weight: 25,
      description: t('descSignalSupport').replace('{total}', String(totalSignals)).replace('{supported}', String(action === 'BUY' ? buyCount : action === 'SELL' ? sellCount : totalSignals)),
      positive: signalSupportsAction && signalAgreementScore >= 60,
    });

    // Factor 2: Trend Alignment (趨勢對齊) - Weight: 20%
    const trendAligned = (action === 'BUY' && (marketCondition.regime === 'uptrend' || marketCondition.regime === 'strong_uptrend')) ||
                         (action === 'SELL' && (marketCondition.regime === 'downtrend' || marketCondition.regime === 'strong_downtrend')) ||
                         (action === 'HOLD' && marketCondition.regime === 'sideways');
    const trendScore = trendAligned ? 90 : 
                       marketCondition.regime === 'sideways' ? 50 : 30;
    confidenceFactors.push({
      name: t('factorTrendAlignment'),
      score: trendScore,
      weight: 20,
      description: t('descMarketRegime').replace('{regime}', marketCondition.regime.replace('_', ' ')),
      positive: trendAligned,
    });

    // Factor 3: RSI Confirmation (RSI 確認) - Weight: 15%
    let rsiScore: number;
    let rsiDescription: string;
    let rsiPositive: boolean;
    if (action === 'BUY') {
      if (latestRSI < 30) { rsiScore = 95; rsiDescription = t('descRsiOversold').replace('{val}', latestRSI.toFixed(0)); rsiPositive = true; }
      else if (latestRSI < 50) { rsiScore = 75; rsiDescription = t('descRsiLowRoom').replace('{val}', latestRSI.toFixed(0)); rsiPositive = true; }
      else if (latestRSI < 70) { rsiScore = 50; rsiDescription = t('descRsiNeutral').replace('{val}', latestRSI.toFixed(0)); rsiPositive = false; }
      else { rsiScore = 25; rsiDescription = t('descRsiOverboughtRisk').replace('{val}', latestRSI.toFixed(0)); rsiPositive = false; }
    } else if (action === 'SELL') {
      if (latestRSI > 70) { rsiScore = 95; rsiDescription = t('descRsiOverbought').replace('{val}', latestRSI.toFixed(0)); rsiPositive = true; }
      else if (latestRSI > 50) { rsiScore = 75; rsiDescription = t('descRsiHighRoom').replace('{val}', latestRSI.toFixed(0)); rsiPositive = true; }
      else if (latestRSI > 30) { rsiScore = 50; rsiDescription = t('descRsiNeutral').replace('{val}', latestRSI.toFixed(0)); rsiPositive = false; }
      else { rsiScore = 25; rsiDescription = t('descRsiOversoldRisk').replace('{val}', latestRSI.toFixed(0)); rsiPositive = false; }
    } else {
      rsiScore = latestRSI > 30 && latestRSI < 70 ? 70 : 40;
      rsiDescription = latestRSI > 30 && latestRSI < 70 
        ? t('descRsiNeutralHold').replace('{val}', latestRSI.toFixed(0))
        : t('descRsiExtreme').replace('{val}', latestRSI.toFixed(0));
      rsiPositive = latestRSI > 30 && latestRSI < 70;
    }
    confidenceFactors.push({
      name: t('factorRSI'),
      score: rsiScore,
      weight: 15,
      description: rsiDescription,
      positive: rsiPositive,
    });

    // Factor 4: MACD Momentum (MACD 動能) - Weight: 15%
    const macdBullish = latestMACD > latestMACDSignal && latestHistogram > 0;
    const macdBearish = latestMACD < latestMACDSignal && latestHistogram < 0;
    let macdScore: number;
    let macdPositive: boolean;
    if (action === 'BUY') {
      macdScore = macdBullish ? 90 : macdBearish ? 20 : 50;
      macdPositive = macdBullish;
    } else if (action === 'SELL') {
      macdScore = macdBearish ? 90 : macdBullish ? 20 : 50;
      macdPositive = macdBearish;
    } else {
      macdScore = !macdBullish && !macdBearish ? 70 : 40;
      macdPositive = !macdBullish && !macdBearish;
    }
    confidenceFactors.push({
      name: t('factorMACD'),
      score: macdScore,
      weight: 15,
      description: macdBullish ? t('descMacdGoldenCross') : macdBearish ? t('descMacdDeathCross') : t('descMacdNeutral'),
      positive: macdPositive,
    });

    // Factor 5: Volume Confirmation (成交量確認) - Weight: 10%
    const volumeStrong = volumeRatio > 1.2;
    const volumeWeak = volumeRatio < 0.8;
    let volumeScore = volumeStrong ? 85 : volumeWeak ? 40 : 60;
    const volumePositive = volumeStrong;
    confidenceFactors.push({
      name: t('factorVolume'),
      score: volumeScore,
      weight: 10,
      description: volumeStrong ? t('descVolumeUp').replace('{pct}', ((volumeRatio - 1) * 100).toFixed(0)) : 
                   volumeWeak ? t('descVolumeDown').replace('{pct}', ((1 - volumeRatio) * 100).toFixed(0)) : 
                   t('descVolumeNormal'),
      positive: volumePositive,
    });

    // Factor 6: Price Position (價格位置) - Weight: 10%
    const priceToSma20 = (currentPrice - latestSma20) / latestSma20;
    const bbWidth2 = latestUpper - latestLower;
    const priceToLower = bbWidth2 > 0 ? (currentPrice - latestLower) / bbWidth2 : 0.5;
    let priceScore: number;
    let priceDescription: string;
    let pricePositive: boolean;
    if (action === 'BUY') {
      if (currentPrice < latestSma20 && priceToLower < 0.3) {
        priceScore = 85; priceDescription = t('descPriceNearSupport'); pricePositive = true;
      } else if (currentPrice > latestSma20) {
        priceScore = 60; priceDescription = t('descPriceAboveMA'); pricePositive = true;
      } else {
        priceScore = 50; priceDescription = t('descPriceNeutral'); pricePositive = false;
      }
    } else if (action === 'SELL') {
      if (currentPrice > latestSma20 && priceToLower > 0.7) {
        priceScore = 85; priceDescription = t('descPriceNearResistance'); pricePositive = true;
      } else if (currentPrice < latestSma20) {
        priceScore = 60; priceDescription = t('descPriceBelowMA'); pricePositive = true;
      } else {
        priceScore = 50; priceDescription = t('descPriceNeutral'); pricePositive = false;
      }
    } else {
      priceScore = priceToLower > 0.3 && priceToLower < 0.7 ? 70 : 50;
      priceDescription = t('descPriceInRange');
      pricePositive = priceToLower > 0.3 && priceToLower < 0.7;
    }
    confidenceFactors.push({
      name: t('factorPrice'),
      score: priceScore,
      weight: 10,
      description: priceDescription,
      positive: pricePositive,
    });

    // Factor 7: Forecast Alignment (預測對齊) - Weight: 5%
    const forecastAligned = (action === 'BUY' && forecastBullish) ||
                            (action === 'SELL' && forecastBearish) ||
                            (action === 'HOLD' && !forecastBullish && !forecastBearish);
    const forecastScore = forecastAligned ? 90 : 
                          (action === 'HOLD') ? 50 : 30;
    confidenceFactors.push({
      name: t('factorForecast'),
      score: forecastScore,
      weight: 5,
      description: t('descForecastP50').replace('{ret}', `${p50Return > 0 ? '+' : ''}${p50Return.toFixed(1)}`).replace('{days}', String(forecastDays)),
      positive: forecastAligned,
    });

    // Calculate weighted confidence
    const totalWeightedScore = confidenceFactors.reduce((sum, f) => sum + (f.score * f.weight), 0);
    const totalWeights = confidenceFactors.reduce((sum, f) => sum + f.weight, 0);
    const confidence = Math.round(totalWeightedScore / totalWeights);

    // Add strategy context to reasoning
    reasoning.push(`Top strategy: ${topPick.strategy} (${topPick.suitability})`);
    reasoning.push(`RSI at ${marketCondition.rsiValue} — ${marketCondition.momentum} momentum`);
    reasoning.push(`Volatility: ${marketCondition.volatility} (${marketCondition.volatilityPercentile}th percentile)`);
    if (forecastBullish || forecastBearish) {
      reasoning.push(t('reasonP50Confirms').replace('{direction}', forecastBullish ? t('reasonBullishWord') : t('reasonBearishWord')).replace('{ret}', `${p50Return > 0 ? '+' : ''}${p50Return.toFixed(1)}%`));
    }

    // Compute price levels
    let entryPrice: number | null = null;
    let stopLoss: number | null = null;
    let targetPrice: number | null = null;

    if (action === 'BUY') {
      entryPrice = currentPrice;
      stopLoss = Math.max(latestLower, recentLow);
      const risk = currentPrice - stopLoss;
      targetPrice = currentPrice + risk * 2;
      if (p50FinalPrice > targetPrice && p50Return > 5) {
        targetPrice = p50FinalPrice;
      }
      if (targetPrice > recentHigh * 1.05) targetPrice = recentHigh;
    } else if (action === 'SELL') {
      entryPrice = currentPrice;
      stopLoss = Math.min(latestUpper, recentHigh);
      const risk = stopLoss - currentPrice;
      targetPrice = currentPrice - risk * 2;
      if (p50FinalPrice < targetPrice && p50Return < -5) {
        targetPrice = p50FinalPrice;
      }
      if (targetPrice < recentLow * 0.95) targetPrice = recentLow;
    }

    // Risk/reward ratio
    let riskReward = 'N/A';
    if (entryPrice && stopLoss && targetPrice) {
      const risk = Math.abs(entryPrice - stopLoss);
      const reward = Math.abs(targetPrice - entryPrice);
      if (risk > 0) riskReward = `1:${(reward / risk).toFixed(1)}`;
    }

    return {
      action,
      confidence: Math.min(100, Math.max(10, confidence)),
      confidenceFactors,
      headline: action === 'BUY'
        ? t('headlineBuy').replace('${price}', currentPrice.toFixed(2))
        : action === 'SELL'
        ? t('headlineSell').replace('${price}', currentPrice.toFixed(2))
        : t('headlineHold').replace('${price}', currentPrice.toFixed(2)),
      entryPrice,
      stopLoss,
      targetPrice,
      supportLevel: parseFloat(Math.max(latestLower, latestSma50 as number).toFixed(2)),
      resistanceLevel: parseFloat(Math.min(latestUpper, recentHigh).toFixed(2)),
      reasoning,
      riskReward,
      p50ProjectedPrice: p50FinalPrice,
      p50ProjectedReturn: p50Return,
      p50Days: forecastDays,
    };
  } catch {
    return null;
  }
}

const actionStyles = {
  BUY: {
    bg: 'bg-success/10',
    border: 'border-success/40',
    text: 'text-bullish',
    badgeBg: 'bg-success/20 text-bullish border-success/40',
    icon: ArrowUpCircle,
    gradient: 'from-success/20 to-success/5',
  },
  SELL: {
    bg: 'bg-destructive/10',
    border: 'border-destructive/40',
    text: 'text-bearish',
    badgeBg: 'bg-destructive/20 text-bearish border-destructive/40',
    icon: ArrowDownCircle,
    gradient: 'from-destructive/20 to-destructive/5',
  },
  HOLD: {
    bg: 'bg-warning/10',
    border: 'border-warning/40',
    text: 'text-neutral',
    badgeBg: 'bg-warning/20 text-neutral border-warning/40',
    icon: MinusCircle,
    gradient: 'from-warning/20 to-warning/5',
  },
};

type HistoryDaysOption = 7 | 14 | 30;

export function TodayActionPlan({ data, signals, symbol, currentPrice: quotePrice }: TodayActionPlanProps) {
  const { t } = useLanguage();
  const [rerollCount, setRerollCount] = useState(0);
  const [showConfidenceBreakdown, setShowConfidenceBreakdown] = useState(false);
  const [showConfidenceHistory, setShowConfidenceHistory] = useState(false);
  const [historyDays, setHistoryDays] = useState<HistoryDaysOption>(7);
  const advice = useMemo(() => computeActionAdvice(data, signals, symbol, t, rerollCount, 30, 100, quotePrice), [data, signals, symbol, t, rerollCount, quotePrice]);
  
  // Compute confidence history (past N trading days) — all hooks before early return
  const confidenceHistory = useMemo(() => computeConfidenceHistory(data, historyDays), [data, historyDays]);

  const confidenceTrend = useMemo(() => {
    if (confidenceHistory.length < 2) return { direction: 'flat' as const, change: 0 };
    const first = confidenceHistory[0].confidence;
    const last = confidenceHistory[confidenceHistory.length - 1].confidence;
    const change = last - first;
    return {
      direction: change > 2 ? 'up' as const : change < -2 ? 'down' as const : 'flat' as const,
      change,
    };
  }, [confidenceHistory]);

  // Track previous confidence for notifications
  const prevConfidenceRef = useRef<{ confidence: number; action: string; symbol: string } | null>(null);
  const CONFIDENCE_CHANGE_THRESHOLD = 10; // trigger notification when confidence changes by ≥10 points

  useEffect(() => {
    if (!advice) return;
    const prev = prevConfidenceRef.current;
    
    if (prev && prev.symbol === symbol) {
      const delta = advice.confidence - prev.confidence;
      const absDelta = Math.abs(delta);

      // Check for action change
      if (prev.action !== advice.action) {
        toast.info(t('confidenceActionChangeTitle'), {
          description: t('confidenceActionChangeMsg')
            .replace('{symbol}', symbol)
            .replace('{prev}', prev.action)
            .replace('{curr}', advice.action)
            .replace('{pct}', String(advice.confidence)),
          duration: 8000,
        });
      }
      // Check for significant confidence change
      else if (absDelta >= CONFIDENCE_CHANGE_THRESHOLD) {
        if (delta > 0) {
          toast.success(t('confidenceSurgeTitle'), {
            description: t('confidenceSurgeMsg')
              .replace('{symbol}', symbol)
              .replace('{prev}', String(prev.confidence))
              .replace('{curr}', String(advice.confidence))
              .replace('{delta}', String(absDelta)),
            duration: 6000,
          });
        } else {
          toast.warning(t('confidenceDropTitle'), {
            description: t('confidenceDropMsg')
              .replace('{symbol}', symbol)
              .replace('{prev}', String(prev.confidence))
              .replace('{curr}', String(advice.confidence))
              .replace('{delta}', String(delta)),
            duration: 6000,
          });
        }
      }
    }

    prevConfidenceRef.current = { confidence: advice.confidence, action: advice.action, symbol };
  }, [advice?.confidence, advice?.action, symbol, t]);

  if (!advice) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 card-glow">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-5 w-5" />
          <span>{t('insufficientData')}</span>
        </div>
      </div>
    );
  }

  const style = actionStyles[advice.action];
  const ActionIcon = style.icon;
  const currentPrice = quotePrice ?? data[data.length - 1].close;

  const getConfidenceColor = (score: number) => {
    if (score >= 70) return 'text-bullish';
    if (score >= 50) return 'text-warning';
    return 'text-bearish';
  };

  const getConfidenceBgColor = (score: number) => {
    if (score >= 70) return 'bg-success/20';
    if (score >= 50) return 'bg-warning/20';
    return 'bg-destructive/20';
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {t('todayActionPlan')}
          </h3>
          <p className="text-sm text-muted-foreground">{symbol} — {t('synthesizedRec')}</p>
        </div>
        <Badge variant="outline" className={cn("text-sm font-bold px-3 py-1", style.badgeBg)}>
          <ActionIcon className="h-4 w-4 mr-1.5" />
          {advice.action}
        </Badge>
      </div>

      {/* Headline */}
      <div className={cn("p-4 rounded-lg border mb-4 bg-gradient-to-r", style.gradient, style.border)}>
        <p className={cn("font-semibold text-sm", style.text)}>{advice.headline}</p>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t('confidenceIndex')}：</span>
            <span className={cn("text-sm font-bold", getConfidenceColor(advice.confidence))}>
              {advice.confidence}%
            </span>
            {confidenceTrend.direction !== 'flat' && (
              <span className={cn(
                "text-xs flex items-center gap-0.5",
                confidenceTrend.direction === 'up' ? 'text-bullish' : 'text-bearish'
              )}>
                {confidenceTrend.direction === 'up' ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {Math.abs(confidenceTrend.change).toFixed(0)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowConfidenceHistory(!showConfidenceHistory)}
              className={cn(
                "flex items-center gap-1 text-xs transition-colors",
                showConfidenceHistory ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <History className="h-3 w-3" />
              {t('historyBtn')}
            </button>
            <button 
              onClick={() => setShowConfidenceBreakdown(!showConfidenceBreakdown)}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              {showConfidenceBreakdown ? t('collapseBtn') : t('breakdownBtn')}
              {showConfidenceBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* Low Confidence Warning */}
      {advice.confidence < 40 && (
        <div className="mb-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 flex items-start gap-2.5 animate-fade-in">
          <AlertTriangle className="h-4 w-4 text-bearish mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-bearish">{t('lowConfidenceWarning')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('lowConfidenceMsg').replace('{pct}', String(advice.confidence))}
            </p>
          </div>
        </div>
      )}

      {/* Confidence History Chart */}
      {showConfidenceHistory && confidenceHistory.length > 0 && (
        <div className="mb-5 p-4 bg-secondary/30 rounded-lg border border-border animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">{t('confidenceHistory')}</h4>
            </div>
            <div className="flex items-center gap-3">
              {/* Days selector */}
              <div className="flex items-center gap-1 bg-background/50 rounded-md p-0.5">
                {([7, 14, 30] as HistoryDaysOption[]).map((days) => (
                  <button
                    key={days}
                    onClick={() => setHistoryDays(days)}
                    className={cn(
                      "px-2 py-0.5 text-[10px] font-medium rounded transition-colors",
                      historyDays === days
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                  >
                    {days}{t('daysLabel')}
                  </button>
                ))}
              </div>
              {confidenceTrend.direction !== 'flat' && (
                <Badge variant="outline" className={cn(
                  "text-[10px]",
                  confidenceTrend.direction === 'up' ? 'text-bullish border-success/40' : 'text-bearish border-destructive/40'
                )}>
                  {confidenceTrend.direction === 'up' ? '↑' : '↓'} {Math.abs(confidenceTrend.change).toFixed(0)}%
                </Badge>
              )}
            </div>
          </div>
          
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={confidenceHistory} margin={{ top: 5, right: 45, left: -20, bottom: 0 }}>
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis 
                  yAxisId="confidence"
                  domain={[0, 100]} 
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `${value}%`}
                />
                <YAxis 
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: 10, fill: 'hsl(var(--accent-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                  domain={['auto', 'auto']}
                />
                <ReferenceLine yAxisId="confidence" y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine yAxisId="confidence" y={70} stroke="hsl(var(--success))" strokeDasharray="3 3" strokeOpacity={0.3} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'confidence') return [`${value}%`, t('confidenceLegend')];
                    if (name === 'price') return [`$${value.toFixed(2)}`, t('priceLegend')];
                    return [value, name];
                  }}
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  }}
                />
                <Line 
                  yAxisId="confidence"
                  type="monotone" 
                  dataKey="confidence" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, fill: 'hsl(var(--primary))' }}
                />
                <Line 
                  yAxisId="price"
                  type="monotone" 
                  dataKey="price" 
                  stroke="hsl(var(--accent-foreground))" 
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={{ r: 4, fill: 'hsl(var(--accent-foreground))' }}
                  opacity={0.6}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-primary rounded" /> {t('confidenceLegend')}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-accent-foreground/60 rounded" style={{ borderTop: '1.5px dashed' }} /> {t('priceLegend')}
            </span>
          </div>

          {/* Mini action history */}
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground mr-1">{t('operationSuggestion')}：</span>
              {confidenceHistory.map((point, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className={cn(
                    "text-[9px] px-1.5 py-0",
                    point.action === 'BUY' ? 'text-bullish border-success/40' :
                    point.action === 'SELL' ? 'text-bearish border-destructive/40' :
                    'text-neutral border-warning/40'
                  )}
                >
                  {new Date(point.date).getDate()}{t('dayActionLabel')}: {point.action}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Confidence Breakdown */}
      {showConfidenceBreakdown && (
        <div className="mb-5 p-4 bg-secondary/30 rounded-lg border border-border animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">{t('confidenceBreakdown')}</h4>
          </div>
          <div className="space-y-2">
            {advice.confidenceFactors.map((factor, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-shrink-0 w-5">
                  {factor.positive ? (
                    <CheckCircle2 className="h-4 w-4 text-bullish" />
                  ) : (
                    <XCircle className="h-4 w-4 text-bearish" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{factor.name}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">({factor.weight}%)</span>
                      <span className={cn("text-xs font-bold", getConfidenceColor(factor.score))}>
                        {factor.score}
                      </span>
                    </div>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className={cn("h-full rounded-full transition-all", getConfidenceBgColor(factor.score))}
                      style={{ width: `${factor.score}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{factor.description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('weightedTotal')}</span>
            <span className={cn("text-sm font-bold", getConfidenceColor(advice.confidence))}>
              {advice.confidence}%
            </span>
          </div>
        </div>
      )}

      {/* Price Levels Grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {advice.entryPrice && (
          <PriceBox label={t('entryPrice')} value={advice.entryPrice} icon={<DollarSign className="h-3.5 w-3.5" />} />
        )}
        {advice.stopLoss && (
          <PriceBox label={t('stopLoss')} value={advice.stopLoss} icon={<Shield className="h-3.5 w-3.5 text-destructive" />} variant="danger" />
        )}
        {advice.targetPrice && (
          <PriceBox label={t('targetPrice')} value={advice.targetPrice} icon={<TrendingUp className="h-3.5 w-3.5 text-bullish" />} variant="success" />
        )}
        <PriceBox label={t('riskReward')} value={advice.riskReward} isText icon={<Target className="h-3.5 w-3.5 text-primary" />} />
      </div>

      {/* Support & Resistance */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 p-3 bg-success/5 border border-success/20 rounded-lg text-center">
          <div className="text-xs text-muted-foreground mb-1">{t('support')}</div>
          <div className="font-semibold text-bullish">${advice.supportLevel.toFixed(2)}</div>
          <div className="text-xs text-muted-foreground">
            {((1 - advice.supportLevel / currentPrice) * 100).toFixed(1)}% {t('below')}
          </div>
        </div>
        <div className="flex-1 p-3 bg-destructive/5 border border-destructive/20 rounded-lg text-center">
          <div className="text-xs text-muted-foreground mb-1">{t('resistance')}</div>
          <div className="font-semibold text-bearish">${advice.resistanceLevel.toFixed(2)}</div>
          <div className="text-xs text-muted-foreground">
            {((advice.resistanceLevel / currentPrice - 1) * 100).toFixed(1)}% {t('above')}
          </div>
        </div>
      </div>

      {/* Forecast Insight */}
      {advice.p50ProjectedPrice && (
        <div className="mb-5 p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">{t('forecastInsight')}</h4>
            <Badge variant="outline" className="text-xs">{t('p50Median')}</Badge>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setRerollCount(c => c + 1)}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t('reroll')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">{t('projectedPrice')} ({advice.p50Days}d)</div>
              <div className="text-lg font-bold text-foreground">${advice.p50ProjectedPrice.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('expectedReturn')}</div>
              <div className={cn(
                "text-lg font-bold",
                advice.p50ProjectedReturn! > 0 ? "text-bullish" : advice.p50ProjectedReturn! < 0 ? "text-bearish" : "text-muted-foreground"
              )}>
                {advice.p50ProjectedReturn! > 0 ? '+' : ''}{advice.p50ProjectedReturn!.toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {t('monteCarloBasis').replace('{days}', String(advice.p50Days))}
          </p>
        </div>
      )}

      {/* Reasoning */}
      <div className="mb-4">
        <h4 className="text-sm font-medium mb-2 text-muted-foreground">{t('whyAction')}</h4>
        <ul className="space-y-1.5">
          {advice.reasoning.map((r, i) => (
            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Disclaimer */}
      <div className="p-3 bg-secondary/30 rounded-lg flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          {t('disclaimer')}
        </p>
      </div>
    </div>
  );
}

function PriceBox({
  label,
  value,
  icon,
  variant,
  isText,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  variant?: 'danger' | 'success';
  isText?: boolean;
}) {
  return (
    <div className="p-3 bg-secondary/30 rounded-lg">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={cn(
        "font-bold text-lg",
        variant === 'danger' ? 'text-bearish' :
        variant === 'success' ? 'text-bullish' :
        'text-foreground'
      )}>
        {isText ? value : `$${(value as number).toFixed(2)}`}
      </div>
    </div>
  );
}
