import { describe, expect, it } from 'vitest';
import {
  formatMacroDelta,
  formatMacroValue,
  MACRO_CATEGORIES,
  MACRO_SERIES,
  parseObservations,
  summarize,
  windowPoints,
} from './macro';

describe('MACRO_SERIES', () => {
  it('has 12 unique series across the advertised categories', () => {
    expect(MACRO_SERIES.length).toBe(12);
    expect(new Set(MACRO_SERIES.map(s => s.id)).size).toBe(12);
    expect(MACRO_SERIES.every(s => MACRO_CATEGORIES.includes(s.category))).toBe(true);
    expect(MACRO_SERIES.every(s => s.name && s.blurb && s.unit)).toBe(true);
  });

  it('has no whitespace in ids (they go into a URL)', () => {
    expect(MACRO_SERIES.every(s => /^[A-Z][A-Z0-9]{1,19}$/.test(s.id))).toBe(true);
  });
});

describe('parseObservations', () => {
  it('converts strings to numbers and "." to null', () => {
    const points = parseObservations([
      { date: '2026-01-02', value: '4.31' },
      { date: '2026-01-03', value: '.' },
      { date: '2026-01-01', value: '4.10' },
    ]);
    expect(points).toEqual([
      { date: '2026-01-01', value: 4.1 },
      { date: '2026-01-02', value: 4.31 },
      { date: '2026-01-03', value: null },
    ]);
  });

  it('drops malformed rows and non-arrays', () => {
    expect(parseObservations([{ date: 'nope', value: '1' }, { value: '1' }])).toEqual([]);
    expect(parseObservations('garbage')).toEqual([]);
    expect(parseObservations(undefined)).toEqual([]);
  });

  it('keeps numeric inputs as-is', () => {
    expect(parseObservations([{ date: '2026-01-01', value: 5 }])[0].value).toBe(5);
  });
});

describe('summarize', () => {
  it('reports latest, year-ago comparison, and both deltas', () => {
    const points = parseObservations([
      { date: '2024-09-30', value: '4.00' },
      { date: '2025-10-07', value: '4.50' },
      { date: '2026-10-08', value: '5.00' },
    ]);
    const stat = summarize(points);
    expect(stat.latest).toBe(5);
    expect(stat.latestDate).toBe('2026-10-08');
    expect(stat.yearAgo).toBe(4.5);       // newest point ≤ 2025-10-08
    expect(stat.yoyChange).toBeCloseTo(0.5);
    expect(stat.yoyPct).toBeCloseTo((0.5 / 4.5) * 100);
  });

  it('returns nulls when there is no year-ago data', () => {
    const stat = summarize(parseObservations([{ date: '2026-10-08', value: '3.0' }]));
    expect(stat.latest).toBe(3);
    expect(stat.yearAgo).toBeNull();
    expect(stat.yoyChange).toBeNull();
    expect(stat.yoyPct).toBeNull();
  });

  it('returns all nulls for an empty series', () => {
    const stat = summarize([]);
    expect(stat.latest).toBeNull();
    expect(stat.yoyChange).toBeNull();
  });

  it('does not compute a percent from a zero base', () => {
    const points = parseObservations([
      { date: '2025-01-01', value: '0' },
      { date: '2026-01-01', value: '2' },
    ]);
    const stat = summarize(points);
    expect(stat.yoyChange).toBe(2);
    expect(stat.yoyPct).toBeNull();
  });
});

describe('windowPoints', () => {
  const points = parseObservations([
    { date: '2018-01-01', value: '1' },
    { date: '2025-01-01', value: '2' },
    { date: '2026-10-08', value: '3' },
  ]);

  it('keeps only points inside the trailing window', () => {
    expect(windowPoints(points, 730, '2026-10-08').map(p => p.date))
      .toEqual(['2025-01-01', '2026-10-08']);
    expect(windowPoints(points, 365, '2026-10-08').map(p => p.date))
      .toEqual(['2026-10-08']);
    expect(windowPoints(points, 3650, '2026-10-08')).toHaveLength(3);
  });
});

describe('formatters', () => {
  const meta = MACRO_SERIES[0]; // DFF: 2 digits, unit %
  it('formats values with unit rules', () => {
    expect(formatMacroValue(meta, 4.31)).toBe('4.31%');
    expect(formatMacroValue(meta, null)).toBe('—');
    expect(formatMacroValue({ ...meta, unit: '$', digits: 2 }, 78.5)).toBe('$78.50');
    expect(formatMacroValue({ ...meta, unit: 'K', digits: 0 }, 221000)).toBe('221,000K');
    expect(formatMacroValue({ ...meta, unit: 'pp', digits: 2 }, -0.45)).toBe('-0.45 pp');
    expect(formatMacroValue({ ...meta, unit: 'idx', digits: 2 }, 17.4)).toBe('17.40');
  });

  it('formats signed deltas', () => {
    expect(formatMacroDelta(meta, 0.25)).toBe('+0.25%');
    expect(formatMacroDelta(meta, -0.25)).toBe('−0.25%');
    expect(formatMacroDelta(meta, 0)).toBe('0.00%');
    expect(formatMacroDelta(meta, null)).toBe('—');
    expect(formatMacroDelta({ ...meta, unit: '$', digits: 2 }, -1.5)).toBe('−$1.50');
  });
});
