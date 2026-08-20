import { StockData } from './stockData';
import { MarketCondition } from './strategyRecommendation';

export interface SentimentIndicator {
  name: string;
  value: number;
  displayValue: string;
  warningThreshold: string;
  isWarning: boolean;
  description: string;
  hint: string;
}

export type SentimentRating = 'extreme_greed' | 'greed' | 'neutral' | 'fear';

export interface SentimentResult {
  indicators: SentimentIndicator[];
  warningCount: number;
  rating: SentimentRating;
  ratingLabel: string;
  positionAdvice: string;
  greedScore: number; // 0-100, higher = more greedy
  synthesis: string;
}

export function calculateMarketSentiment(
  data: StockData[],
  condition: MarketCondition
): SentimentResult {
  const { regimeScore, volatilityPercentile, momentum, rsiValue, trendStrength, priceVsSma, bandwidthPercentile } = condition;

  // Normalize regimeScore from [-100,100] to [0,1]
  const regimeNorm = (regimeScore + 100) / 200;

  // === 1. NAAIM Exposure Index (0-200 scale) ===
  // Higher regime + trend strength → higher exposure
  const naaimRaw = regimeNorm * 120 + (trendStrength / 100) * 80;
  const naaimValue = Math.max(0, Math.min(200, naaimRaw));
  const naaimMedian = naaimValue * 0.85 + 15; // simulated median
  const naaimWarning = naaimValue > 80 && naaimMedian >= 95;

  // === 2. Institutional Equity Allocation (%) ===
  // Price vs 200 SMA + regime → allocation %
  const allocBase = 50 + priceVsSma * 1.5 + regimeScore * 0.15;
  const allocValue = Math.max(30, Math.min(75, allocBase));
  // Historical extreme since 2007 is ~65%
  const allocWarning = allocValue > 63;

  // === 3. Retail Net Buying (percentile 0-100) ===
  // Volume trend + momentum proxy
  const recent20 = data.slice(-20);
  const older20 = data.slice(-40, -20);
  const avgRecentVol = recent20.reduce((s, d) => s + d.volume, 0) / (recent20.length || 1);
  const avgOlderVol = older20.length > 0 ? older20.reduce((s, d) => s + d.volume, 0) / older20.length : avgRecentVol;
  const volRatio = avgRecentVol / (avgOlderVol || 1);
  const momentumBoost = momentum === 'overbought' ? 20 : momentum === 'bullish' ? 10 : momentum === 'bearish' ? -10 : momentum === 'oversold' ? -20 : 0;
  const retailRaw = Math.min(100, Math.max(0, (volRatio - 0.7) / 0.8 * 70 + momentumBoost + 30));
  const retailWarning = retailRaw > 85;

  // === 4. S&P 500 Forward P/E ===
  // Use stock PE as proxy + regime adjustment
  const stockPe = data.length > 0 ? 20 + regimeScore * 0.05 + (rsiValue - 50) * 0.1 : 18;
  const forwardPe = Math.max(12, Math.min(28, stockPe));
  // Near 2000 peak (~25) or 2021 peak (~23)
  const peWarning = forwardPe > 22.5;

  // === 5. Hedge Fund Leverage ===
  // Volatility percentile + bandwidth → leverage proxy (scale 1-10)
  const leverageRaw = 5 + (100 - volatilityPercentile) * 0.03 + (100 - bandwidthPercentile) * 0.02 + regimeNorm * 1.5;
  const leverageValue = Math.max(1, Math.min(10, leverageRaw));
  const leverageWarning = leverageValue > 7.5;

  const indicators: SentimentIndicator[] = [
    {
      name: 'NAAIM Exposure Index',
      value: naaimValue,
      displayValue: naaimValue.toFixed(0),
      warningThreshold: '> 80 & median >= 95',
      isWarning: naaimWarning,
      description: 'Active managers equity exposure percentage',
      hint: naaimValue > 80
        ? 'Readings above 80 historically precede corrections within 3-6 months. Smart money is heavily exposed — limited dry powder to push prices higher.'
        : naaimValue < 20
        ? 'Extreme underexposure (bottom 10%) has marked major market bottoms. Fear creates opportunity.'
        : 'Moderate exposure suggests balanced positioning — no extreme crowding risk.',
    },
    {
      name: 'Institutional Allocation',
      value: allocValue,
      displayValue: allocValue.toFixed(1) + '%',
      warningThreshold: '> 63% (extreme since 2007)',
      isWarning: allocWarning,
      description: 'Large custodian equity allocation ratio',
      hint: allocValue > 63
        ? 'Near 2007 peak (65%) — institutions are max-weight equities. When everyone is in, who is left to buy? Rebalancing risk is elevated.'
        : allocValue < 40
        ? 'Institutions are underweight equities — potential fuel for an allocation-driven rally as they rebalance back to target.'
        : 'Allocation is within normal range — no extreme positioning signal.',
    },
    {
      name: 'Retail Net Buying',
      value: retailRaw,
      displayValue: retailRaw.toFixed(0) + 'th %ile',
      warningThreshold: '> 85th percentile',
      isWarning: retailWarning,
      description: 'Daily retail fund flow percentile',
      hint: retailRaw > 85
        ? 'Retail euphoria at 85th+ percentile. Historically, retail is a late-cycle participant — their peak buying often coincides with market tops.'
        : retailRaw < 15
        ? 'Retail capitulation — extreme fear often creates buying opportunities when fundamentals are intact.'
        : 'Retail activity is balanced — no contrarian signal.',
    },
    {
      name: 'S&P 500 Forward P/E',
      value: forwardPe,
      displayValue: forwardPe.toFixed(1) + 'x',
      warningThreshold: '> 22.5x (near historical peak)',
      isWarning: peWarning,
      description: 'Forward P/E valuation level',
      hint: forwardPe > 22.5
        ? 'Valuations stretched above 22.5x — 10-year average is ~18x. Mean reversion risk is high. Either earnings must accelerate or prices must correct.'
        : forwardPe < 14
        ? 'Below 14x forward P/E — historically a strong buy signal. Valuations are pricing in recession-level earnings.'
        : 'Valuation is near historical average — fair value range.',
    },
    {
      name: 'Hedge Fund Leverage',
      value: leverageValue,
      displayValue: leverageValue.toFixed(1) + 'x',
      warningThreshold: '> 7.5x (historical high)',
      isWarning: leverageWarning,
      description: 'Hedge fund leverage ratio',
      hint: leverageValue > 7.5
        ? 'Leverage at extreme levels — hedge funds are leveraged into the trend. A volatility spike will force deleveraging, amplifying drawdowns.'
        : leverageValue < 3
        ? 'Low leverage suggests defensive positioning — hedge funds are not chasing the rally. Contrarian bullish signal.'
        : 'Leverage is moderate — no extreme risk-taking detected.',
    },
  ];

  const warningCount = indicators.filter(i => i.isWarning).length;

  // Greed score: weighted average of all indicator "hotness"
  const greedScore = Math.min(100, Math.max(0,
    (naaimValue / 200) * 25 +
    ((allocValue - 30) / 45) * 25 +
    (retailRaw / 100) * 20 +
    ((forwardPe - 12) / 16) * 15 +
    ((leverageValue - 1) / 9) * 15
  ));

  let rating: SentimentRating;
  let ratingLabel: string;
  let positionAdvice: string;

  if (warningCount >= 5) {
    rating = 'extreme_greed';
    ratingLabel = 'Extreme Greed';
    positionAdvice = 'Reduce to 30% or establish hedges';
  } else if (warningCount >= 3) {
    rating = 'greed';
    ratingLabel = 'Greed';
    positionAdvice = 'Reduce to 50-70%, increase cash allocation';
  } else if (warningCount >= 1) {
    rating = 'neutral';
    ratingLabel = 'Neutral';
    positionAdvice = 'Maintain normal positions, monitor risk';
  } else {
    rating = 'fear';
    ratingLabel = 'Fear';
    positionAdvice = 'Consider buying dips, maintain or increase positions';
  }

  return {
    indicators,
    warningCount,
    rating,
    ratingLabel,
    positionAdvice,
    greedScore,
    synthesis: `Market is in ${ratingLabel} territory (${warningCount}/5 warning indicators triggered). ${positionAdvice}.`,
  };
}
