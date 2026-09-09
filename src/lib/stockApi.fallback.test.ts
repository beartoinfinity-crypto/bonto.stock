import { describe, it, expect, vi, beforeEach } from 'vitest';

// The fallback chain under test:
//   1. SQLite cache (fresh gate)   2. live Yahoo/Stooq
//   3. Supabase cloud bars         4. stale SQLite cache   5. synthetic
// Mock localDb (sql.js WASM can't load in jsdom) + supabaseHistory + providers.

const localDb = vi.hoisted(() => {
  const store = new Map<string, { rows: Array<Record<string, unknown>>; maxDate: string }>();
  return {
    store,
    getHistorical: vi.fn(async (symbol: string) => {
      const e = store.get(symbol.toUpperCase());
      return e ? e.rows : null;
    }),
    getHistoricalDump: vi.fn(async (symbol: string) => {
      const e = store.get(symbol.toUpperCase());
      return e ? e.rows : null;
    }),
    putHistorical: vi.fn(async (symbol: string, rows: Array<Record<string, unknown>>) => {
      const dates = rows.map(r => String(r.date)).sort();
      store.set(symbol.toUpperCase(), { rows, maxDate: dates[dates.length - 1] });
    }),
    isDailyBarSeriesFresh: vi.fn((lastBarDate: string | null | undefined, now = Date.now()) => {
      if (!lastBarDate) return false;
      const ms = Date.parse(`${lastBarDate}T00:00:00Z`);
      return Number.isFinite(ms) && now - ms <= 4 * 24 * 60 * 60 * 1000;
    }),
    getQuote: vi.fn(async () => null),
    putQuote: vi.fn(async () => {}),
    getMeta: vi.fn(async () => null),
    putMeta: vi.fn(async () => {}),
  };
});

const cloud = vi.hoisted(() => ({
  fetchStoredHistoryForSymbol: vi.fn(async (_symbol: string) => [] as Array<Record<string, unknown>>),
}));

vi.mock('@/lib/localDb', () => localDb);
vi.mock('@/lib/supabaseHistory', () => cloud);

import { fetchHistoricalData } from './stockApi';

// popularStocks[0] drives the synthetic fallback — find a known symbol
const barsFresh = [
  { date: '2026-09-08', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
  { date: '2026-09-09', open: 10.5, high: 11.5, low: 10, close: 11, volume: 100 },
];
const barsStale = [
  { date: '2026-08-27', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
  { date: '2026-08-28', open: 10.5, high: 11.5, low: 10, close: 11, volume: 100 },
];

describe('fetchHistoricalData fallback chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localDb.store.clear();
    // Network is down: live Yahoo/Stooq providers always fail.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
  });

  it('returns fresh SQLite cache without touching the network', async () => {
    localDb.store.set('AAPL', { rows: barsFresh, maxDate: '2026-09-09' });
    localDb.getHistorical.mockImplementationOnce(async () => barsFresh);

    const r = await fetchHistoricalData('AAPL');

    expect(r.fromCache).toBe(true);
    expect(r.isRealData).toBe(true);
    expect(r.data).toEqual(barsFresh as unknown as typeof r.data);
  });

  it('falls back to Supabase cloud bars when live providers fail and cache is stale', async () => {
    // getHistorical returns null (freshness gate rejects Aug-28 series)
    localDb.getHistorical.mockImplementationOnce(async () => null);
    cloud.fetchStoredHistoryForSymbol.mockImplementationOnce(async () => barsFresh);

    const r = await fetchHistoricalData('AAPL');

    expect(r.isRealData).toBe(true);
    expect(r.error).toBeNull();
    expect(cloud.fetchStoredHistoryForSymbol).toHaveBeenCalledWith('AAPL');
    // Cloud bars prime the SQLite cache so later loads are instant
    expect(localDb.putHistorical).toHaveBeenCalled();
  });

  it('reports staleness when even cloud bars are old', async () => {
    localDb.getHistorical.mockImplementationOnce(async () => null);
    cloud.fetchStoredHistoryForSymbol.mockImplementationOnce(async () => barsStale);

    const r = await fetchHistoricalData('AAPL');

    expect(r.isRealData).toBe(true);
    expect(r.error).toContain('2026-08-28');
  });

  it('prefers stale real cache over synthetic bars as the last resort', async () => {
    localDb.getHistorical.mockImplementationOnce(async () => null);
    cloud.fetchStoredHistoryForSymbol.mockImplementationOnce(async () => []);
    localDb.getHistoricalDump.mockImplementationOnce(async () => barsStale);

    const r = await fetchHistoricalData('AAPL');

    expect(r.fromCache).toBe(true);
    expect(r.isRealData).toBe(true);
    expect(r.error).toContain('2026-08-28');
  });

  it('returns synthetic data only when cache, cloud and live all fail', async () => {
    localDb.getHistorical.mockImplementationOnce(async () => null);
    cloud.fetchStoredHistoryForSymbol.mockImplementationOnce(async () => []);
    localDb.getHistoricalDump.mockImplementationOnce(async () => null);

    const r = await fetchHistoricalData('AAPL');

    expect(r.isRealData).toBe(false);
    expect(r.error).toBe('All providers unavailable');
    expect(r.data && r.data.length).toBeGreaterThan(0);
  });
});
