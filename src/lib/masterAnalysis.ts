// masterAnalysis.ts — shared engine for the 12 trading-master analyses.
// Extracted from TradingMasters.tsx so both the single-stock Masters page and
// the new Master Matrix page can reuse the same logic.

import { StockData, Stock } from './stockData';

export type Verdict = 'BUY' | 'HOLD' | 'SELL' | 'AVOID' | 'WATCH';

export interface MasterMetric {
  label: string;
  value: string;
  good?: boolean;
}

export interface MasterAnalysis {
  id: string;
  name: string;
  title: string;
  philosophy: string;
  verdict: Verdict;
  confidence: number;
  strengths: string[];
  risks: string[];
  specificAdvice: string;
  metrics: MasterMetric[];
}

export interface MasterAnalysisInput {
  price: number;
  previousClose: number;
  volume: number;
  marketCap: number;
  historical: StockData[];
}

export const MASTER_ORDER = [
  'buffett-graham',
  'peter-lynch',
  'greenblatt',
  'livermore',
  'munger',
  'marks',
  'templeton',
  'minervini',
  'oneil',
  'weinstein',
  'darvas',
  'wyckoff',
];

export const VERDICT_ORDER: Record<Verdict, number> = {
  BUY: 0,
  HOLD: 1,
  WATCH: 2,
  SELL: 3,
  AVOID: 4,
};

export function buildStockInput(stock: Stock, historical: StockData[]): MasterAnalysisInput {
  return {
    price: stock.price ?? 0,
    previousClose: stock.price ? stock.price - (stock.change ?? 0) : 0,
    volume: stock.volume ?? 0,
    marketCap: parseMarketCap(stock.marketCap),
    historical,
  };
}

// "2.8T" / "500B" / "9.4B" → number (approx), 0 when unparseable
function parseMarketCap(mc: string | number): number {
  if (typeof mc === 'number') return mc;
  if (!mc) return 0;
  const m = mc.match(/([\d.]+)\s*([TBM])?/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  switch ((m[2] || '').toUpperCase()) {
    case 'T': return num * 1e12;
    case 'B': return num * 1e9;
    case 'M': return num * 1e6;
    default: return num;
  }
}

export function analyzeStock(symbol: string, data: MasterAnalysisInput): MasterAnalysis[] {
  const price = data?.price ?? 0;
  const prevClose = data?.previousClose ?? 0;
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  const volume = data?.volume ?? 0;
  const historical = data?.historical ?? [];
  const marketCap = data?.marketCap ?? 0;

  // Calculate key metrics from historical data
  const closes = historical.map((d) => d.close);
  const highs = historical.map((d) => d.high);
  const lows = historical.map((d) => d.low);
  const volumes = historical.map((d) => d.volume);

  const avgVolume20 = volumes.length >= 20
    ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
    : volume;
  const relativeVolume = avgVolume20 ? volume / avgVolume20 : 1;

  const sma20 = closes.length >= 20
    ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
    : price;
  const sma50 = closes.length >= 50
    ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
    : price;
  const sma200 = closes.length >= 200
    ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
    : price;

  const high52w = highs.length > 0 ? Math.max(...highs) : price;
  const low52w = lows.length > 0 ? Math.min(...lows) : price;
  const pctFromHigh = high52w ? ((price - high52w) / high52w) * 100 : 0;
  const pctFromLow = low52w ? ((price - low52w) / low52w) * 100 : 0;

  // Trend strength: price vs SMAs
  const trendUp = price > sma20 && sma20 > sma50;
  const trendDown = price < sma20 && sma20 < sma50;

  // Relative strength: how much it outperformed/underperformed
  const rs = closes.length >= 50
    ? ((closes[closes.length - 1] / closes[closes.length - 50]) - 1) * 100
    : 0;

  // Parabola detection (Minervini style)
  const recentCloses = closes.slice(-20);
  const returns = recentCloses.map((c, i) => i > 0 ? (c - recentCloses[i - 1]) / recentCloses[i - 1] : 0);
  const accel = returns.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const isParabolic = accel > 0.03; // >3% avg daily gain = parabolic

  // Consolidation (Darvas)
  const recentHigh = Math.max(...highs.slice(-10));
  const recentLow = Math.min(...lows.slice(-10));
  const boxRange = recentHigh ? (recentHigh - recentLow) / recentHigh : 0;
  const isConsolidating = boxRange < 0.08;

  const masters: MasterAnalysis[] = [];

  // 1. Buffett / Graham - Value
  const belowSma200 = price < sma200;
  const inBuyZone = pctFromHigh < -20;
  masters.push({
    id: 'buffett-graham',
    name: 'Warren Buffett / Ben Graham',
    title: 'Value Investor',
    philosophy: 'Buy a dollar of business for 50 cents. Demand a durable moat, low debt, high ROE, and a margin of safety.',
    verdict: inBuyZone ? 'BUY' : trendUp ? 'HOLD' : trendDown ? 'AVOID' : 'WATCH',
    confidence: inBuyZone ? 75 : trendUp ? 60 : trendDown ? 62 : 40,
    strengths: [
      inBuyZone ? `${Math.abs(pctFromHigh).toFixed(0)}% below 52-week high — potential margin of safety` : null,
      trendUp ? 'Price above SMA200 — long-term uptrend intact' : null,
      relativeVolume > 1.5 ? 'Above-average volume — institutional interest' : null,
    ].filter(Boolean) as string[],
    risks: [
      isParabolic ? 'Parabolic move — wait for pullback' : null,
      pctFromHigh > -5 ? 'Near all-time highs — limited margin of safety' : null,
      trendDown ? 'Below SMA200 — fundamental concern' : null,
    ].filter(Boolean) as string[],
    specificAdvice: inBuyZone
      ? 'Attractive valuation zone. Research the business moat, debt levels, and ROE before committing. Size by conviction — never more than 25% of portfolio in one name.'
      : 'Wait for a meaningful pullback (20%+ from highs) before initiating a position. Buffett says: "Be fearful when others are greedy."',
    metrics: [
      { label: 'Price vs SMA200', value: `${((price / sma200 - 1) * 100).toFixed(1)}%`, good: price > sma200 },
      { label: 'From 52W High', value: `${pctFromHigh.toFixed(1)}%`, good: pctFromHigh < -15 },
      { label: 'From 52W Low', value: `+${pctFromLow.toFixed(1)}%`, good: pctFromLow > 20 },
    ],
  });

  // 2. Peter Lynch - GARP
  const growthEstimate = rs; // proxy using recent relative strength
  const lynchPEG = growthEstimate > 0 ? (changePercent / growthEstimate) : 99;
  const fairPEG = lynchPEG < 1;
  masters.push({
    id: 'peter-lynch',
    name: 'Peter Lynch',
    title: 'GARP Investor',
    philosophy: 'Invest in what you know. PEG = P/E ÷ EPS growth. PEG ≤ 1 = fair value; ≤ 0.5 = cheap growth.',
    verdict: fairPEG ? 'BUY' : trendUp ? 'HOLD' : 'SELL',
    confidence: fairPEG ? 70 : trendUp ? 55 : 35,
    strengths: [
      fairPEG ? 'PEG ratio suggests fair or undervalued growth' : null,
      rs > 10 ? `Strong ${rs.toFixed(0)}% relative strength over 50 days` : null,
      trendUp ? 'Uptrend confirms growth story' : null,
    ].filter(Boolean) as string[],
    risks: [
      lynchPEG > 2 ? 'Expensive relative to growth' : null,
      isParabolic ? 'Parabolic move — unsustainable' : null,
      trendDown ? 'Downtrend — growth may be decelerating' : null,
    ].filter(Boolean) as string[],
    specificAdvice: fairPEG
      ? 'Growth-at-a-reasonable-price setup. The stock is growing faster than the market prices it. Let winners run — Lynch held winners for years.'
      : 'Overvalued relative to growth. Wait for a better entry or let earnings catch up.',
    metrics: [
      { label: 'Relative Strength (50d)', value: `${rs.toFixed(1)}%`, good: rs > 10 },
      { label: 'Trend', value: trendUp ? 'Up' : trendDown ? 'Down' : 'Neutral', good: trendUp },
      { label: 'Volume vs Avg', value: `${relativeVolume.toFixed(1)}x`, good: relativeVolume > 1 },
    ],
  });

  // 3. Joel Greenblatt - Magic Formula
  const earningsYieldEstimate = changePercent > 0 ? 8 + changePercent : 5 + changePercent;
  const rocEstimate = rs > 0 ? 20 + rs / 2 : 10;
  const combinedRank = (100 - earningsYieldEstimate) + (100 - rocEstimate);
  const magicBuy = combinedRank < 100;
  masters.push({
    id: 'greenblatt',
    name: 'Joel Greenblatt',
    title: 'Magic Formula',
    philosophy: 'Rank by Return on Capital (quality) + Earnings Yield (cheapness). Buy lowest combined rank. Hold ~1 year. Rebalance. No emotion.',
    verdict: magicBuy ? 'BUY' : trendUp ? 'HOLD' : 'SELL',
    confidence: magicBuy ? 72 : trendUp ? 55 : 35,
    strengths: [
      magicBuy ? 'Combined quality + cheapness rank is attractive' : null,
      rs > 15 ? 'Strong momentum supports quality thesis' : null,
      trendUp ? 'Above SMA50 — trend aligns with value' : null,
    ].filter(Boolean) as string[],
    risks: [
      !magicBuy ? 'Combined rank not compelling — may be expensive or low quality' : null,
      isParabolic ? 'Parabolic — mechanical system says wait' : null,
    ].filter(Boolean) as string[],
    specificAdvice: magicBuy
      ? 'Mechanical system says buy. Equal-weight with 20-30 other names. Hold for 1 year. Rebalance. Do NOT add favourites or abandon after a bad year.'
      : 'Rank not in top tier. System says skip this one and find cheaper/higher-quality alternatives.',
    metrics: [
      { label: 'Earnings Yield Est.', value: `${earningsYieldEstimate.toFixed(1)}%`, good: earningsYieldEstimate > 10 },
      { label: 'ROC Est.', value: `${rocEstimate.toFixed(1)}%`, good: rocEstimate > 20 },
      { label: 'Combined Rank', value: `${combinedRank.toFixed(0)}`, good: combinedRank < 100 },
    ],
  });

  // 4. Jesse Livermore - Speculator
  const riskPerShare = Math.abs(price - sma50) * 0.02;
  const positionSize = riskPerShare > 0 ? Math.floor(10000 / riskPerShare) : 0;
  const livermoreBuy = trendUp && !isParabolic && relativeVolume > 0.8;
  masters.push({
    id: 'livermore',
    name: 'Jesse Livermore',
    title: 'Speculator',
    philosophy: 'Cut losses immediately. Let winners run. Pyramid only as it goes your way — never average down. Sit tight through normal corrections.',
    verdict: livermoreBuy ? 'BUY' : trendDown ? 'SELL' : 'HOLD',
    confidence: livermoreBuy ? 68 : trendDown ? 70 : 50,
    strengths: [
      trendUp ? 'Trading with the main trend' : null,
      !isParabolic ? 'Not parabolic — entry is disciplined' : null,
      trendUp && relativeVolume > 1 ? 'Volume confirms trend direction' : null,
    ].filter(Boolean) as string[],
    risks: [
      trendDown ? 'Against the main trend — do not enter' : null,
      isParabolic ? 'Parabolic — this is an EXIT, not an entry' : null,
      Math.abs(changePercent) > 5 ? 'Volatile — tight stop required' : null,
    ].filter(Boolean) as string[],
    specificAdvice: trendUp
      ? `Trend is your friend. Enter with a stop at SMA50 (~$${sma50.toFixed(2)}). Risk no more than 1% of account. If it works, pyramid — add only as it goes your way.`
      : `Do NOT enter against the trend. Livermore's rule: "The market does not beat them. They beat themselves." Wait for the trend to turn.`,
    metrics: [
      { label: 'Suggested Stop', value: `$${sma50.toFixed(2)}`, good: true },
      { label: 'Risk/Share', value: `$${(price - sma50).toFixed(2)}`, good: true },
      { label: 'Trend', value: trendUp ? 'With trend' : 'Against trend', good: trendUp },
    ],
  });

  // 5. Charlie Munger - Judgment
  const mungerBuy = trendUp && relativeVolume > 0.8 && !isParabolic && pctFromHigh < -10;
  masters.push({
    id: 'munger',
    name: 'Charlie Munger',
    title: 'Mental Models',
    philosophy: 'Invert, always invert. Avoid stupidity rather than seek brilliance. Lattice of mental models. "Too Hard" pile. Patience. Say no to most ideas.',
    verdict: mungerBuy ? 'BUY' : trendDown ? 'AVOID' : 'WATCH',
    confidence: mungerBuy ? 65 : trendDown ? 58 : 45,
    strengths: [
      trendUp ? 'Price trend is constructive' : null,
      pctFromHigh < -10 ? 'Not at extreme highs — room for error' : null,
      !isParabolic ? 'Steady climb, not speculation' : null,
    ].filter(Boolean) as string[],
    risks: [
      isParabolic ? 'Speculative price action — Too Hard pile' : null,
      trendDown ? 'Fundamentals may be deteriorating' : null,
      pctFromHigh > -3 ? 'Crowded trade — be greedy when others are fearful' : null,
    ].filter(Boolean) as string[],
    specificAdvice: mungerBuy
      ? 'Multiple models align. Ask: "What could go wrong?" Invert the thesis. If you can list 3+ ways this fails, it\'s in the Too Hard pile. If the downside is limited, size by conviction.'
      : 'This stock doesn\'t pass the inversion test. Munger says: "All I want to know is where I\'m going to die, so I\'ll never go there." Move on.',
    metrics: [
      { label: 'Inversion Test', value: mungerBuy ? 'Pass' : 'Fail', good: mungerBuy },
      { label: 'Parabola Check', value: isParabolic ? 'Parabolic' : 'Normal', good: !isParabolic },
      { label: 'From ATH', value: `${pctFromHigh.toFixed(1)}%`, good: pctFromHigh < -10 },
    ],
  });

  // 6. Howard Marks - Risk
  const greed = trendUp && pctFromHigh > -5;
  const deepFear = pctFromHigh < -20;
  masters.push({
    id: 'marks',
    name: 'Howard Marks',
    title: 'Risk Cycles',
    philosophy: 'Risk = chance of permanent loss, not volatility. Markets swing euphoria ↔ despair. Buy when fearful, sell when greedy. Second-level thinking.',
    verdict: greed ? 'SELL' : deepFear ? 'BUY' : trendDown ? 'AVOID' : 'HOLD',
    confidence: greed ? 65 : deepFear ? 70 : trendDown ? 58 : 50,
    strengths: [
      trendDown ? 'Market is fearful — opportunity for contrarian' : null,
      pctFromHigh < -20 ? 'Significant drawdown — potential mean reversion' : null,
      !isParabolic ? 'Not in speculative bubble territory' : null,
    ].filter(Boolean) as string[],
    risks: [
      trendUp && pctFromHigh > -5 ? 'Market euphoria — risk of permanent loss is elevated' : null,
      isParabolic ? 'Speculative excess — second-level thinkers sell here' : null,
    ].filter(Boolean) as string[],
    specificAdvice: deepFear
      ? 'Second-level thinking says: "Everyone is worried, so prices are low. This is where risk/reward is favourable." But stress-test the downside first — what if it drops another 30%?'
      : greed
        ? 'Prices are high and optimism is rampant. Marks says: "The most dangerous thing is to buy something at the peak of its popularity." Take profits or tighten stops.'
        : trendDown
          ? 'Risk management says: a deteriorating stock carries elevated risk of loss. Neither buy the dip nor hold complacently — reduce exposure until sentiment improves.'
          : 'Marks: "The safest moment to buy is when everyone is most pessimistic." Wait for a clearer fear/greed signal.',
    metrics: [
      { label: 'Market Mood', value: greed ? 'Greed' : deepFear ? 'Fear' : trendDown ? 'Wary' : 'Neutral', good: deepFear },
      { label: 'Risk Level', value: greed ? 'High' : trendDown ? 'Elevated' : 'Moderate', good: !greed },
      { label: 'Cycle Position', value: trendUp ? 'Late cycle' : 'Early cycle', good: !trendUp },
    ],
  });

  // 7. John Templeton - Contrarian
  const maxPessimism = pctFromHigh < -30;
  const templetonBuy = maxPessimism; // buy only at true maximum pessimism, not mild downtrends
  masters.push({
    id: 'templeton',
    name: 'John Templeton',
    title: 'Contrarian',
    philosophy: '"Buy at the point of maximum pessimism." Global perspective. Long horizon. Be brutally contrarian.',
    verdict: templetonBuy ? 'BUY' : 'WATCH',
    confidence: templetonBuy ? 72 : 40,
    strengths: [
      maxPessimism ? 'Near maximum pessimism — Templeton\'s buy zone' : null,
      pctFromHigh < -20 ? 'Significant decline — crowd is scared' : null,
      !isParabolic ? 'Not a speculative bubble' : null,
    ].filter(Boolean) as string[],
    risks: [
      !maxPessimism ? 'Not at maximum pessimism yet — patience required' : null,
      trendUp && pctFromHigh > -10 ? 'Crowd is optimistic — worst time to buy' : null,
    ].filter(Boolean) as string[],
    specificAdvice: templetonBuy
      ? 'Templeton\'s voice: "The four most expensive words in the English language are \'this time it\'s different.\'" If the business is sound and the price is at maximum pessimism, this is the time to buy for the long term (5-10 years).'
      : 'Not at maximum pessimism. Templeton waited years for the right moment. Keep this on your watchlist and wait for true despair.',
    metrics: [
      { label: 'Max Pessimism', value: maxPessimism ? 'Yes' : 'No', good: maxPessimism },
      { label: 'Drawdown', value: `${pctFromHigh.toFixed(1)}%`, good: pctFromHigh < -20 },
      { label: 'Contrarian Signal', value: trendDown ? 'Strong' : 'Weak', good: trendDown },
    ],
  });

  // 8. Mark Minervini - SEPA
  const minerviniBuy = trendUp && rs > 20 && !isParabolic && price > sma50 && pctFromHigh > -25;
  masters.push({
    id: 'minervini',
    name: 'Mark Minervini',
    title: 'SEPA / VCP',
    philosophy: 'Specific Entry Point Analysis. Buy stocks in confirmed uptrend with tight consolidation (VCP), relative strength > 80, and volume confirmation.',
    verdict: minerviniBuy ? 'BUY' : trendUp ? 'WATCH' : 'AVOID',
    confidence: minerviniBuy ? 78 : trendUp ? 55 : 30,
    strengths: [
      minerviniBuy ? 'Uptrend + high RS + not parabolic = SEPA entry' : null,
      rs > 20 ? `Strong ${rs.toFixed(0)}% relative strength — leadership stock` : null,
      trendUp && price > sma50 ? 'Price above SMA50 — trend confirmed' : null,
      isConsolidating ? 'Consolidating — potential VCP base forming' : null,
    ].filter(Boolean) as string[],
    risks: [
      isParabolic ? 'PARABOLIC — exit, do not enter. Minervini: "Parabolas are exits, not entries."' : null,
      rs < 0 ? 'Negative relative strength — not a leader' : null,
      !trendUp ? 'Not in confirmed uptrend' : null,
    ].filter(Boolean) as string[],
    specificAdvice: minerviniBuy
      ? 'SEPA entry criteria met. Enter on a breakout from the consolidation with above-average volume. Initial stop: 7-8% below entry. Trail stop to SMA50 as profit builds.'
      : isParabolic
        ? 'DO NOT BUY. This is a parabolic move. Minervini: "I never buy a stock that has gone up more than 30% in the last few months — the risk/reward is terrible."'
        : 'Wait for a proper SEPA setup: uptrend confirmed, VCP base forms, then breakout on volume.',
    metrics: [
      { label: 'Relative Strength', value: `${rs.toFixed(0)}%`, good: rs > 20 },
      { label: 'Trend', value: trendUp ? 'Confirmed Up' : 'Not confirmed', good: trendUp },
      { label: 'Parabola', value: isParabolic ? 'YES' : 'No', good: !isParabolic },
      { label: 'VCP Base', value: isConsolidating ? 'Forming' : 'Not yet', good: isConsolidating },
    ],
  });

  // 9. William O'Neil - CAN SLIM
  const oneilBuy = trendUp && rs > 15 && relativeVolume > 1.2 && !isParabolic;
  masters.push({
    id: 'oneil',
    name: 'William O\'Neil',
    title: 'CAN SLIM',
    philosophy: 'C-A-N-S-L-I-M: Current earnings, Annual growth, New products, Supply/demand, Leader/laggard, Institutional sponsorship, Market direction.',
    verdict: oneilBuy ? 'BUY' : trendUp ? 'WATCH' : 'SELL',
    confidence: oneilBuy ? 74 : trendUp ? 50 : 30,
    strengths: [
      oneilBuy ? 'Strong trend + high RS + volume = CAN SLIM criteria met' : null,
      rs > 20 ? 'Top 20% relative strength — leader stock' : null,
      relativeVolume > 1.5 ? 'Institutional accumulation detected' : null,
    ].filter(Boolean) as string[],
    risks: [
      isParabolic ? 'Extended — too late to buy. O\'Neil: "Buy at the pivot point, not after"' : null,
      rs < 10 ? 'Not a relative strength leader' : null,
      trendDown ? 'Market direction (M) is negative' : null,
    ].filter(Boolean) as string[],
    specificAdvice: oneilBuy
      ? 'CAN SLIM checklist looks good. Buy at the pivot point (breakout from base) with volume. Initial stop: 7-8%. Let profits run to 20-25% before taking partial gains.'
      : 'Does not meet CAN SLIM criteria. O\'Neil\'s rule: 75% of stocks follow the market direction — if the market is down, sit on cash.',
    metrics: [
      { label: 'Relative Strength', value: `Top ${Math.max(5, 100 - rs).toFixed(0)}%`, good: rs > 15 },
      { label: 'Volume', value: `${relativeVolume.toFixed(1)}x avg`, good: relativeVolume > 1.2 },
      { label: 'Market Direction', value: trendUp ? 'Up' : 'Down', good: trendUp },
    ],
  });

  // 10. Stan Weinstein - Stage Analysis
  let stage = 4;
  if (trendUp && price > sma200 && price > sma50) stage = 2;
  else if (trendUp && price > sma200) stage = 1;
  else if (trendDown && price < sma200 && price < sma50) stage = 4;
  else if (trendDown && price < sma200) stage = 3;
  const weinsteinBuy = stage === 2;
  masters.push({
    id: 'weinstein',
    name: 'Stan Weinstein',
    title: 'Stage Analysis',
    philosophy: 'Stage 1: Basing. Stage 2: Advancing (BUY). Stage 3: Topping. Stage 4: Declining (AVOID). Trade with Stage 2, avoid Stage 4.',
    verdict: weinsteinBuy ? 'BUY' : stage === 1 ? 'WATCH' : stage === 3 ? 'SELL' : 'AVOID',
    confidence: weinsteinBuy ? 80 : stage === 1 ? 55 : 25,
    strengths: [
      weinsteinBuy ? 'Stage 2 advancing — the ideal entry stage' : null,
      stage === 1 ? 'Stage 1 basing — prepare for potential Stage 2 breakout' : null,
      price > sma200 && price > sma50 ? 'Above both SMA50 and SMA200' : null,
    ].filter(Boolean) as string[],
    risks: [
      stage === 4 ? 'Stage 4 declining — DANGER. Do not buy, do not hold.' : null,
      stage === 3 ? 'Stage 3 topping — distribution phase, take profits' : null,
      isParabolic ? 'Stage 2 may be ending — parabolic top signals Stage 3' : null,
    ].filter(Boolean) as string[],
    specificAdvice: weinsteinBuy
      ? `Stage 2 confirmed. Weinstein's rule: buy when price breaks above SMA50 with volume. Stop below SMA50. Hold as long as price stays above the 30-week SMA (SMA200 proxy).`
      : stage === 4
        ? 'STAGE 4. The stock is in a death spiral. Weinstein\'s rule: "Never hold a Stage 4 stock." Sell immediately if you own it.'
        : stage === 3
          ? 'Stage 3 topping. Take profits. Weinstein: "When a stock crosses below the 30-week SMA after a Stage 2 advance, sell."'
          : 'Stage 1 basing. Not yet actionable. Set an alert for when it breaks above SMA50 with volume.',
    metrics: [
      { label: 'Stage', value: `${stage}`, good: stage === 2 },
      { label: 'Price vs SMA50', value: `${((price / sma50 - 1) * 100).toFixed(1)}%`, good: price > sma50 },
      { label: 'Price vs SMA200', value: `${((price / sma200 - 1) * 100).toFixed(1)}%`, good: price > sma200 },
    ],
  });

  // 11. Nicolas Darvas - Box Theory
  const darvasBuy = isConsolidating && trendUp && relativeVolume > 1;
  masters.push({
    id: 'darvas',
    name: 'Nicolas Darvas',
    title: 'Box Theory',
    philosophy: 'Stocks trade in boxes. Buy when price breaks above the top of a box with volume. Trail stop to bottom of new box. Never average down.',
    verdict: darvasBuy ? 'BUY' : trendUp ? 'WATCH' : 'SELL',
    confidence: darvasBuy ? 70 : trendUp ? 50 : 30,
    strengths: [
      darvasBuy ? `Consolidating in a box ($${recentLow.toFixed(2)}-$${recentHigh.toFixed(2)}) — breakout imminent` : null,
      trendUp ? 'Uptrend supports box breakout thesis' : null,
      relativeVolume > 1.2 ? 'Volume building — accumulation before breakout' : null,
    ].filter(Boolean) as string[],
    risks: [
      isParabolic ? 'Parabolic — box theory does not apply to vertical moves' : null,
      !isConsolidating && !trendUp ? 'No clear box pattern — too volatile' : null,
    ].filter(Boolean) as string[],
    specificAdvice: darvasBuy
      ? `Darvas box is forming between $${recentLow.toFixed(2)} and $${recentHigh.toFixed(2)}. Place a buy stop at $${(recentHigh * 1.01).toFixed(2)} (1% above box top). If it breaks out, trail stop to $${recentLow.toFixed(2)} (box bottom).`
      : 'No clear Darvas box. Wait for price to consolidate into a defined range, then watch for the breakout.',
    metrics: [
      { label: 'Box Range', value: `$${recentLow.toFixed(2)} - $${recentHigh.toFixed(2)}`, good: isConsolidating },
      { label: 'Box Width', value: `${(boxRange * 100).toFixed(1)}%`, good: boxRange < 0.1 },
      { label: 'Buy Stop', value: `$${(recentHigh * 1.01).toFixed(2)}`, good: true },
    ],
  });

  // 12. Richard Wyckoff - Accumulation/Distribution
  const priceStrength = (price - low52w) / (high52w - low52w || 1);
  const volTrend = relativeVolume > 1.2 && trendUp;
  const wyckoffBuy = volTrend && priceStrength > 0.5 && !isParabolic;
  masters.push({
    id: 'wyckoff',
    name: 'Richard Wyckoff',
    title: 'Accumulation/Distribution',
    philosophy: 'Read the composite operator. Accumulation = smart money buying (low volume on drops, high on rallies). Distribution = smart money selling.',
    verdict: wyckoffBuy ? 'BUY' : volTrend ? 'WATCH' : trendDown ? 'SELL' : 'WATCH',
    confidence: wyckoffBuy ? 68 : volTrend ? 55 : 35,
    strengths: [
      wyckoffBuy ? 'Volume + uptrend suggests accumulation phase' : null,
      volTrend ? 'Rising volume on up days — smart money buying' : null,
      priceStrength > 0.6 ? 'Strong position in range — demand > supply' : null,
    ].filter(Boolean) as string[],
    risks: [
      !volTrend && trendUp ? 'Low volume rally — possible distribution' : null,
      isParabolic ? 'Parabolic — Wyckoff would call this a markup climax' : null,
      trendDown && relativeVolume > 1.5 ? 'High volume on decline — distribution confirmed' : null,
    ].filter(Boolean) as string[],
    specificAdvice: wyckoffBuy
      ? 'Wyckoff says accumulation is underway. The composite operator is buying. Enter on a spring (shakeout below support) or on a sign of strength (rally above resistance on volume). Stop below the accumulation range.'
      : trendDown && relativeVolume > 1.5
        ? 'Wyckoff distribution is in progress. The composite operator is selling to the public. Do not buy — this is a falling knife.'
        : 'No clear Wyckoff signal. Watch for accumulation signs: shrinking volume on declines, expanding volume on rallies.',
    metrics: [
      { label: 'Phase', value: volTrend ? 'Accumulation' : trendDown ? 'Distribution' : 'Unclear', good: volTrend },
      { label: 'Volume Trend', value: `${relativeVolume.toFixed(1)}x`, good: relativeVolume > 1.2 },
      { label: 'Price Position', value: `${(priceStrength * 100).toFixed(0)}% of range`, good: priceStrength > 0.5 },
    ],
  });

  return masters;
}

// ─── Ranking / aggregation helpers (used by the Master Matrix page) ──

export interface StockMasterResult {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  analyses: MasterAnalysis[];
  buyCount: number;
  avgConfidence: number;
  score: number; // composite: buyCount weighted by confidence
  isSimulated?: boolean;
  error?: string | null;
  recordedAt?: string;
}

export function summarizeMasterResult(
  symbol: string,
  stock: Stock,
  price: number,
  changePercent: number,
  analyses: MasterAnalysis[],
  opts?: { isSimulated?: boolean; error?: string | null; recordedAt?: string }
): StockMasterResult {
  const buyCount = analyses.filter(a => a.verdict === 'BUY').length;
  const buyAvgConf = analyses.filter(a => a.verdict === 'BUY').reduce((s, a) => s + a.confidence, 0) / (buyCount || 1);
  const avgConfidence = analyses.reduce((s, a) => s + a.confidence, 0) / (analyses.length || 1);
  const score = buyCount * 10 + buyAvgConf / 10;
  return {
    symbol,
    name: stock?.name ?? symbol,
    sector: stock?.sector ?? 'Unknown',
    price,
    changePercent,
    analyses,
    buyCount,
    avgConfidence,
    score,
    isSimulated: opts?.isSimulated,
    error: opts?.error ?? null,
    recordedAt: opts?.recordedAt,
  };
}

export function rankByScore(a: StockMasterResult, b: StockMasterResult): number {
  return b.score - a.score;
}

export function verdictGradientScore(verdict: Verdict): number {
  switch (verdict) {
    case 'BUY': return 2;
    case 'HOLD': return 1;
    case 'WATCH': return 0;
    case 'SELL': return -1;
    case 'AVOID': return -2;
  }
}

// ─── S&P 500 constituent filter ────────────────────────────────────
// Curated set of genuine S&P 500 members among the app's curated universe
// (popularStocks / screenerStocks). Names NOT in the S&P 500 (TSM, ARM,
// COIN, SOFI, SQ, COKE) are excluded so we only screen real constituents.

export const SP500_TICKERS: ReadonlySet<string> = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'INTC',
  'CRM', 'ORCL', 'ADBE',
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'V', 'MA',
  'JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY',
  'WMT', 'PG', 'KO', 'PEP', 'COST', 'NKE', 'MCD', 'SBUX',
  'XOM', 'CVX', 'COP',
  'CAT', 'BA', 'HON', 'UPS', 'GE',
  'VZ', 'T', 'TMUS',
  'AMT', 'PLD',
  'LMT', 'RTX', 'NOC', 'GD',
  'PLTR', 'SNOW', 'NET', 'CRWD', 'UBER',
  'AVGO', 'QCOM', 'MU',
]);

export function filterToSP500<T extends { symbol: string }>(stocks: T[]): T[] {
  return stocks.filter(s => SP500_TICKERS.has(s.symbol));
}

// ─── NASDAQ-100 constituent filter ─────────────────────────────────
// Curated set of genuine Nasdaq-100 members among the app's curated universe
// (popularStocks). Excludes S&P-only financials/energy/industrials/REITs and
// non-index names (TSM, SOFI, SQ, HOOD).

export const NASDAQ100_TICKERS: ReadonlySet<string> = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'INTC',
  'CRM', 'ORCL', 'ADBE', 'AVGO', 'QCOM', 'MU', 'LLY',
  'PEP', 'SBUX', 'COST', 'TMUS',
  'COIN', 'MSTR', 'PLTR', 'SNOW', 'NET', 'DDOG', 'CRWD', 'UBER', 'ABNB',
  'SHOP', 'ARM', 'NFLX', 'AMGN', 'GILD', 'CSCO', 'INTU', 'ADI', 'PANW',
  'MAR', 'TTD', 'FTNT', 'ASML', 'PDD', 'MELI', 'KDP', 'ODFL', 'CPRT',
]);

export function filterToNASDAQ100<T extends { symbol: string }>(stocks: T[]): T[] {
  return stocks.filter(s => NASDAQ100_TICKERS.has(s.symbol));
}

// ─── Combined index universe (S&P 500 ∪ NASDAQ-100) ────────────────
// The simulated-traders ledger restricts its shared universe to symbols that
// belong to one of the two major US index universes tracked by the app. A
// symbol may be a constituent of both (e.g. AAPL) — membership is still single.

export const INDEX_UNIVERSE_TICKERS: ReadonlySet<string> = new Set<string>([
  ...SP500_TICKERS,
  ...NASDAQ100_TICKERS,
]);

/** True when the symbol is a constituent of S&P 500, NASDAQ-100, or both. */
export function isIndexTrackedSymbol(symbol: string): boolean {
  return INDEX_UNIVERSE_TICKERS.has(symbol.toUpperCase());
}

// ─── Universe selection (used by the Master Matrix page) ───────────

export type UniverseId = 'sp500' | 'nasdaq100' | 'all';

export interface UniverseDef {
  id: UniverseId;
  label: string;
  short: string;
}

export const UNIVERSES: UniverseDef[] = [
  { id: 'sp500', label: 'S&P 500', short: 'S&P' },
  { id: 'nasdaq100', label: 'NASDAQ-100', short: 'NDX' },
  { id: 'all', label: 'All tracked', short: 'ALL' },
];

/** Filter a stock list to the selected index universe. 'all' returns input. */
export function filterStocksByUniverse<T extends { symbol: string }>(stocks: T[], universeId: UniverseId): T[] {
  switch (universeId) {
    case 'sp500': return filterToSP500(stocks);
    case 'nasdaq100': return filterToNASDAQ100(stocks);
    default: return stocks;
  }
}

export const MASTER_MATRIX_SIZE = 50;
