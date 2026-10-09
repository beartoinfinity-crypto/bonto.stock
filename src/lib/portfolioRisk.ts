/**
 * portfolioRisk.ts — portfolio risk analytics for the /risk screen (the Risk
 * concepts ported from greeksoup into this app's rule-based stack).
 *
 * Input is plain daily close series; everything is deterministic math on real
 * bars — no estimation libraries, no AI/ML.
 *
 * Conventions: daily simple returns, 252 sessions/year, sample covariance
 * (n-1). Weights are normalized to sum to 1 (a book entered as 40/60 and
 * 400/600 have identical shape metrics). Beta and correlation are null only
 * in the degenerate zero-variance case — callers format with null checks.
 * Drawdown percentages are negative (0 = never underwater), matching
 * backtestMetrics.maxDrawdownStats.
 */

import type { StockData } from './stockData';
import { maxDrawdownStats } from './backtestMetrics';

const SESSIONS = 252;

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sampleVariance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

export function sampleStd(xs: number[]): number {
  return Math.sqrt(sampleVariance(xs));
}

/** Daily simple returns; a zero/invalid previous close contributes 0. */
export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    out.push(prev > 0 ? (closes[i] - prev) / prev : 0);
  }
  return out;
}

/** Sample covariance over the common prefix of both series. */
export function sampleCovariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const xs = a.slice(0, n);
  const ys = b.slice(0, n);
  const mx = mean(xs);
  const my = mean(ys);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (xs[i] - mx) * (ys[i] - my);
  return sum / (n - 1);
}

/** Pearson correlation; null when either series is constant. */
export function correlation(a: number[], b: number[]): number | null {
  const sa = sampleStd(a);
  const sb = sampleStd(b);
  if (!(sa > 0) || !(sb > 0)) return null;
  return sampleCovariance(a, b) / (sa * sb);
}

/** Beta vs benchmark (cov / var of the benchmark); null if benchmark is flat. */
export function betaOf(asset: number[], bench: number[]): number | null {
  const vb = sampleVariance(bench);
  if (!(vb > 0)) return null;
  return sampleCovariance(asset, bench) / vb;
}

/** Annualized volatility (fraction) from daily returns. */
export function annualizedVol(returns: number[]): number {
  return sampleStd(returns) * Math.sqrt(SESSIONS);
}

export interface AlignedSeries {
  dates: string[];
  /** one close array per input series, aligned to `dates` (same order) */
  closes: number[][];
}

/**
 * Intersect the date sets of every series and return closes aligned to the
 * common trading dates (ascending). `lookback` keeps only the last N common
 * dates. Returns null when any series is empty or there is no overlap.
 */
export function alignSeries(series: Array<StockData[]>, lookback?: number): AlignedSeries | null {
  if (!series.length || series.some(s => !s || s.length === 0)) return null;
  let common: Set<string> | null = null;
  for (const bars of series) {
    const dates = new Set(bars.map(b => b.date));
    common = common === null ? dates : new Set([...common].filter(d => dates.has(d)));
    if (common.size === 0) return null;
  }
  if (!common || common.size === 0) return null;
  const dates = [...common].sort();
  if (lookback && lookback > 0 && dates.length > lookback) {
    dates.splice(0, dates.length - lookback);
  }
  const maps = series.map(bars => new Map(bars.map(b => [b.date, b.close])));
  return { dates, closes: maps.map(m => dates.map(d => m.get(d) ?? 0)) };
}

/** Normalize raw weights to sum to 1; falls back to equal weights. */
export function normalizeWeights(raw: number[]): number[] {
  if (!raw.length) return [];
  const positives = raw.map(w => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = positives.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return raw.map(() => 1 / raw.length);
  return positives.map(w => w / sum);
}

export interface HoldingRisk {
  symbol: string;
  sector: string;
  weight: number;              // normalized 0..1
  beta: number | null;
  correlation: number | null;
  annualVol: number;           // fraction (0.32 = 32%)
  worstDrawdown: number;       // % (negative or 0)
  totalReturn: number;         // % over the window
}

export interface SectorWeight {
  sector: string;
  weight: number;              // sum of holding weights in this sector (0..1)
}

export interface RiskCurvePoint {
  date: string;
  portfolio: number;           // growth of 100
  benchmark: number;           // growth of 100
}

export interface RiskReport {
  benchmark: string;
  startDate: string;
  endDate: string;
  observations: number;        // aligned sessions
  holdings: HoldingRisk[];
  portfolioReturn: number;     // % over the window
  benchmarkReturn: number;     // % over the window
  portfolioBeta: number | null;
  portfolioCorrelation: number | null;
  portfolioVolatility: number; // annualized fraction
  benchmarkVolatility: number; // annualized fraction
  portfolioMaxDrawdown: number;      // % (negative)
  portfolioDrawdownDuration: number; // sessions underwater
  weightedAvgVolatility: number;     // Σ wᵢσᵢ (fraction)
  diversificationBenefit: number;    // weightedAvg − portfolioVol (fraction)
  /** benchmark −5% → historical portfolio impact (fraction, beta-adjusted) */
  stressBenchmark5pct: number | null;
  sectors: SectorWeight[];     // sorted by weight desc
  sectorHHI: number;           // Herfindahl index of sector shares, 0..1
  curve: RiskCurvePoint[];
}

export interface RiskInput {
  benchmarkSymbol: string;
  benchmarkBars: StockData[];
  holdings: Array<{ symbol: string; sector: string; weight: number; bars: StockData[] }>;
  /** keep only the last N common sessions (default: all) */
  lookback?: number;
  /** minimum aligned sessions required (default 30) */
  minObservations?: number;
}

export interface RiskComputeResult {
  report: RiskReport | null;
  error: string | null;
}

export function computeRiskReport(input: RiskInput): RiskComputeResult {
  const hs = (input.holdings ?? []).filter(h => h && h.bars && h.bars.length > 0);
  if (!hs.length) return { report: null, error: 'No holdings with price history' };
  if (!input.benchmarkBars || input.benchmarkBars.length === 0) {
    return { report: null, error: `No price history for benchmark ${input.benchmarkSymbol}` };
  }

  const aligned = alignSeries([input.benchmarkBars, ...hs.map(h => h.bars)], input.lookback);
  if (!aligned) return { report: null, error: 'Holdings and benchmark share no common trading dates' };

  const minObs = input.minObservations ?? 30;
  if (aligned.dates.length < minObs) {
    return { report: null, error: `Only ${aligned.dates.length} overlapping sessions (need ${minObs})` };
  }

  const benchReturns = dailyReturns(aligned.closes[0]);
  const holdingReturns = hs.map((_, i) => dailyReturns(aligned.closes[i + 1]));
  const weights = normalizeWeights(hs.map(h => h.weight));

  const holdings: HoldingRisk[] = hs.map((h, i) => {
    const closes = aligned.closes[i + 1];
    const rets = holdingReturns[i];
    const first = closes[0];
    const last = closes[closes.length - 1];
    return {
      symbol: h.symbol,
      sector: h.sector || 'Unknown',
      weight: weights[i],
      beta: betaOf(rets, benchReturns),
      correlation: correlation(rets, benchReturns),
      annualVol: annualizedVol(rets),
      worstDrawdown: maxDrawdownStats(closes).maxDrawdown,
      totalReturn: first > 0 ? (last / first - 1) * 100 : 0,
    };
  });

  // Constant-weight portfolio: daily rebalanced blend of holding returns.
  const portReturns = benchReturns.map((_, i) =>
    holdingReturns.reduce((s, rets, j) => s + weights[j] * rets[i], 0),
  );

  const compound = (rets: number[]): number => rets.reduce((acc, r) => acc * (1 + r), 1);
  const portCurve: number[] = [100];
  const benchCurve: number[] = [100];
  let p = 100;
  let b = 100;
  for (const r of portReturns) { p *= 1 + r; portCurve.push(p); }
  for (const r of benchReturns) { b *= 1 + r; benchCurve.push(b); }

  const dd = maxDrawdownStats(portCurve);
  const portVol = annualizedVol(portReturns);
  const weightedAvgVol = holdings.reduce((s, h) => s + h.weight * h.annualVol, 0);
  const portBeta = betaOf(portReturns, benchReturns);

  const sectorMap = new Map<string, number>();
  for (const h of holdings) sectorMap.set(h.sector, (sectorMap.get(h.sector) ?? 0) + h.weight);
  const sectors: SectorWeight[] = [...sectorMap.entries()]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);
  const sectorHHI = sectors.reduce((s, x) => s + x.weight * x.weight, 0);

  const curve: RiskCurvePoint[] = aligned.dates.map((date, i) => ({
    date,
    portfolio: portCurve[i],
    benchmark: benchCurve[i],
  }));

  return {
    report: {
      benchmark: input.benchmarkSymbol,
      startDate: aligned.dates[0],
      endDate: aligned.dates[aligned.dates.length - 1],
      observations: aligned.dates.length,
      holdings,
      portfolioReturn: (compound(portReturns) - 1) * 100,
      benchmarkReturn: (compound(benchReturns) - 1) * 100,
      portfolioBeta: portBeta,
      portfolioCorrelation: correlation(portReturns, benchReturns),
      portfolioVolatility: portVol,
      benchmarkVolatility: annualizedVol(benchReturns),
      portfolioMaxDrawdown: dd.maxDrawdown,
      portfolioDrawdownDuration: dd.duration,
      weightedAvgVolatility: weightedAvgVol,
      diversificationBenefit: weightedAvgVol - portVol,
      stressBenchmark5pct: portBeta !== null ? -0.05 * portBeta : null,
      sectors,
      sectorHHI,
      curve,
    },
    error: null,
  };
}
