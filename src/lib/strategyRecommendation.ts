// Strategy Recommendation Engine
// Analyzes current market conditions and recommends optimal trading strategies

import { StockData, calculateSMA, calculateRSI, calculateMACD, calculateBollingerBands, calculateEMA } from './stockData';

export type MarketRegime = 'strong_uptrend' | 'uptrend' | 'sideways' | 'downtrend' | 'strong_downtrend';
export type VolatilityLevel = 'low' | 'medium' | 'high' | 'extreme';
export type MomentumState = 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold';

export interface MarketCondition {
  regime: MarketRegime;
  regimeScore: number; // -100 to 100
  volatility: VolatilityLevel;
  volatilityPercentile: number; // 0-100
  momentum: MomentumState;
  rsiValue: number;
  trendStrength: number; // 0-100
  priceVsSma: number; // percentage above/below 50 SMA
  bandwidthPercentile: number; // Bollinger bandwidth percentile
}

export interface StrategyRecommendation {
  strategy: string;
  confidence: number; // 0-100
  suitability: 'excellent' | 'good' | 'moderate' | 'poor';
  reasoning: string[];
  actionItems: string[];
  riskLevel: 'low' | 'medium' | 'high';
  action?: 'BUY' | 'SELL' | 'HOLD'; // Explicit action derived from market conditions
}

export interface RecommendationResult {
  marketCondition: MarketCondition;
  recommendations: StrategyRecommendation[];
  topPick: StrategyRecommendation;
  summary: string;
}

/**
 * Analyze market conditions from price data
 */
export function analyzeMarketConditions(data: StockData[]): MarketCondition {
  if (data.length < 100) {
    throw new Error('Insufficient data for market analysis (need at least 100 data points)');
  }

  const latestIdx = data.length - 1;
  const currentPrice = data[latestIdx].close;

  // Calculate indicators
  const sma20 = calculateSMA(data, 20);
  const sma50 = calculateSMA(data, 50);
  const sma200 = calculateSMA(data, 200);
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const rsi = calculateRSI(data, 14);
  const { macd, signal } = calculateMACD(data);
  const { upper, middle, lower } = calculateBollingerBands(data, 20, 2);

  // Get latest values
  const latestSma20 = sma20[latestIdx] ?? currentPrice;
  const latestSma50 = sma50[latestIdx] ?? currentPrice;
  const latestSma200 = sma200[latestIdx] ?? currentPrice;
  const latestRsi = rsi[latestIdx] ?? 50;
  const latestMacd = macd[latestIdx] ?? 0;
  const latestSignal = signal[latestIdx] ?? 0;
  const latestUpper = upper[latestIdx] ?? currentPrice;
  const latestLower = lower[latestIdx] ?? currentPrice;
  const latestMiddle = middle[latestIdx] ?? currentPrice;

  // === TREND ANALYSIS ===
  // Calculate trend regime score (-100 to 100)
  let regimeScore = 0;

  // Price vs moving averages (weighted)
  if (currentPrice > latestSma20) regimeScore += 15;
  else regimeScore -= 15;
  
  if (currentPrice > latestSma50) regimeScore += 20;
  else regimeScore -= 20;
  
  if (currentPrice > latestSma200) regimeScore += 25;
  else regimeScore -= 25;

  // MA alignment (golden/death cross)
  if (latestSma20 > latestSma50) regimeScore += 15;
  else regimeScore -= 15;
  
  if (latestSma50 > latestSma200) regimeScore += 15;
  else regimeScore -= 15;

  // MACD confirmation
  if (latestMacd > latestSignal) regimeScore += 10;
  else regimeScore -= 10;

  // Determine regime
  let regime: MarketRegime;
  if (regimeScore >= 60) regime = 'strong_uptrend';
  else if (regimeScore >= 20) regime = 'uptrend';
  else if (regimeScore >= -20) regime = 'sideways';
  else if (regimeScore >= -60) regime = 'downtrend';
  else regime = 'strong_downtrend';

  // === VOLATILITY ANALYSIS ===
  // Calculate Bollinger Band width as percentage
  const bandwidth = ((latestUpper - latestLower) / latestMiddle) * 100;
  
  // Calculate historical bandwidth for percentile
  const historicalBandwidths: number[] = [];
  for (let i = Math.max(0, latestIdx - 252); i <= latestIdx; i++) {
    if (upper[i] && lower[i] && middle[i]) {
      historicalBandwidths.push(((upper[i]! - lower[i]!) / middle[i]!) * 100);
    }
  }
  
  const sortedBandwidths = [...historicalBandwidths].sort((a, b) => a - b);
  const bandwidthPercentile = (sortedBandwidths.indexOf(
    sortedBandwidths.find(b => b >= bandwidth) || bandwidth
  ) / sortedBandwidths.length) * 100;

  // Calculate ATR-like volatility
  const returns = data.slice(-20).map((d, i, arr) => 
    i > 0 ? Math.abs((d.close - arr[i-1].close) / arr[i-1].close) * 100 : 0
  ).slice(1);
  const avgVolatility = returns.reduce((a, b) => a + b, 0) / returns.length;

  let volatility: VolatilityLevel;
  let volatilityPercentile = bandwidthPercentile;
  
  if (avgVolatility > 3 || bandwidthPercentile > 90) {
    volatility = 'extreme';
    volatilityPercentile = Math.max(volatilityPercentile, 90);
  } else if (avgVolatility > 2 || bandwidthPercentile > 70) {
    volatility = 'high';
  } else if (avgVolatility > 1 || bandwidthPercentile > 30) {
    volatility = 'medium';
  } else {
    volatility = 'low';
  }

  // === MOMENTUM ANALYSIS ===
  let momentum: MomentumState;
  if (latestRsi >= 80) momentum = 'overbought';
  else if (latestRsi >= 60) momentum = 'bullish';
  else if (latestRsi >= 40) momentum = 'neutral';
  else if (latestRsi >= 20) momentum = 'bearish';
  else momentum = 'oversold';

  // === TREND STRENGTH ===
  // ADX-like calculation (simplified)
  const trendStrength = Math.min(100, Math.abs(regimeScore));

  // Price vs 50 SMA percentage
  const priceVsSma = ((currentPrice - latestSma50) / latestSma50) * 100;

  return {
    regime,
    regimeScore: Math.round(regimeScore),
    volatility,
    volatilityPercentile: Math.round(volatilityPercentile),
    momentum,
    rsiValue: Math.round(latestRsi),
    trendStrength: Math.round(trendStrength),
    priceVsSma: parseFloat(priceVsSma.toFixed(2)),
    bandwidthPercentile: Math.round(bandwidthPercentile),
  };
}

/**
 * Generate strategy recommendations based on market conditions
 */
export function generateStrategyRecommendations(conditions: MarketCondition): StrategyRecommendation[] {
  const recommendations: StrategyRecommendation[] = [];

  // === MA CROSSOVER STRATEGY ===
  const maStrategy = evaluateMACrossover(conditions);
  recommendations.push(maStrategy);

  // === RSI REVERSAL STRATEGY ===
  const rsiStrategy = evaluateRSIReversal(conditions);
  recommendations.push(rsiStrategy);

  // === MACD CROSSOVER STRATEGY ===
  const macdStrategy = evaluateMACDCrossover(conditions);
  recommendations.push(macdStrategy);

  // === BOLLINGER BREAKOUT STRATEGY ===
  const bollingerStrategy = evaluateBollingerBreakout(conditions);
  recommendations.push(bollingerStrategy);

  // === COMBINED SIGNAL STRATEGY ===
  const combinedStrategy = evaluateCombinedSignal(conditions, recommendations);
  recommendations.push(combinedStrategy);

  // Sort by confidence
  return recommendations.sort((a, b) => b.confidence - a.confidence);
}

function evaluateMACrossover(c: MarketCondition): StrategyRecommendation {
  let confidence = 50;
  const reasoning: string[] = [];
  const actionItems: string[] = [];

  // Best in trending markets
  if (c.regime === 'strong_uptrend' || c.regime === 'strong_downtrend') {
    confidence += 25;
    reasoning.push('Strong trend detected - ideal for trend-following strategies');
  } else if (c.regime === 'uptrend' || c.regime === 'downtrend') {
    confidence += 15;
    reasoning.push('Clear directional trend supports MA crossover signals');
  } else {
    confidence -= 20;
    reasoning.push('Sideways market may generate false crossover signals');
  }

  // High trend strength is good
  if (c.trendStrength > 60) {
    confidence += 10;
    reasoning.push(`Strong trend strength (${c.trendStrength}%) confirms directional bias`);
  }

  // Low-medium volatility preferred
  if (c.volatility === 'medium') {
    confidence += 5;
    reasoning.push('Moderate volatility provides clean crossover signals');
  } else if (c.volatility === 'extreme') {
    confidence -= 15;
    reasoning.push('Extreme volatility may cause whipsaw trades');
  }

  // Action items based on regime
  if (c.regime === 'strong_uptrend' || c.regime === 'uptrend') {
    actionItems.push('Look for pullbacks to 20-day SMA as entry points');
    actionItems.push('Wait for 20 SMA to cross above 50 SMA for confirmation');
    actionItems.push('Set stop-loss below the 50-day SMA');
  } else if (c.regime === 'strong_downtrend' || c.regime === 'downtrend') {
    actionItems.push('Consider short positions or avoid long entries');
    actionItems.push('Wait for death cross (20 below 50 SMA) to confirm shorts');
    actionItems.push('Use rallies to 20-day SMA as exit points');
  } else {
    actionItems.push('Avoid trading until clear trend emerges');
    actionItems.push('Watch for breakout from consolidation range');
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    strategy: 'MA Crossover',
    confidence,
    suitability: getSuitability(confidence),
    reasoning,
    actionItems,
    riskLevel: c.volatility === 'extreme' || c.volatility === 'high' ? 'high' : 'medium',
  };
}

function evaluateRSIReversal(c: MarketCondition): StrategyRecommendation {
  let confidence = 50;
  const reasoning: string[] = [];
  const actionItems: string[] = [];

  // Best in sideways/ranging markets
  if (c.regime === 'sideways') {
    confidence += 25;
    reasoning.push('Range-bound market is ideal for RSI mean-reversion');
  } else if (c.regime === 'strong_uptrend' || c.regime === 'strong_downtrend') {
    confidence -= 15;
    reasoning.push('Strong trends may keep RSI overbought/oversold longer');
  }

  // RSI at extremes
  if (c.momentum === 'overbought' || c.momentum === 'oversold') {
    confidence += 20;
    reasoning.push(`RSI at ${c.rsiValue} indicates potential reversal zone`);
  } else if (c.momentum === 'neutral') {
    confidence -= 10;
    reasoning.push('RSI in neutral zone - no clear reversal setup');
  }

  // Low volatility improves reliability
  if (c.volatility === 'low' || c.volatility === 'medium') {
    confidence += 10;
    reasoning.push('Stable volatility supports reliable RSI signals');
  } else if (c.volatility === 'extreme') {
    confidence -= 10;
    reasoning.push('High volatility may produce false RSI extremes');
  }

  // Action items
  if (c.momentum === 'oversold') {
    actionItems.push(`RSI at ${c.rsiValue} - watch for bullish divergence`);
    actionItems.push('Enter long when RSI crosses back above 30');
    actionItems.push('Set stop-loss below recent swing low');
    actionItems.push('Target first resistance level or RSI reaching 50');
  } else if (c.momentum === 'overbought') {
    actionItems.push(`RSI at ${c.rsiValue} - watch for bearish divergence`);
    actionItems.push('Consider taking profits on existing longs');
    actionItems.push('Enter short when RSI crosses back below 70');
    actionItems.push('Use trailing stops to protect gains');
  } else {
    actionItems.push('Wait for RSI to reach 30 or 70 for clear setup');
    actionItems.push('Monitor for divergence between price and RSI');
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    strategy: 'RSI Reversal',
    confidence,
    suitability: getSuitability(confidence),
    reasoning,
    actionItems,
    riskLevel: 'medium',
  };
}

function evaluateMACDCrossover(c: MarketCondition): StrategyRecommendation {
  let confidence = 50;
  const reasoning: string[] = [];
  const actionItems: string[] = [];

  // Works in trending and transitioning markets
  if (c.regime === 'uptrend' || c.regime === 'downtrend') {
    confidence += 20;
    reasoning.push('Moderate trend supports MACD momentum signals');
  } else if (c.regime === 'sideways') {
    confidence -= 10;
    reasoning.push('Sideways action may produce choppy MACD signals');
  }

  // Good with momentum confirmation
  if (c.momentum === 'bullish' && (c.regime === 'uptrend' || c.regime === 'strong_uptrend')) {
    confidence += 15;
    reasoning.push('Bullish momentum aligns with uptrend for strong MACD signals');
  } else if (c.momentum === 'bearish' && (c.regime === 'downtrend' || c.regime === 'strong_downtrend')) {
    confidence += 15;
    reasoning.push('Bearish momentum aligns with downtrend for short signals');
  }

  // Medium volatility is ideal
  if (c.volatility === 'medium' || c.volatility === 'high') {
    confidence += 5;
    reasoning.push('Adequate volatility for meaningful MACD movements');
  } else if (c.volatility === 'low') {
    confidence -= 5;
    reasoning.push('Low volatility may produce weak MACD signals');
  }

  // Action items
  if (c.regime === 'uptrend' || c.regime === 'strong_uptrend') {
    actionItems.push('Wait for MACD line to cross above signal line');
    actionItems.push('Confirm with histogram turning positive');
    actionItems.push('Enter on next bar after crossover confirmation');
    actionItems.push('Exit when MACD crosses below signal or histogram flips');
  } else if (c.regime === 'downtrend' || c.regime === 'strong_downtrend') {
    actionItems.push('Look for MACD line crossing below signal line');
    actionItems.push('Use as exit signal for long positions');
    actionItems.push('Consider short entries on bearish crossovers');
  } else {
    actionItems.push('Wait for MACD histogram to expand significantly');
    actionItems.push('Crossover near zero line often signals trend start');
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    strategy: 'MACD Crossover',
    confidence,
    suitability: getSuitability(confidence),
    reasoning,
    actionItems,
    riskLevel: 'medium',
  };
}

function evaluateBollingerBreakout(c: MarketCondition): StrategyRecommendation {
  let confidence = 50;
  const reasoning: string[] = [];
  const actionItems: string[] = [];

  // Best when volatility is contracting (squeeze setup)
  if (c.volatility === 'low' && c.bandwidthPercentile < 30) {
    confidence += 30;
    reasoning.push('Bollinger Band squeeze detected - breakout potential is high');
  } else if (c.volatility === 'medium' && c.bandwidthPercentile < 50) {
    confidence += 15;
    reasoning.push('Narrowing bands suggest upcoming volatility expansion');
  } else if (c.volatility === 'extreme') {
    confidence -= 20;
    reasoning.push('Bands already expanded - breakout may be exhausted');
  }

  // Works in transitioning markets
  if (c.regime === 'sideways') {
    confidence += 10;
    reasoning.push('Consolidation often precedes significant breakouts');
  } else if (c.trendStrength > 70) {
    confidence -= 10;
    reasoning.push('Strong existing trend may limit breakout potential');
  }

  // Higher risk/reward strategy
  const riskLevel: 'low' | 'medium' | 'high' = c.volatility === 'extreme' ? 'high' : 
                                                 c.volatility === 'high' ? 'high' : 'medium';

  // Action items
  if (c.bandwidthPercentile < 30) {
    actionItems.push('Bollinger squeeze active - prepare for breakout');
    actionItems.push('Set alerts at upper and lower band levels');
    actionItems.push('Enter in direction of breakout with volume confirmation');
    actionItems.push('Use opposite band as initial stop-loss');
  } else if (c.priceVsSma > 0) {
    actionItems.push('Price above middle band - bias is bullish');
    actionItems.push('Watch for close above upper band as breakout signal');
    actionItems.push('Trail stop using middle band (20 SMA)');
  } else {
    actionItems.push('Price below middle band - bias is bearish');
    actionItems.push('Watch for close below lower band for breakdown');
    actionItems.push('Be cautious of false breakouts in low volume');
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    strategy: 'Bollinger Breakout',
    confidence,
    suitability: getSuitability(confidence),
    reasoning,
    actionItems,
    riskLevel,
  };
}

function evaluateCombinedSignal(c: MarketCondition, others: StrategyRecommendation[]): StrategyRecommendation {
  // Combined signal works when multiple strategies align
  const highConfidenceStrategies = others.filter(s => s.confidence >= 60);
  const alignedStrategies = highConfidenceStrategies.length;

  let confidence = 40 + (alignedStrategies * 15);
  const reasoning: string[] = [];
  const actionItems: string[] = [];

  if (alignedStrategies >= 3) {
    confidence += 10;
    reasoning.push(`${alignedStrategies} strategies show high confidence - strong consensus`);
  } else if (alignedStrategies >= 2) {
    reasoning.push(`${alignedStrategies} strategies align - moderate consensus`);
  } else if (alignedStrategies === 1) {
    confidence -= 10;
    reasoning.push('Only one strategy shows high confidence - wait for more confirmation');
  } else {
    confidence -= 20;
    reasoning.push('No clear strategy consensus - mixed signals');
  }

  // Clear market conditions boost combined signal
  if (c.regime !== 'sideways' && c.trendStrength > 50) {
    confidence += 10;
    reasoning.push('Clear trend direction supports combined signal approach');
  }

  // Conservative strategy = lower risk
  const riskLevel: 'low' | 'medium' | 'high' = confidence >= 70 ? 'low' : 
                                                confidence >= 50 ? 'medium' : 'high';

  // Derive explicit action from market regime + momentum
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (c.regime === 'strong_uptrend' || c.regime === 'uptrend') {
    if (c.momentum === 'overbought') {
      action = 'HOLD'; // Uptrend but overbought, risky to enter
    } else if (c.momentum !== 'bearish' && c.momentum !== 'oversold') {
      action = 'BUY';
    } else {
      action = 'HOLD';
    }
  } else if (c.regime === 'strong_downtrend' || c.regime === 'downtrend') {
    if (c.momentum === 'oversold') {
      action = 'HOLD'; // Downtrend but oversold, potential bounce
    } else if (c.momentum !== 'bullish' && c.momentum !== 'overbought') {
      action = 'SELL';
    } else {
      action = 'HOLD';
    }
  } else {
    // Sideways - use momentum
    if (c.momentum === 'bullish' && c.rsiValue > 55) {
      action = 'BUY';
    } else if (c.momentum === 'bearish' && c.rsiValue < 45) {
      action = 'SELL';
    } else {
      action = 'HOLD';
    }
  }

  // Low confidence overrides to HOLD
  if (confidence < 40 && alignedStrategies < 2) {
    action = 'HOLD';
  }

  // Action items based on derived action
  if (alignedStrategies >= 2) {
    const topStrategies = highConfidenceStrategies.slice(0, 2).map(s => s.strategy);
    actionItems.push(`Primary signals: ${topStrategies.join(' + ')}`);
    if (action === 'BUY') {
      actionItems.push('Consider entering long position on pullback');
      actionItems.push('Use tighter position sizing for higher confidence');
    } else if (action === 'SELL') {
      actionItems.push('Consider reducing or exiting positions');
      actionItems.push('Watch for support breakdown confirmation');
    } else {
      actionItems.push('Wait for all indicators to align before entry');
      actionItems.push('Use tighter position sizing for higher confidence');
    }
    actionItems.push('Set stop-loss based on the most conservative strategy');
  } else {
    if (action === 'HOLD') {
      actionItems.push('Wait for multiple strategies to confirm same direction');
      actionItems.push('Avoid forced entries when signals conflict');
      actionItems.push('Consider staying in cash until clearer setup emerges');
    } else {
      actionItems.push('Signal direction is tentative with low consensus');
      actionItems.push('Use smaller position size due to limited confirmation');
      actionItems.push('Set tight stop-loss to manage risk');
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    strategy: 'Combined Signal',
    confidence,
    suitability: getSuitability(confidence),
    reasoning,
    actionItems,
    riskLevel,
    action,
  };
}

function getSuitability(confidence: number): 'excellent' | 'good' | 'moderate' | 'poor' {
  if (confidence >= 75) return 'excellent';
  if (confidence >= 60) return 'good';
  if (confidence >= 40) return 'moderate';
  return 'poor';
}

/**
 * Main function to get complete strategy recommendations
 */
export function getStrategyRecommendations(data: StockData[]): RecommendationResult {
  const marketCondition = analyzeMarketConditions(data);
  const recommendations = generateStrategyRecommendations(marketCondition);
  const topPick = recommendations[0];

  // Generate summary
  const regimeText = {
    'strong_uptrend': 'a strong uptrend',
    'uptrend': 'an uptrend',
    'sideways': 'a sideways consolidation',
    'downtrend': 'a downtrend',
    'strong_downtrend': 'a strong downtrend',
  }[marketCondition.regime];

  const volatilityText = {
    'low': 'low',
    'medium': 'moderate',
    'high': 'elevated',
    'extreme': 'extremely high',
  }[marketCondition.volatility];

  const summary = `Market is in ${regimeText} with ${volatilityText} volatility. ` +
    `RSI at ${marketCondition.rsiValue} indicates ${marketCondition.momentum} momentum. ` +
    `${topPick.strategy} is recommended with ${topPick.confidence}% confidence.`;

  return {
    marketCondition,
    recommendations,
    topPick,
    summary,
  };
}
