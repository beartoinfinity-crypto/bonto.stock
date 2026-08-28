import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStoredHistory } from './supabaseHistory';

// Mocks fetch so the module can pull paginated stock_price_history rows
// without a real network call.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Two symbols x two dates, delivered across two 1000-cap pages to exercise
// pagination. Only S&P 500 members are kept (COKE is intentionally excluded).
const ALL_ROWS = [
  { symbol: 'AAPL', date: '2026-08-25', open: 100, high: 110, low: 95, close: 105, volume: 1000 },
  { symbol: 'AAPL', date: '2026-08-26', open: 105, high: 115, low: 100, close: 112, volume: 1200 },
  { symbol: 'COKE', date: '2026-08-26', open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { symbol: 'MSFT', date: '2026-08-25', open: 300, high: 310, low: 290, close: 305, volume: 500 },
  { symbol: 'MSFT', date: '2026-08-26', open: 305, high: 320, low: 300, close: 318, volume: 600 },
];

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? 1000);
    const page = ALL_ROWS.slice(offset, offset + limit);
    return { ok: true, json: async () => page };
  });
});

describe('fetchStoredHistory', () => {
  it('groups rows by symbol and sorts ascending by date', async () => {
    const r = await fetchStoredHistory(2);
    expect(r.ok).toBe(true);
    const aapl = r.history.get('AAPL')!;
    expect(aapl.map(b => b.date)).toEqual(['2026-08-25', '2026-08-26']);
    expect(aapl[1].close).toBe(112);
  });

  it('keeps only symbols with a usable bar count', async () => {
    const r = await fetchStoredHistory(2);
    // COKE has only 1 bar in the fixture, so it is filtered out by count, not index
    expect(r.coveredSymbols.sort()).toEqual(['AAPL', 'MSFT']);
    expect(r.history.has('COKE')).toBe(false);
  });

  it('reports total bars and last bar date', async () => {
    const r = await fetchStoredHistory(2);
    expect(r.totalBars).toBe(5); // all fetched bars (AAPL+MSFT+COKE) are counted
    expect(r.lastBarDate).toBe('2026-08-26');
  });

  it('filters out symbols below the minimum bar count', async () => {
    const r = await fetchStoredHistory(5);
    expect(r.ok).toBe(false);
    expect(r.history.size).toBe(0);
  });

  it('paginates across multiple 1000-row pages (hit the limit >1 page)', async () => {
    // Build 1005 AAPL-style rows so the module must request a second page
    const big: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1005; i++) {
      big.push({ symbol: 'NVDA', date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, open: 1, high: 2, low: 1, close: 2, volume: 1 });
    }
    mockFetch.mockImplementation(async (url: string) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 1000);
      const page = big.slice(offset, offset + limit);
      return { ok: true, json: async () => page };
    });
    const r = await fetchStoredHistory(5);
    expect(r.history.get('NVDA')!.length).toBe(1005);
    // offset should have advanced past the first page
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });
});
