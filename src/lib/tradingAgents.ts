import { StockData, Stock, Signal, generateSignals, calculateRSI, calculateSMA, calculateMACD, generateForecast, ForecastPoint } from './stockData';
import { analyzeStock, buildStockInput, MasterAnalysis, Verdict } from './masterAnalysis';
import { analyzeMarketConditions, MarketCondition, getStrategyRecommendations } from './strategyRecommendation';
import { calculateLiquidityConditions, LiquidityResult } from './liquidityMonitor';
import { fetchSentiment, AggregatedSentiment } from './sentimentAnalysis';

// ============================================================================
// TradingAgents — rule-based reimplementation
// ----------------------------------------------------------------------------
// Mirrors the TradingAgents Python multi-agent workflow WITHOUT any LLM/AI API:
//
//   1. Analyst Team   -> technical, fundamentals, sentiment, market 'workers'
//   2. Research Mgr   -> synthesises the analyst reports into an investment preview
//   3. Researcher     -> bull vs bear structured debate + a judge
//   4. Trader Agent   -> composes analyst + debate into a trading plan (action,
//                        entry, stop, target) with a confidence
//   5. Risk Debate    -> aggressive / conservative / neutral risk debaters + judge
//   6. Portfolio Mgr  -> approves / rejects and sets a position weight
//   7. Final decision -> 5-tier rating: Buy / Overweight / Hold / Underweight / Sell
//
// Everything below is deterministic and driven by the app's existing rule-based
// analyzers (technical signals, master analysts, market/liquidity, sentiment).
// ============================================================================

export type AgentBias = 'bullish' | 'bearish' | 'neutral';

export interface AnalystReport {
  id: 'technical' | 'fundamentals' | 'sentiment' | 'market';
  name: string;
  role: string;
  bias: AgentBias;
  confidence: number;                    // 0-100
  score: number;                         // -100 (bearish) .. +100 (bullish)
  summary: string;
  evidence: string[];                    // short bullets
  keyMetric: string;                     // single headline number/verdict
}

export interface ResearchPreview {
  summary: string;
  overallBias: AgentBias;
  consensusConfidence: number;           // 0-100
  spreadNotes: string;                   // where the analysts disagree
}

export interface DebateEntry {
  speaker: 'bull' | 'bear' | 'judge' | 'trader';
  stance: AgentBias;
  label: string;
  message: string;
  points: number;                        // argument strength 0-100
}

export interface TraderPlan {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;                    // 0-100
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
}

export type RiskPersona = 'Aggressive' | 'Conservative' | 'Neutral';

export interface RiskVerdict {
  persona: RiskPersona;
  allowed: boolean;                      // does this debater permit the trade?
  maxWeight: number;                     // max % of capital for this persona
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface PortfolioDecision {
  approved: boolean;
  action: 'BUY' | 'SELL' | 'HOLD';
  positionWeight: number;                // 0-100 % of capital
  sizingPersona: RiskPersona;            // persona whose tolerance capped the size
  stopLoss: number;
  takeProfit: number;
  signal: 'BUY' | 'SELL' | 'HOLD';       // the PM's net actionable call
  opinion: string;                       // narrative judgement + final conclusion
  note: string;                          // detailed sizing/rejection note
}

export type FinalRating = 'Buy' | 'Overweight' | 'Hold' | 'Underweight' | 'Sell';

export interface TradingAgentsResult {
  symbol: string;
  stockName: string;
  sector: string;
  price: number;
  changePercent: number;
  analysts: AnalystReport[];
  researchPreview: ResearchPreview;
  debate: DebateEntry[];
  traderPlan: TraderPlan;
  riskDebate: RiskVerdict[];
  portfolio: PortfolioDecision;
  final: {
    rating: FinalRating;
    action: TraderPlan['action'];
    confidence: number;                  // 0-100
    positionWeight: number;              // recommended % of capital (risk-capped)
    sizingPersona: RiskPersona;          // persona whose tolerance capped the size
    conviction: number;                  // 0-100 strength of the rating, for the hero bar
  };
  marketCondition: MarketCondition | null;
  liquidity: LiquidityResult | null;
  sentiment: AggregatedSentiment | null;
  forecast: ForecastPoint[] | null;
  generatedAt: string;
}

interface EngineDeps {
  price: number;
  previousClose: number;
  volume: number;
  marketCap: number;
  historical: StockData[];
}

const FUNDAMENTAL_MASTER_IDS = [
  'buffett-graham', 'greenblatt', 'peter-lynch', 'munger', 'marks', 'templeton',
];

const verdictScore: Record<Verdict, number> = {
  BUY: 2, HOLD: 0, WATCH: 0, SELL: -2, AVOID: -2,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(a: number, b: number): number {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

// --- Analyst 1: Technical ----------------------------------------------------
function technicalAnalyst(historical: StockData[], price: number): AnalystReport {
  const signals: Signal[] = generateSignals(historical);
  const evidence: string[] = [];
  let score = 0;
  let strongCount = 0;
  let nonHoldCount = 0;

  if (signals.length === 0) {
    return {
      id: 'technical', name: 'Technical Analyst', role: 'Price action & momentum',
      bias: 'neutral', confidence: 30, score: 0,
      summary: 'Insufficient price history to run the technical signal stack.',
      evidence: ['Not enough bars (<50) for the 8-strategy signal engine.'],
      keyMetric: 'Insufficient data',
    };
  }

  signals.forEach((s) => {
    // strength weighting normalized to a ±1 unit (strong=1, moderate≈0.67,
    // weak≈0.33) so an individual signal can't saturate the score; we then
    // average rather than sum, otherwise several concurrent signals always
    // clamp the aggregate to ±100 and the true mix is lost.
    const dir = s.type === 'buy' ? 1 : s.type === 'sell' ? -1 : 0;
    const unit = s.strength === 'strong' ? 1 : s.strength === 'moderate' ? 0.66 : 0.33;
    if (s.type !== 'hold') {
      score += dir * unit * (s.confidence / 100);
      nonHoldCount++;
      evidence.push(`${s.strategy}: ${s.type.toUpperCase()} (${s.confidence}%) — ${s.reason}`);
    }
    if (s.type !== 'hold' && s.strength === 'strong') strongCount++;
  });
  score = nonHoldCount ? score / nonHoldCount : 0;

  const rsi = calculateRSI(historical, 14);
  const lastRsi = rsi[rsi.length - 1] ?? 50;
  const sma20 = calculateSMA(historical, 20);
  const sma200 = calculateSMA(historical, 200);
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma200 = sma200[sma200.length - 1];

  let trendText = '';
  if (lastSma20 && lastSma200) {
    trendText = pct(lastSma20, lastSma200) > 0 ? 'above' : 'below';
    evidence.push(`20-day SMA is ${trendText} the 200-day SMA.`);
    score += (trendText === 'above' ? 0.25 : -0.25);
  }

  let bias: AgentBias = 'neutral';
  if (score > 0.6) bias = 'bullish';
  else if (score < -0.6) bias = 'bearish';

  const confidence = clamp(40 + strongCount * 10 + Math.abs(score) * 25, 25, 92);
  evidence.push(`RSI(14) at ${lastRsi.toFixed(0)}.`);

  return {
    id: 'technical', name: 'Technical Analyst', role: 'Price action & momentum',
    bias, confidence: Math.round(confidence), score: Math.round(clamp(score * 100, -100, 100)),
    summary: bias === 'bullish'
      ? 'The technical stack leans bullish — momentum and trend signals tilt higher.'
      : bias === 'bearish'
        ? 'The technical stack leans bearish — momentum and trend signals tilt lower.'
        : 'The technical stack is mixed — signals are not aligned strongly either way.',
    evidence: evidence.slice(0, 8),
    keyMetric: `RSI ${lastRsi.toFixed(0)}`,
  };
}

// --- Analyst 2: Fundamentals -------------------------------------------------
function fundamentalsAnalyst(symbol: string, deps: EngineDeps, masters: MasterAnalysis[]): AnalystReport {
  const fundamentalMasters = masters.filter((m) => FUNDAMENTAL_MASTER_IDS.includes(m.id));
  const evidence: string[] = [];
  let score = 0;
  let votes = 0;

  fundamentalMasters.forEach((m) => {
    // verdictScore spans ±2; divide by 2 to get a ±1 unit, then average across
    // masters. Summing raw ±2 weights across six masters always clamps to ±100
    // and loses the actual bullish/bearish split.
    score += (verdictScore[m.verdict] / 2) * (m.confidence / 100);
    votes += 1;
    evidence.push(`${m.name}: ${m.verdict} (${m.confidence}%) — ${m.specificAdvice}`);
  });
  score = votes ? score / votes : 0;

  const bias: AgentBias = score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral';

  // The qualitative summary is driven primarily by the raw master VOTE split
  // (bulls vs bears), not just the confidence-weighted score. This stops a
  // borderline weighted score (e.g. a couple of high-confidence BUYs outweighing
  // low-confidence SELLs) from being overstated as a confident "edge".
  const bullCount = fundamentalMasters.filter((m) => m.verdict === 'BUY').length;
  const bearCount = fundamentalMasters.filter((m) => m.verdict === 'SELL' || m.verdict === 'AVOID').length;
  const margin = bullCount - bearCount;
  const summary = margin >= 2
    ? 'The valuation-focused masters are broadly constructive — a clear majority see a value/quality edge.'
    : margin <= -2
      ? 'The valuation-focused masters are broadly concerned — most flag the company as expensive or overextended.'
      : bullCount > bearCount
        ? 'Valuation masters lean bullish but are split — only a slight majority see a value edge; not a strong signal.'
        : bearCount > bullCount
          ? 'Valuation masters lean bearish but are split — more flag it as overextended than cheap; not decisive.'
          : 'Valuation masters are evenly split — no clear fundamental edge either way.';

  return {
    id: 'fundamentals', name: 'Fundamentals Analyst', role: 'Valuation & quality',
    bias, confidence: Math.round(clamp(45 + Math.abs(score) * 60, 25, 90)),
    score: Math.round(clamp(score * 100, -100, 100)),
    summary,
    evidence: evidence.slice(0, 6),
    keyMetric: `${bullCount}/${fundamentalMasters.length} bulls vs ${bearCount} bears`,
  };
}

// --- Analyst 3: Sentiment ----------------------------------------------------
function sentimentAnalyst(sentiment: AggregatedSentiment | null): AnalystReport {
  if (!sentiment || sentiment.sources.length === 0) {
    return {
      id: 'sentiment', name: 'Sentiment Analyst', role: 'News & social mood',
      bias: 'neutral', confidence: 30, score: 0,
      summary: 'Live sentiment sources were unreachable — treating mood as neutral.',
      evidence: ['No live news/social data could be scored right now.'],
      keyMetric: 'Unavailable',
    };
  }
  const bias: AgentBias = sentiment.sentiment;
  const score = bias === 'bullish' ? sentiment.confidence : bias === 'bearish' ? -sentiment.confidence : 0;
  const top = sentiment.sources.slice(0, 3).map((s) => `${s.name}: ${s.score.toFixed(2)}`);
  return {
    id: 'sentiment', name: 'Sentiment Analyst', role: 'News & social mood',
    bias, confidence: sentiment.confidence, score: Math.round(clamp(score, -100, 100)),
    summary: `Crowd mood reads ${bias} across ${sentiment.totalItems} scored headlines/items.`,
    evidence: [...top, ...(sentiment.themes.length ? [`Themes: ${sentiment.themes.slice(0, 4).join(', ')}`] : [])],
    keyMetric: `${bias} · ${sentiment.confidence}%`,
  };
}

// --- Analyst 4: Market / Macro ----------------------------------------------
function marketAnalyst(condition: MarketCondition, liquidity: LiquidityResult): AnalystReport {
  const { regime, regimeScore, volatility } = condition;
  let score = clamp(regimeScore / 2, -50, 50);
  let bias: AgentBias = 'neutral';
  if (score > 15) bias = 'bullish';
  else if (score < -15) bias = 'bearish';

  const liq = liquidity.liquidityScore;
  const liqBias = liq > 60 ? 0.3 : liq < 40 ? -0.3 : 0;
  score += liqBias;

  const evidence = [
    `Market regime: ${regime} (score ${Math.round(regimeScore)}).`,
    `Volatility: ${volatility}.`,
    `Liquidity: ${liquidity.ratingLabel} (${liq.toFixed(2)}/100).`,
    `Liquidity advice: ${liquidity.actionAdvice}.`,
  ];

  if (liqBias > 0) bias = 'bullish';
  else if (liqBias < 0) bias = 'bearish';

  const confidence = clamp(50 + Math.abs(score) * 0.8, 25, 88);
  return {
    id: 'market', name: 'Market Analyst', role: 'Regime, volatility & liquidity',
    bias, confidence: Math.round(confidence), score: Math.round(clamp(score, -100, 100)),
    summary: `The market backdrop is ${regime} with ${volatility} volatility and ${liquidity.ratingLabel} liquidity.`,
    evidence, keyMetric: `${regime} · ${Math.round(confidence)}%`,
  };
}

// --- Research Manager --------------------------------------------------------
function researchManager(analysts: AnalystReport[]): ResearchPreview {
  const bullish = analysts.filter((a) => a.bias === 'bullish');
  const bearish = analysts.filter((a) => a.bias === 'bearish');
  const neutral = analysts.filter((a) => a.bias === 'neutral');

  const weighted = analysts.reduce((acc, a) => acc + a.score * (a.confidence / 100), 0);
  const overallBias: AgentBias = weighted > 25 ? 'bullish' : weighted < -25 ? 'bearish' : 'neutral';
  const confidences = analysts.length ? analysts.reduce((a, b) => a + b.confidence, 0) / analysts.length : 0;

  let spreadNotes = '';
  if (bullish.length && bearish.length) {
    spreadNotes = `${bullish.length} analyst(s) bullish vs ${bearish.length} bearish — the research stack is genuinely contested.`;
  } else if (bullish.length) {
    spreadNotes = 'All active analysts lean bullish; no material bearish dissent.';
  } else if (bearish.length) {
    spreadNotes = 'All active analysts lean bearish; no material bullish support.';
  } else {
    spreadNotes = 'Every analyst is neutral — low signal across the board.';
  }

  return {
    summary: `The four analyst workers average a ${overallBias} tilt (${Math.round(weighted)} on a -100..+100 scale) with a mean confidence of ${Math.round(confidences)}%.`,
    overallBias,
    consensusConfidence: Math.round(confidences),
    spreadNotes,
  };
}

// --- Bull vs Bear Researcher Debate + Judge ----------------------------------
function researcherDebate(research: ResearchPreview, analysts: AnalystReport[], deps: EngineDeps): DebateEntry[] {
  const debate: DebateEntry[] = [];

  const bullInputs = analysts
    .flatMap((a) => (a.score > 0 ? [{ analyst: a.name, score: a.score, conf: a.confidence, evidence: a.evidence[0] ?? '' }] : []))
    .sort((x, y) => y.score - x.score);

  const bearInputs = analysts
    .flatMap((a) => (a.score < 0 ? [{ analyst: a.name, score: -a.score, conf: a.confidence, evidence: a.evidence[0] ?? '' }] : []))
    .sort((x, y) => y.score - x.score);

  const bullStrength = bullInputs.reduce((s, i) => s + i.score * (i.conf / 100), 0);
  const bearStrength = bearInputs.reduce((s, i) => s + i.score * (i.conf / 100), 0);

  // Normalize each camp to its SHARE of the combined weighted strength so the
  // two numbers always sum to ~100 and clearly show which side dominates. Raw
  // conviction can be high on both sides (each camp near its absolute cap), which
  // hid the verdict; a relative split makes the winner obvious. Direction is still
  // gated by the judge, which needs an absolute net gap > 20, so a weak-consensus
  // dead-heat cannot spuriously trigger a trade.
  const totalStrength = bullStrength + bearStrength;
  const bullShare = totalStrength > 0 ? (bullStrength / totalStrength) * 100 : 0;
  const bearShare = totalStrength > 0 ? (bearStrength / totalStrength) * 100 : 0;

  const bullMessage = bullInputs.length
    ? `Bull case: ${bullInputs[0].analyst} leads with a ${Math.round(bullInputs[0].score)} tilt. ${bullInputs.length > 1 ? `${bullInputs.length} bullish voices` : 'The only bullish voice'} argue the current price understates the opportunity.`
    : 'Bull case: There is currently no meaningful bullish signal from any analyst worker.';

  const bearMessage = bearInputs.length
    ? `Bear case: ${bearInputs[0].analyst} leads with a ${Math.round(bearInputs[0].score)} tilt against. ${bearInputs.length > 1 ? `${bearInputs.length} bearish voices` : 'The only bearish voice'} argue downside is being under-priced.`
    : 'Bear case: There is currently no meaningful bearish signal from any analyst worker.';

  debate.push({ speaker: 'bull', stance: 'bullish', label: 'Bull Researcher', message: bullMessage, points: Math.round(clamp(bullShare, 0, 100)) });
  debate.push({ speaker: 'bear', stance: 'bearish', label: 'Bear Researcher', message: bearMessage, points: Math.round(clamp(bearShare, 0, 100)) });

  const net = bullStrength - bearStrength;
  const judgeBias: AgentBias = net > 20 ? 'bullish' : net < -20 ? 'bearish' : 'neutral';
  const judgeMessage = judgeBias === 'bullish'
    ? `Judge ruling: the bull thesis outweighs the bear ($net=${net.toFixed(1)}). Verdict leans bullish.`
    : judgeBias === 'bearish'
      ? `Judge ruling: the bear thesis outweighs the bull (net=${net.toFixed(1)}). Verdict leans bearish.`
      : `Judge ruling: the debate is a toss-up (net=${net.toFixed(1)}). Verdict stays neutral.`;

  debate.push({ speaker: 'judge', stance: judgeBias, label: 'Debate Judge', message: judgeMessage, points: Math.round(clamp(Math.abs(net), 0, 100)) });

  return debate;
}

// --- Trader Agent ------------------------------------------------------------
function traderAgent(research: ResearchPreview, debate: DebateEntry[], deps: EngineDeps, condition: MarketCondition | null): TraderPlan {
  const judge = debate[debate.length - 1];
  const bullPts = debate.find((d) => d.speaker === 'bull')?.points ?? 0;
  const bearPts = debate.find((d) => d.speaker === 'bear')?.points ?? 0;
  const drift = judge.stance === 'bullish' ? 1 : judge.stance === 'bearish' ? -1 : 0;

  const volFactor = condition ? condition.volatilityPercentile / 100 : 0.5;
  const volAdj = (1 - volFactor) * 0.4; // lower vol -> wider bands (in %)

  let action: TraderPlan['action'] = 'HOLD';
  if (drift > 0 && bullPts > 45) action = 'BUY';
  else if (drift < 0 && bearPts > 45) action = 'SELL';

  const ATR_LIKE = deps.historical.length > 20
    ? deps.historical.slice(-20).reduce((acc, d) => acc + (d.high - d.low), 0) / 20
    : deps.price * 0.03;
  const unit = ATR_LIKE;

  // Trader confidence from research consensus + judge clarity + analyst conf
  const clarity = Math.abs(drift) * 40;
  const confidence = Math.round(clamp(research.consensusConfidence * 0.5 + clarity + (action === 'HOLD' ? 15 : 10), 30, 95));

  let entry = deps.price;
  let stopLoss = deps.price;
  let takeProfit = deps.price;
  if (action === 'BUY') {
    entry = deps.price;
    stopLoss = deps.price - unit * 1.6;
    takeProfit = deps.price + unit * 2.6;
  } else if (action === 'SELL') {
    entry = deps.price;
    stopLoss = deps.price + unit * 1.6;
    takeProfit = deps.price - unit * 2.6;
  }

  const rationale = action === 'BUY'
    ? `Trader decision: BUY. The debate judge sided ${judge.stance} and the bull camp out-scored the bear (${bullPts} vs ${bearPts}). Entry ${entry.toFixed(2)}, stop ${stopLoss.toFixed(2)}, target ${takeProfit.toFixed(2)}.`
    : action === 'SELL'
      ? `Trader decision: SELL. The debate judge sided ${judge.stance} and the bear camp out-scored the bull (${bearPts} vs ${bullPts}). No long position warranted.`
      : `Trader decision: HOLD. The debate failed to resolve (judge: ${judge.stance}); not enough conviction to act.`;

  return { action, confidence, entry: +entry.toFixed(2), stopLoss: +stopLoss.toFixed(2), takeProfit: +takeProfit.toFixed(2), rationale };
}

// --- Risk Management (aggressive / conservative / neutral debate) ------------
function riskDebate(traderPlan: TraderPlan, deps: EngineDeps, condition: MarketCondition | null): RiskVerdict[] {
  const vol = condition ? condition.volatilityPercentile : 50;
  const drawdown = drawdownPct(deps.historical, deps.price);
  const isHold = traderPlan.action === 'HOLD';
  const isSell = traderPlan.action === 'SELL';

  // Each persona weighs volatility + drawdown differently.
  const aggressive = evaluateRisk('Aggressive', vol, drawdown, 0.75, 0.25, isHold, isSell);
  const neutral = evaluateRisk('Neutral', vol, drawdown, 0.5, 0.5, isHold, isSell);
  const conservative = evaluateRisk('Conservative', vol, drawdown, 0.25, 0.75, isHold, isSell);

  return [aggressive, neutral, conservative];
}

function evaluateRisk(
  persona: RiskPersona,
  vol: number,
  drawdown: number,
  volWeight: number,
  ddWeight: number,
  isHold: boolean,
  isSell: boolean,
): RiskVerdict {
  const riskScore = clamp(vol * volWeight + drawdown * ddWeight, 0, 100);
  const riskLevel: RiskVerdict['riskLevel'] = riskScore > 70 ? 'high' : riskScore > 40 ? 'medium' : 'low';

  // Persona tolerance thresholds
  const tolerance = persona === 'Aggressive' ? 85 : persona === 'Neutral' ? 65 : 48;
  const allowed = isHold || isSell ? true : riskScore <= tolerance;

  // Max position weight shrinks as risk grows; aggressive tolerates more.
  const baseWeight = persona === 'Aggressive' ? 0.4 : persona === 'Neutral' ? 0.25 : 0.15;
  const maxWeight = allowed ? Math.round(clamp(baseWeight * (1 - riskScore / 200), 0.05, baseWeight) * 100) : 0;

  const reason = isHold
    ? `${persona} risk debater: standing pat — HOLD carries no new exposure, so it is allowed at tiny size.`
    : isSell
      ? `${persona} risk debater: reducing exposure is always permitted.`
      : allowed
        ? `${persona} risk debater: permits the trade at up to ${maxWeight}% weight given ${riskLevel} risk (score ${Math.round(riskScore)}).`
        : `${persona} risk debater: blocks the trade — ${riskLevel} risk (score ${Math.round(riskScore)}) exceeds ${persona === 'Aggressive' ? 'my' : 'our'} tolerance.`;

  return { persona, allowed, maxWeight, reason, riskLevel };
}

function drawdownPct(historical: StockData[], price: number): number {
  if (!historical.length) return 50;
  const recent = historical.slice(-63);
  const peak = Math.max(...recent.map((d) => d.high));
  return peak > 0 ? clamp((1 - price / peak) * 100, 0, 100) : 50;
}

// --- Portfolio Manager -------------------------------------------------------
function portfolioManager(traderPlan: TraderPlan, risk: RiskVerdict[], deps: EngineDeps, research: ResearchPreview): PortfolioDecision {
  const approvers = risk.filter((r) => r.allowed);
  const blocking = risk.filter((r) => !r.allowed);

  let approved: boolean;
  let action: PortfolioDecision['action'] = traderPlan.action;

  if (traderPlan.action === 'HOLD') {
    approved = true;
  } else {
    // Portfolio manager requires a majority of risk debaters to sign off.
    approved = approvers.length >= 2;
    if (!approved) action = 'HOLD';
  }

  const capWeight = traderPlan.action === 'HOLD'
    ? 0
    : Math.min(...approvers.map((r) => r.maxWeight));
  const positionWeight = traderPlan.action === 'HOLD'
    ? 0
    : Math.round(Math.max(0, capWeight || 0));

  const note = approved
    ? blocking.length
      ? `PM approved the trade (${approvers.length}/3 risk debaters allow it) but ${blocking.length} debater(s) cap total risk — sizing to the least-permissive ${positionWeight}%.`
      : `PM approved the trade — all ${approvers.length} risk debaters allow it. Position capped at ${positionWeight}%.`
    : `PM rejected the trade — only ${approvers.length}/3 risk debaters allow it. Falling back to HOLD.`;

  // The PM's net actionable call (signal) and a qualitative opinion that
  // ties together the trader plan, the risk committee and the final conclusion.
  const signal: PortfolioDecision['signal'] = action;
  const opinion = approved
    ? action === 'BUY'
      ? `The Portfolio Manager sees a favourable risk/reward and an acceptable risk picture. The ${
          blocking.length ? `${blocking.length} dissenting debater(s)` : 'risk committee'
        } keep(s) size conservative, but the direction is constructive. Conclusion: proceed with a ${positionWeight}% position.`
      : action === 'SELL'
        ? `The Portfolio Manager agrees that reducing or avoiding exposure is the right call given the bearish backdrop. Conclusion: stand aside / lighten, no long position.`
        : `The trader's plan was to hold, and the risk committee raised no objection. The Portfolio Manager confirms HOLD with no new capital deployed. Conclusion: maintain current exposure.`
    : `The Portfolio Manager rejects the proposed ${traderPlan.action} because the risk debaters do not provide a majority sign-off. Conclusion: do not initiate; revert to HOLD.`;

  // The persona whose tolerance produced the final (least-permissive) size.
  const capApprover = [...approvers].sort((a, b) => a.maxWeight - b.maxWeight)[0];
  const sizingPersona: RiskPersona = traderPlan.action === 'HOLD' ? 'Neutral' : capApprover?.persona ?? 'Neutral';

  return {
    approved,
    action,
    positionWeight,
    sizingPersona,
    stopLoss: traderPlan.stopLoss,
    takeProfit: traderPlan.takeProfit,
    signal,
    opinion,
    note,
  };
}

// --- Final Decision ----------------------------------------------------------
function finalDecision(analysts: AnalystReport[], research: ResearchPreview, debate: DebateEntry[], traderPlan: TraderPlan, portfolio: PortfolioDecision): TradingAgentsResult['final'] {
  const judge = debate[debate.length - 1];
  const analystScore = analysts.reduce((a, x) => a + x.score, 0) / (analysts.length || 1);
  const net = (judge.stance === 'bullish' ? 60 : judge.stance === 'bearish' ? -60 : 0);
  const drift = traderPlan.action === 'BUY' ? 30 : traderPlan.action === 'SELL' ? -30 : 0;
  const pm = portfolio.approved ? portfolio.positionWeight > 20 ? 15 : 5 : -15;

  const raw = analystScore * 0.5 + net + drift + pm;
  const action = portfolio.action;

  // Map to the 5-tier TradingAgents rating.
  let rating: FinalRating;
  if (action === 'BUY') rating = raw > 45 ? 'Buy' : 'Overweight';
  else if (action === 'SELL') rating = raw < -45 ? 'Sell' : 'Underweight';
  else rating = 'Hold';

  const confidence = Math.round(clamp(40 + Math.min(traderPlan.confidence, 60) + Math.abs(judge.points - 50) * 0.3, 30, 95));

  // Conviction drives the hero scoring bar. It is decoupled from positionWeight
  // (which is risk-capped and not a strength gauge): a strong directional call
  // reads as a full bar regardless of the small risk-derived position size.
  const TIER_BASE: Record<FinalRating, number> = { Buy: 78, Overweight: 62, Hold: 50, Underweight: 38, Sell: 22 };
  const conviction = rating === 'Hold'
    ? 50
    : Math.round(clamp(TIER_BASE[rating] + (confidence - 50) * 0.4, 5, 100));

  return { rating, action, confidence, positionWeight: portfolio.positionWeight, sizingPersona: portfolio.sizingPersona, conviction };
}

// --- Public entry point ------------------------------------------------------
export type StageId = 'analysts' | 'research' | 'debate' | 'trader' | 'risk' | 'portfolio' | 'final';

export interface StageInfo {
  id: StageId;
  label: string;
  status: 'running' | 'done';
  detail?: string;
}

export async function runTradingAgents(
  symbol: string,
  deps: EngineDeps,
  stock: Stock,
  onStage?: (stage: StageInfo) => void,
): Promise<TradingAgentsResult> {
  const symbolUp = symbol.toUpperCase();

  const done = (id: StageId, label: string, detail?: string) => onStage?.({ id, label, status: 'done', detail });
  const run = (id: StageId, label: string, detail?: string) => onStage?.({ id, label, status: 'running', detail });

  run('analysts', 'Analyst Team', 'technical, fundamentals, sentiment and market reports');
  const masters = analyzeStock(symbolUp, {
    price: deps.price,
    previousClose: deps.previousClose,
    volume: deps.volume,
    marketCap: deps.marketCap,
    historical: deps.historical,
  });

  const condition = deps.historical.length >= 100
    ? analyzeMarketConditions(deps.historical)
    : null;
  const liquidity = condition
    ? calculateLiquidityConditions(deps.historical, condition)
    : null;

  const sentimentPromise = fetchSentiment(symbolUp).catch(() => null);
  const forecastPromise = deps.historical.length
    ? Promise.resolve(generateForecast(deps.historical, 30))
    : Promise.resolve<ForecastPoint[]>(null);

  const analysts: AnalystReport[] = [
    technicalAnalyst(deps.historical, deps.price),
    fundamentalsAnalyst(symbolUp, deps, masters),
    sentimentAnalyst(await sentimentPromise),
    marketAnalyst(
      condition ?? {
        regime: 'sideways', regimeScore: 0, volatility: 'medium', volatilityPercentile: 50,
        momentum: 'neutral', rsiValue: 50, trendStrength: 50, priceVsSma: 0, bandwidthPercentile: 50,
      },
      liquidity ?? {
        indicators: [], warningCount: 0, rating: 'normal', ratingLabel: 'Normal',
        actionAdvice: 'Normal conditions.', liquidityScore: 50, synthesis: 'No data.',
      },
    ),
  ];

  done('analysts', 'Analyst Team', `${analysts.length} reports gathered`);

  run('research', 'Research Manager', 'synthesising analyst consensus');
  const researchPreview = researchManager(analysts);
  done('research', 'Research Manager');

  run('debate', 'Researcher Debate', 'bull vs bear with a judge');
  const debate = researcherDebate(researchPreview, analysts, deps);
  done('debate', 'Researcher Debate', `${debate.length} statements`);

  run('trader', 'Trader Agent', 'composing entry / stop / target');
  const traderPlan = traderAgent(researchPreview, debate, deps, condition);
  done('trader', 'Trader Agent', traderPlan.action);

  run('risk', 'Risk Management', 'aggressive / neutral / conservative');
  const risk = riskDebate(traderPlan, deps, condition);
  done('risk', 'Risk Management');

  run('portfolio', 'Portfolio Manager', 'approval and position sizing');
  const portfolio = portfolioManager(traderPlan, risk, deps, researchPreview);
  done('portfolio', 'Portfolio Manager', portfolio.approved ? 'Approved' : 'Rejected');

  run('final', 'Final Decision', '5-tier rating');
  const final = finalDecision(analysts, researchPreview, debate, traderPlan, portfolio);
  done('final', 'Final Decision', final.rating);

  const sentiment = await sentimentPromise;

  return {
    symbol: symbolUp,
    stockName: stock.name,
    sector: stock.sector,
    price: deps.price,
    changePercent: stock.changePercent,
    analysts,
    researchPreview,
    debate,
    traderPlan,
    riskDebate: risk,
    portfolio,
    final,
    marketCondition: condition,
    liquidity,
    sentiment,
    forecast: await forecastPromise,
    generatedAt: new Date().toISOString(),
  };
}
