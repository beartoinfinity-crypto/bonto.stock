import { StockData } from './stockData';
import { MarketCondition } from './strategyRecommendation';

export interface LiquidityIndicator {
  name: string;
  value: number;
  displayValue: string;
  warningThreshold: string;
  isWarning: boolean;
  severity: 'normal' | 'warning' | 'critical';
  description: string;
  hint: string;
}

export type LiquidityRating = 'abundant' | 'normal' | 'tightening' | 'critical';

export interface LiquidityResult {
  indicators: LiquidityIndicator[];
  warningCount: number;
  rating: LiquidityRating;
  ratingLabel: string;
  actionAdvice: string;
  liquidityScore: number; // 0-100, higher = more liquidity
  synthesis: string;
}

export function calculateLiquidityConditions(
  data: StockData[],
  condition: MarketCondition
): LiquidityResult {
  const { regimeScore, volatilityPercentile, momentum, rsiValue, trendStrength, priceVsSma, bandwidthPercentile } = condition;

  const regimeNorm = (regimeScore + 100) / 200; // 0-1

  // === 1. Net Liquidity (Fed Total Assets - TGA - ON RRP) ===
  // Simulate in trillions. Base ~3.5T, adjusted by regime and trend
  const fedAssets = 7.5 - (1 - regimeNorm) * 1.2; // ~6.3-7.5T
  const tga = 0.6 + (volatilityPercentile / 100) * 0.4; // ~0.6-1.0T
  const onRrp = 0.3 + (1 - regimeNorm) * 1.5; // ~0.3-1.8T (falls when liquidity abundant)
  const netLiquidity = fedAssets - tga - onRrp;
  const netLiquidityT = Math.max(3.0, Math.min(6.5, netLiquidity));

  // Week-over-week change proxy: use recent price momentum
  const recent5 = data.slice(-5);
  const prev5 = data.slice(-10, -5);
  const recentAvg = recent5.reduce((s, d) => s + d.close, 0) / (recent5.length || 1);
  const prevAvg = prev5.length > 0 ? prev5.reduce((s, d) => s + d.close, 0) / prev5.length : recentAvg;
  const weeklyChange = ((recentAvg - prevAvg) / (prevAvg || 1)) * 100;
  // Map stock weekly change to liquidity weekly change (amplified)
  const liquidityWeeklyChange = weeklyChange * 1.5 - (volatilityPercentile > 70 ? 3 : 0);
  const netLiqWarning = liquidityWeeklyChange < -5;

  // === 2. SOFR (Secured Overnight Financing Rate) ===
  // Base around 5.0-5.5%, higher when volatility high / regime weak
  const sofrBase = 5.0 + (volatilityPercentile / 100) * 0.8 - regimeNorm * 0.3;
  const sofrValue = Math.max(4.5, Math.min(6.0, sofrBase));
  const sofrWarning = sofrValue > 5.5;

  // === 3. MOVE Index (Bond Volatility) ===
  // Scale 60-200, correlated with volatility percentile + bandwidth
  const moveBase = 80 + volatilityPercentile * 0.8 + bandwidthPercentile * 0.3 - regimeNorm * 20;
  const moveValue = Math.max(60, Math.min(200, moveBase));
  const moveWarning = moveValue > 130;

  // === 4. USDJPY + US2Y-JP2Y Spread ===
  // USDJPY: 130-160 range, higher when US rates high
  const usdjpyBase = 145 + (sofrValue - 5.0) * 10 + (regimeNorm - 0.5) * 5;
  const usdjpyValue = Math.max(130, Math.min(160, usdjpyBase));
  // US2Y-JP2Y spread: 3-5%, higher = more carry trade risk
  const spreadBase = 3.5 + (sofrValue - 5.0) * 1.5 + (1 - regimeNorm) * 0.5;
  const rateSpread = Math.max(2.5, Math.min(5.5, spreadBase));
  // Warning when USDJPY > 155 AND spread widening (carry trade unwind risk)
  const fxWarning = usdjpyValue > 155 && rateSpread > 4.0;

  const indicators: LiquidityIndicator[] = [
    {
      name: 'Funding Pressure Estimate',
      value: netLiquidityT,
      displayValue: `$${netLiquidityT.toFixed(2)}T`,
      warningThreshold: 'Weekly drop > 5%',
      isWarning: netLiqWarning,
      severity: netLiqWarning && liquidityWeeklyChange < -8 ? 'critical' : netLiqWarning ? 'warning' : 'normal',
      description: `Derived from price momentum proxy | Weekly: ${liquidityWeeklyChange >= 0 ? '+' : ''}${liquidityWeeklyChange.toFixed(1)}%`,
      hint: netLiqWarning
        ? `Funding pressure estimate dropped ${Math.abs(liquidityWeeklyChange).toFixed(1)}% this week. When liquidity contracts rapidly, risk assets typically sell off within 1-3 weeks. Monitor Fed statements for intervention signals.`
        : netLiquidityT > 5.5
        ? 'Funding conditions appear loose — price momentum suggests ample market liquidity. Favorable for risk-taking.'
        : 'Funding pressure is neutral — no extreme signal detected from price action.',
    },
    {
      name: 'Short-Term Funding Stress',
      value: sofrValue,
      displayValue: `${sofrValue.toFixed(2)}%`,
      warningThreshold: '> 5.50% suggests stress',
      isWarning: sofrWarning,
      severity: sofrValue > 5.8 ? 'critical' : sofrWarning ? 'warning' : 'normal',
      description: 'Estimated from volatility regime — proxy for overnight funding cost',
      hint: sofrValue > 5.5
        ? `Estimated funding stress at ${sofrValue.toFixed(2)}% — elevated volatility regimes historically correlate with tighter credit conditions. Watch for 2-3 quarter lag before real economic impact.`
        : sofrValue < 4.8
        ? 'Low estimated funding stress — volatility regime suggests accommodative conditions.'
        : 'Estimated funding stress is moderate — no extreme signal.',
    },
    {
      name: 'Bond Volatility Proxy',
      value: moveValue,
      displayValue: moveValue.toFixed(0),
      warningThreshold: '> 130 suggests stress',
      isWarning: moveWarning,
      severity: moveValue > 160 ? 'critical' : moveWarning ? 'warning' : 'normal',
      description: 'Derived from stock volatility + bandwidth — proxy for bond market stress',
      hint: moveValue > 130
        ? `Bond volatility proxy at ${moveValue.toFixed(0)} — elevated readings historically precede stock volatility by 1-2 weeks. When bonds are unstable, equities follow. Risk-off positioning warranted.`
        : moveValue < 80
        ? 'Bond volatility proxy is compressed — market may be underpricing rate risk. Low readings have preceded surprise rate moves.'
        : 'Bond volatility proxy is normal — no stress signal from price action.',
    },
    {
      name: 'FX Risk Estimate',
      value: usdjpyValue,
      displayValue: `\u00A5${usdjpyValue.toFixed(1)} / ${rateSpread.toFixed(1)}%`,
      warningThreshold: 'High estimate + wide spread',
      isWarning: fxWarning,
      severity: fxWarning && usdjpyValue > 158 ? 'critical' : fxWarning ? 'warning' : 'normal',
      description: 'Yen estimate from rate proxy — carry trade risk indicator',
      hint: fxWarning
        ? `Estimated FX risk elevated — rate proxy suggests wide US-Japan spread. Overcrowded carry trades have triggered global deleveraging events (e.g. Aug 2024 yen unwind). Monitor for sudden reversals.`
        : rateSpread > 4.0
        ? 'Rate proxy suggests wide spread — carry trade is attractive but watch for BoJ policy signals that could trigger unwind.'
        : 'FX risk estimate is low — rate proxy suggests manageable conditions.',
    },
  ];

  const warningCount = indicators.filter(i => i.isWarning).length;
  const criticalCount = indicators.filter(i => i.severity === 'critical').length;

  // Liquidity score: higher = more liquid / safer
  const liquidityScore = Math.min(100, Math.max(0,
    ((netLiquidityT - 3.0) / 3.5) * 30 +
    ((6.0 - sofrValue) / 1.5) * 25 +
    ((200 - moveValue) / 140) * 25 +
    (fxWarning ? 0 : 20)
  ));

  let rating: LiquidityRating;
  let ratingLabel: string;
  let actionAdvice: string;

  if (criticalCount >= 2 || warningCount >= 4) {
    rating = 'critical';
    ratingLabel = 'Liquidity Crisis';
    actionAdvice = 'Reduce to 30% immediately, activate risk asset stop-loss';
  } else if (warningCount >= 2) {
    rating = 'tightening';
    ratingLabel = 'Liquidity Tightening';
    actionAdvice = 'Reduce to 50-70%, avoid leverage, increase cash';
  } else if (warningCount === 1) {
    rating = 'normal';
    ratingLabel = 'Normal Liquidity';
    actionAdvice = 'Maintain positions, monitor warning indicators';
  } else {
    rating = 'abundant';
    ratingLabel = 'Abundant Liquidity';
    actionAdvice = 'Favorable liquidity, maintain or适度 increase risk positions';
  }

  return {
    indicators,
    warningCount,
    rating,
    ratingLabel,
    actionAdvice,
    liquidityScore,
    synthesis: `Liquidity proxy estimate: ${ratingLabel} (${warningCount}/4 indicators triggered). ${actionAdvice}. Note: These are synthetic estimates derived from price action, not real macro data.`,
  };
}
