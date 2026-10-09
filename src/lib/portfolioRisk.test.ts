import { describe, it, expect } from 'vitest';
import type { StockData } from './stockData';
import {
  dailyReturns,
  sampleStd,
  sampleCovariance,
  correlation,
  betaOf,
  annualizedVol,
  alignSeries,
  normalizeWeights,
  computeRiskReport,
} from './portfolioRisk';

function dateAt(i: number): string {
  return new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
}

function barsFromCloses(closes: number[], offset = 0): StockData[] {
  return closes.map((close, i) => ({
    date: dateAt(i + offset),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000_000,
  }));
}

/** Geometric series with a fixed daily return r. */
function trend(n: number, r: number, start = 100): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + r));
  return out;
}

/** Deterministic pseudo-random walk (no flakiness, realistic sign changes). */
function walk(n: number, seed: number, drift = 0.0004, vol = 0.01): number[] {
  const out = [100];
  let s = seed;
  for (let i = 1; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const u = s / 2147483648; // [0,1)
    const shock = (u - 0.5) * 2 * vol;
    out.push(out[i - 1] * (1 + drift + shock));
  }
  return out;
}

describe('dailyReturns', () => {
  it('computes percent changes between consecutive closes', () => {
    expect(dailyReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });

  it('treats a zero/invalid previous close as 0 instead of Infinity', () => {
    expect(dailyReturns([0, 50, 50])).toEqual([0, 0]);
  });

  it('returns [] for fewer than two closes', () => {
    expect(dailyReturns([])).toEqual([]);
    expect(dailyReturns([100])).toEqual([]);
  });
});

describe('sample statistics', () => {
  it('sampleStd uses n-1 denominator', () => {
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });

  it('sampleCovariance is zero for independent-ish constant shifts', () => {
    expect(sampleCovariance([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(sampleCovariance([1], [2])).toBe(0);
  });
});

describe('correlation', () => {
  it('is 1 for perfectly correlated series and -1 for inverted ones', () => {
    const a = [1, 2, 3, 4, 5];
    expect(correlation(a, a)).toBeCloseTo(1, 10);
    expect(correlation(a, a.map(x => -x))).toBeCloseTo(-1, 10);
  });

  it('is null when a series is constant', () => {
    expect(correlation([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe('betaOf', () => {
  it('is 2 when returns are exactly double the benchmark', () => {
    const bench = dailyReturns(walk(60, 5, 0.0005, 0.01));
    let c = 100;
    const assetCloses = [100];
    for (const r of bench) { c *= 1 + 2 * r; assetCloses.push(c); }
    const asset = dailyReturns(assetCloses);
    expect(betaOf(asset, bench)).toBeCloseTo(2, 8);
  });

  it('is null when the benchmark is flat', () => {
    expect(betaOf([0.01, -0.02], [0, 0, 0])).toBeNull();
  });
});

describe('annualizedVol', () => {
  it('scales daily sample std by sqrt(252)', () => {
    const rets = [0.01, -0.01, 0.02, -0.02, 0];
    expect(annualizedVol(rets)).toBeCloseTo(sampleStd(rets) * Math.sqrt(252), 10);
  });

  it('is 0 for a single observation', () => {
    expect(annualizedVol([0.01])).toBe(0);
  });
});

describe('alignSeries', () => {
  it('intersects dates across series and aligns closes', () => {
    const a = barsFromCloses([10, 20, 30, 40]);
    const b = barsFromCloses([1, 2, 3, 4], 2); // dates 2..5 — overlap on 2,3
    const aligned = alignSeries([a, b]);
    expect(aligned).not.toBeNull();
    expect(aligned!.dates).toEqual([dateAt(2), dateAt(3)]);
    expect(aligned!.closes[0]).toEqual([30, 40]);
    expect(aligned!.closes[1]).toEqual([1, 2]);
  });

  it('lookback keeps only the last N common dates', () => {
    const a = barsFromCloses(trend(10, 0.01));
    const b = barsFromCloses(trend(10, -0.005));
    const aligned = alignSeries([a, b], 4);
    expect(aligned!.dates.length).toBe(4);
    expect(aligned!.dates[0]).toBe(dateAt(6));
  });

  it('returns null on no overlap, empty input, or empty series', () => {
    expect(alignSeries([])).toBeNull();
    expect(alignSeries([[], barsFromCloses([1, 2])])).toBeNull();
    const a = barsFromCloses([10, 20]);
    const b = barsFromCloses([1, 2], 10);
    expect(alignSeries([a, b])).toBeNull();
  });
});

describe('normalizeWeights', () => {
  it('normalizes positive weights to sum 1', () => {
    const w = normalizeWeights([40, 60]);
    expect(w[0]).toBeCloseTo(0.4, 10);
    expect(w[1]).toBeCloseTo(0.6, 10);
  });

  it('falls back to equal weights when all are zero/negative/NaN', () => {
    expect(normalizeWeights([0, 0])).toEqual([0.5, 0.5]);
    expect(normalizeWeights([-1, -2])).toEqual([0.5, 0.5]);
    expect(normalizeWeights([NaN, 0])).toEqual([0.5, 0.5]);
  });

  it('drops zero weights when others are positive', () => {
    const w = normalizeWeights([0, 1, 3]);
    expect(w).toEqual([0, 0.25, 0.75]);
  });
});

describe('computeRiskReport', () => {
  const n = 120;
  const benchCloses = walk(n, 7, 0.0005, 0.008);
  const holdCloses = [walk(n, 11, 0.0008, 0.014), walk(n, 23, -0.0002, 0.01)];
  const holdings = [
    { symbol: 'AAA', sector: 'Technology', weight: 40, bars: barsFromCloses(holdCloses[0]) },
    { symbol: 'BBB', sector: 'Energy', weight: 60, bars: barsFromCloses(holdCloses[1]) },
  ];
  const benchmarkBars = barsFromCloses(benchCloses);

  it('computes a full report with aligned window and normalized weights', () => {
    const { report, error } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars,
      holdings,
    });
    expect(error).toBeNull();
    expect(report).not.toBeNull();
    expect(report!.benchmark).toBe('SPY');
    expect(report!.observations).toBe(n);
    expect(report!.startDate).toBe(dateAt(0));
    expect(report!.endDate).toBe(dateAt(n - 1));

    const wsum = report!.holdings.reduce((s, h) => s + h.weight, 0);
    expect(wsum).toBeCloseTo(1, 10);
    expect(report!.holdings[0].weight).toBeCloseTo(0.4, 10);

    expect(report!.portfolioVolatility).toBeGreaterThan(0);
    expect(report!.portfolioMaxDrawdown).toBeLessThanOrEqual(0);
    expect(report!.portfolioBeta).not.toBeNull();
    expect(report!.portfolioCorrelation).not.toBeNull();
    expect(report!.curve.length).toBe(n);
    expect(report!.curve[0].portfolio).toBe(100);
    expect(report!.curve[0].benchmark).toBe(100);
  });

  it('groups sector weights and returns a valid HHI', () => {
    const { report } = computeRiskReport({ benchmarkSymbol: 'SPY', benchmarkBars, holdings });
    expect(report!.sectors).toHaveLength(2);
    expect(report!.sectors[0].sector).toBe('Energy');
    expect(report!.sectors[0].weight).toBeCloseTo(0.6, 10);
    expect(report!.sectorHHI).toBeGreaterThan(0.5);
    expect(report!.sectorHHI).toBeLessThanOrEqual(1);
  });

  it('links the 5% benchmark stress line to portfolio beta', () => {
    const { report } = computeRiskReport({ benchmarkSymbol: 'SPY', benchmarkBars, holdings });
    expect(report!.stressBenchmark5pct).toBeCloseTo(-0.05 * report!.portfolioBeta!, 10);
  });

  it('keeps the last N sessions when lookback is set', () => {
    const { report } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars,
      holdings,
      lookback: 30,
    });
    expect(report!.observations).toBe(30);
    expect(report!.startDate).toBe(dateAt(n - 30));
  });

  it('errors when there are no holdings', () => {
    const { report, error } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars,
      holdings: [],
    });
    expect(report).toBeNull();
    expect(error).toMatch(/No holdings/);
  });

  it('errors when the benchmark has no history', () => {
    const { report, error } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars: [],
      holdings,
    });
    expect(report).toBeNull();
    expect(error).toMatch(/benchmark SPY/);
  });

  it('errors when overlap is below minObservations', () => {
    const shortHold = [{ symbol: 'AAA', sector: 'Tech', weight: 1, bars: barsFromCloses([100, 101, 102], 0) }];
    const { report, error } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars,
      holdings: shortHold,
      minObservations: 30,
    });
    expect(report).toBeNull();
    expect(error).toMatch(/overlapping sessions/);
  });

  it('errors when holdings and benchmark share no dates', () => {
    const far = barsFromCloses(trend(40, 0.01), 500);
    const { report, error } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars,
      holdings: [{ symbol: 'ZZZ', sector: 'Tech', weight: 1, bars: far }],
    });
    expect(report).toBeNull();
    expect(error).toMatch(/common trading dates/);
  });

  it('uses equal weights when every weight is zero', () => {
    const { report } = computeRiskReport({
      benchmarkSymbol: 'SPY',
      benchmarkBars,
      holdings: holdings.map(h => ({ ...h, weight: 0 })),
    });
    expect(report!.holdings[0].weight).toBeCloseTo(0.5, 10);
    expect(report!.holdings[1].weight).toBeCloseTo(0.5, 10);
  });

  it('is deterministic across runs (same input, same output)', () => {
    const a = computeRiskReport({ benchmarkSymbol: 'SPY', benchmarkBars, holdings });
    const b = computeRiskReport({ benchmarkSymbol: 'SPY', benchmarkBars, holdings });
    expect(a.report).toEqual(b.report);
  });

  it('diversification benefit = weighted avg vol − portfolio vol', () => {
    const { report } = computeRiskReport({ benchmarkSymbol: 'SPY', benchmarkBars, holdings });
    const expectDiff = report!.weightedAvgVolatility - report!.portfolioVolatility;
    expect(report!.diversificationBenefit).toBeCloseTo(expectDiff, 10);
  });
});
