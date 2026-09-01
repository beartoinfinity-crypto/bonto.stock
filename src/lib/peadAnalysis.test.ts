import { describe, it, expect } from 'vitest';
import {
  parseQuarterEnd,
  daysBetween,
  classifySurprise,
  surpriseToConviction,
  toPEADEvents,
  computePEAD,
  type QuarterlyEarnings,
} from './peadAnalysis';

describe('parseQuarterEnd', () => {
  it('parses 1Q/2Q/3Q/4Q labels to the last day of the quarter', () => {
    expect(parseQuarterEnd('1Q2024')).toBe('2024-03-31');
    expect(parseQuarterEnd('2Q2024')).toBe('2024-06-30');
    expect(parseQuarterEnd('3Q2024')).toBe('2024-09-30');
    expect(parseQuarterEnd('4Q2024')).toBe('2024-12-31');
  });

  it('parses the Q<num> <year> and <num>Q<year> variants', () => {
    expect(parseQuarterEnd('Q2 2024')).toBe('2024-06-30');
    expect(parseQuarterEnd('1Q2023')).toBe('2023-03-31');
    expect(parseQuarterEnd('Q4 2024')).toBe('2024-12-31');
  });

  it('returns null for unparseable labels', () => {
    expect(parseQuarterEnd('')).toBeNull();
    expect(parseQuarterEnd('x')).toBeNull();
    expect(parseQuarterEnd('5Q2024')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('computes the distance between ISO dates', () => {
    expect(daysBetween('2024-01-01', '2024-01-10')).toBe(9);
    expect(daysBetween('2024-03-31', '2024-05-15')).toBe(45);
  });
});

describe('classifySurprise', () => {
  it('classifies above/below the ±1% band as BEAT/MISS', () => {
    expect(classifySurprise(5)).toBe('BEAT');
    expect(classifySurprise(-5)).toBe('MISS');
  });

  it('treats small surprises and null as INLINE', () => {
    expect(classifySurprise(0.5)).toBe('INLINE');
    expect(classifySurprise(0)).toBe('INLINE');
    expect(classifySurprise(null)).toBe('INLINE');
  });

  it('respects a custom inline band', () => {
    expect(classifySurprise(3, 4)).toBe('INLINE');
    expect(classifySurprise(5, 4)).toBe('BEAT');
  });
});

describe('surpriseToConviction', () => {
  it('maps a surprise % into [-1, +1] proportional to 25%', () => {
    expect(surpriseToConviction(0)).toBe(0);
    expect(surpriseToConviction(25)).toBe(1);
    expect(surpriseToConviction(12.5)).toBeCloseTo(0.5);
    expect(surpriseToConviction(-25)).toBe(-1);
  });

  it('clamps beyond the full-conviction point', () => {
    expect(surpriseToConviction(100)).toBe(1);
    expect(surpriseToConviction(-999)).toBe(-1);
  });

  it('returns 0 for null/non-finite', () => {
    expect(surpriseToConviction(null)).toBe(0);
  });
});

describe('computePEAD', () => {
  const quarterly: QuarterlyEarnings[] = [
    { period: '1Q2024', actual: 1.1, estimate: 1.0, surprise: 0.1, surprisePercent: 10 },
    { period: '2Q2024', actual: 1.2, estimate: 1.1, surprise: 0.1, surprisePercent: 9.09 },
    { period: '3Q2024', actual: 0.95, estimate: 1.0, surprise: -0.05, surprisePercent: -5 },
  ];

  it('forms a fresh bullish view from the most recent BEAT within the window', () => {
    // 2Q2024 (BEAT, +9.09%) ended 2024-06-30; asOf 10 days later is within the 45-day window
    const res = computePEAD('ACME', quarterly, '2024-07-10');
    expect(res.recentEvent?.period).toBe('2Q2024');
    expect(res.direction).toBe('BEAT');
    expect(res.signal).toBeGreaterThan(0);
    expect(res.windowOpen).toBe(true);
  });

  it('chooses the most recent qualifying event and respects the window', () => {
    // asOf just after the 3Q (MISS) end -> the MISS is the driver
    const res = computePEAD('ACME', quarterly, '2024-10-05');
    expect(res.recentEvent?.period).toBe('3Q2024');
    expect(res.direction).toBe('MISS');
    expect(res.signal).toBeLessThan(0);
    expect(res.windowOpen).toBe(true);
  });

  it('reports a stale window when the latest event is old', () => {
    // asOf well after the last quarter (beyond windowDays)
    const res = computePEAD('ACME', quarterly, '2025-04-01');
    expect(res.windowOpen).toBe(false);
    expect(res.direction).toBe('MISS');
  });

  it('abstains (0, NO_VIEW) when every quarter is inline or there is no data', () => {
    const res = computePEAD('X', [], '2024-06-01');
    expect(res.direction).toBe('NO_VIEW');
    expect(res.signal).toBe(0);
    expect(res.history).toEqual([]);

    const inline: QuarterlyEarnings[] = [
      { period: '1Q2024', actual: 1.0, estimate: 1.0, surprise: 0, surprisePercent: 0 },
    ];
    const res2 = computePEAD('X', inline, '2024-06-01');
    expect(res2.direction).toBe('NO_VIEW');
    expect(res2.signal).toBe(0);
  });

  it('sorts history chronologically', () => {
    const res = computePEAD('ACME', quarterly, '2024-10-05');
    expect(res.history.map((h) => h.period)).toEqual(['1Q2024', '2Q2024', '3Q2024']);
  });

  it('toPEADEvents filters out missing actual/estimate pairs', () => {
    const mixed: QuarterlyEarnings[] = [
      { period: '1Q2024', actual: 1.0, estimate: 1.0, surprise: 0, surprisePercent: 0 },
      { period: '2Q2024', actual: null, estimate: 1.0, surprise: null, surprisePercent: null },
    ];
    expect(toPEADEvents(mixed)).toHaveLength(1);
  });
});
