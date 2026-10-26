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

function ordinal(value: number): string {
  const n = Math.round(value);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
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
      name: 'NAAIM Exposure (est.)',
      value: naaimValue,
      displayValue: naaimValue.toFixed(0),
      warningThreshold: '> 80 & median >= 95',
      isWarning: naaimWarning,
      description: 'Price-action proxy for active-manager equity exposure',
      hint: naaimValue > 80
        ? 'Estimated exposure is elevated — historically that has preceded corrections within 3-6 months. Limited dry powder to push prices higher.'
        : naaimValue < 20
        ? 'Estimated underexposure (bottom 10%) has marked major market bottoms. Fear creates opportunity.'
        : 'Estimated exposure is balanced — no extreme crowding risk.',
    },
    {
      name: 'Institutional Allocation (est.)',
      value: allocValue,
      displayValue: allocValue.toFixed(1) + '%',
      warningThreshold: '> 63% (extreme since 2007)',
      isWarning: allocWarning,
      description: 'Price-action proxy for large-custodian equity weight',
      hint: allocValue > 63
        ? 'Estimated allocation near the 2007 peak (65%) — everyone may already be in. Rebalancing risk is elevated.'
        : allocValue < 40
        ? 'Estimated allocation is underweight equities — potential fuel for an allocation-driven rally.'
        : 'Estimated allocation is within a normal range — no extreme positioning signal.',
    },
    {
      name: 'Retail Net Buying (est.)',
      value: retailRaw,
      displayValue: ordinal(retailRaw) + ' percentile',
      warningThreshold: '> 85th percentile',
      isWarning: retailWarning,
      description: 'Volume-trend proxy for retail flow participation',
      hint: retailRaw > 85
        ? 'Estimated retail participation in the 85th+ percentile. Retail is often a late-cycle buyer — their peak buying has coincided with market tops.'
        : retailRaw < 15
        ? 'Estimated retail capitulation — extreme fear has often created buying opportunities when fundamentals are intact.'
        : 'Estimated retail activity is balanced — no contrarian signal.',
    },
    {
      name: 'S&P 500 Forward P/E (est.)',
      value: forwardPe,
      displayValue: forwardPe.toFixed(1) + 'x',
      warningThreshold: '> 22.5x (near historical peak)',
      isWarning: peWarning,
      description: 'Price/momentum proxy for forward valuation',
      hint: forwardPe > 22.5
        ? 'Estimated valuation above 22.5x — the 10-year average is ~18x. Mean-reversion risk is high.'
        : forwardPe < 14
        ? 'Estimated valuation below 14x — historically a strong entry zone. Prices may be pricing in recession-level earnings.'
        : 'Estimated valuation is near the historical average — fair value range.',
    },
    {
      name: 'Hedge Fund Leverage (est.)',
      value: leverageValue,
      displayValue: leverageValue.toFixed(1) + 'x',
      warningThreshold: '> 7.5x (historical high)',
      isWarning: leverageWarning,
      description: 'Volatility-regime proxy for hedge-fund leverage',
      hint: leverageValue > 7.5
        ? 'Estimated leverage is extreme — a volatility spike can force deleveraging and amplify drawdowns.'
        : leverageValue < 3
        ? 'Estimated leverage is low — defensively positioned funds are not chasing the rally. Contrarian bullish signal.'
        : 'Estimated leverage is moderate — no extreme risk-taking detected.',
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
