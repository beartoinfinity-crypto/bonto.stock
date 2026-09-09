import { describe, it, expect, vi } from 'vitest';

// localDb initializes sql.js (WASM) at import time, which aborts under jsdom.
// Mock the WASM loader so the pure staleness gate can be tested directly.
vi.mock('sql.js', () => ({
  default: vi.fn(async () => { throw new Error('wasm not loaded in tests'); }),
}));

import { isDailyBarSeriesFresh, HISTORICAL_BAR_STALENESS_DAYS } from './localDb';

const DAY = 24 * 60 * 60 * 1000;

describe('isDailyBarSeriesFresh', () => {
  const now = Date.parse('2026-09-09T12:00:00Z');

  it('accepts a bar from the latest trading day (yesterday)', () => {
    expect(isDailyBarSeriesFresh('2026-09-08', now)).toBe(true);
  });

  it('accepts a Friday bar viewed on a Monday holiday (long weekend, ~3.5 days)', () => {
    // Mon 2026-09-07 is Labor Day — the newest bar is Friday 2026-09-04
    const mondayNoon = Date.parse('2026-09-07T12:00:00Z');
    expect(isDailyBarSeriesFresh('2026-09-04', mondayNoon)).toBe(true);
  });

  it('rejects a Friday bar still showing the following Wednesday (sync failed)', () => {
    // Wed 2026-09-09 noon: the Friday 2026-09-04 bar is now 4.5 days old
    expect(isDailyBarSeriesFresh('2026-09-04', now)).toBe(false);
  });

  it('rejects the Aug-28 style stale series that froze the price chart', () => {
    expect(isDailyBarSeriesFresh('2026-08-28', now)).toBe(false);
  });

  it('rejects missing/invalid dates', () => {
    expect(isDailyBarSeriesFresh(null, now)).toBe(false);
    expect(isDailyBarSeriesFresh(undefined, now)).toBe(false);
    expect(isDailyBarSeriesFresh('', now)).toBe(false);
    expect(isDailyBarSeriesFresh('not-a-date', now)).toBe(false);
  });

  it('uses the documented 4-day window exactly', () => {
    // 4 days back = 2026-09-05T12:00Z minus bar midnight normalization
    // (bar parsed at midnight, now at noon -> effective tolerance +12h)
    const edgeOld = new Date(now - HISTORICAL_BAR_STALENESS_DAYS * DAY - 2 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const edgeNew = new Date(now - (HISTORICAL_BAR_STALENESS_DAYS - 1) * DAY)
      .toISOString().slice(0, 10);
    expect(isDailyBarSeriesFresh(edgeOld, now)).toBe(false);
    expect(isDailyBarSeriesFresh(edgeNew, now)).toBe(true);
  });

  it('defaults now to the current clock', () => {
    // A bar dated today is always fresh regardless of clock
    expect(isDailyBarSeriesFresh(new Date().toISOString().slice(0, 10))).toBe(true);
  });
});
