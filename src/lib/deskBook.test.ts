import { describe, it, expect } from 'vitest';
import {
  computeBook,
  upsertPosition,
  removePosition,
  validateLot,
  sortBookRows,
  type BookPosition,
} from './deskBook';

const pos = (id: string, symbol: string, shares: number, costBasis: number): BookPosition =>
  ({ id, symbol, shares, costBasis });

const quote = (price: number, changePercent: number) => ({ ok: true, price, changePercent });

describe('computeBook', () => {
  it('marks positions to market and computes P&L', () => {
    const positions = [pos('1', 'AAPL', 10, 100), pos('2', 'MSFT', 5, 200)];
    const quotes = new Map([
      ['AAPL', quote(120, 2)],
      ['MSFT', quote(180, -1)],
    ]);
    const { rows, totals } = computeBook(positions, quotes);

    expect(rows[0].marketValue).toBe(1200);
    expect(rows[0].costValue).toBe(1000);
    expect(rows[0].unrealizedPnl).toBe(200);
    expect(rows[0].unrealizedPnlPct).toBeCloseTo(20, 10);

    expect(totals.marketValue).toBe(1200 + 900);
    expect(totals.costValue).toBe(1000 + 1000);
    expect(totals.unrealizedPnl).toBeCloseTo(100, 10);
    expect(totals.unrealizedPnlPct).toBeCloseTo(5, 10);
    expect(totals.positions).toBe(2);
    expect(totals.unpriced).toBe(0);
  });

  it("derives each position's day change from its day percent", () => {
    const positions = [pos('1', 'AAPL', 10, 100)];
    const quotes = new Map([['AAPL', quote(120, 10)]]); // +10% → yesterday 109.09…
    const { rows } = computeBook(positions, quotes);
    // mv = 1200, prev = 1200 / 1.10 → day move ≈ 109.09
    expect(rows[0].dayChangeValue).toBeCloseTo(1200 - 1200 / 1.1, 8);
  });

  it('weights sum to 1 across priced positions', () => {
    const positions = [pos('1', 'AAPL', 1, 10), pos('2', 'MSFT', 1, 30)];
    const quotes = new Map([['AAPL', quote(10, 0)], ['MSFT', quote(30, 0)]]);
    const { rows, totals } = computeBook(positions, quotes);
    const wsum = rows.reduce((s, r) => s + r.weight, 0);
    expect(wsum).toBeCloseTo(1, 10);
    expect(rows[1].weight).toBeCloseTo(0.75, 10);
    expect(totals.marketValue).toBe(40);
  });

  it('excludes missing/failed quotes from market value but counts cost and unpriced', () => {
    const positions = [pos('1', 'AAPL', 10, 100), pos('2', 'ZZZ', 4, 50)];
    const quotes = new Map([
      ['AAPL', quote(110, 1)],
      ['ZZZ', { ok: false, price: null, changePercent: null }],
    ]);
    const { rows, totals } = computeBook(positions, quotes);
    expect(rows[1].price).toBeNull();
    expect(rows[1].marketValue).toBe(0);
    expect(totals.marketValue).toBe(1100);
    expect(totals.costValue).toBe(1000 + 200);
    expect(totals.unpriced).toBe(1);
  });

  it('handles an empty book without NaN', () => {
    const { rows, totals } = computeBook([], new Map());
    expect(rows).toEqual([]);
    expect(totals.marketValue).toBe(0);
    expect(totals.unrealizedPnlPct).toBe(0);
    expect(totals.dayChangePct).toBeNull();
  });

  it('never emits NaN for zero cost basis or zero shares', () => {
    const positions = [pos('1', 'AAPL', 0, 0)];
    const quotes = new Map([['AAPL', quote(100, 5)]]);
    const { rows, totals } = computeBook(positions, quotes);
    expect(Number.isFinite(rows[0].unrealizedPnlPct)).toBe(true);
    expect(Number.isFinite(totals.unrealizedPnlPct)).toBe(true);
    expect(Number.isFinite(rows[0].weight)).toBe(true);
  });
});

describe('upsertPosition', () => {
  it('adds a new lot and uppercases the symbol', () => {
    const out = upsertPosition([], { symbol: 'aapl', shares: 10, costBasis: 100 });
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('AAPL');
    expect(out[0].id).toBeTruthy();
  });

  it('merges an existing symbol with a weighted-average cost', () => {
    let book = upsertPosition([], { symbol: 'AAPL', shares: 10, costBasis: 100, id: 'x' });
    book = upsertPosition(book, { symbol: 'AAPL', shares: 30, costBasis: 200 });
    expect(book).toHaveLength(1);
    expect(book[0].shares).toBe(40);
    expect(book[0].costBasis).toBeCloseTo((10 * 100 + 30 * 200) / 40, 10); // 175
    expect(book[0].id).toBe('x');
  });

  it('keeps symbols separate when different', () => {
    let book = upsertPosition([], { symbol: 'AAPL', shares: 1, costBasis: 1 });
    book = upsertPosition(book, { symbol: 'MSFT', shares: 1, costBasis: 2 });
    expect(book).toHaveLength(2);
  });
});

describe('removePosition', () => {
  it('removes by id only', () => {
    const book = [pos('a', 'AAPL', 1, 1), pos('b', 'MSFT', 1, 1)];
    expect(removePosition(book, 'a').map(p => p.symbol)).toEqual(['MSFT']);
    expect(removePosition(book, 'nope')).toHaveLength(2);
  });
});

describe('validateLot', () => {
  it('accepts a valid lot', () => {
    expect(validateLot('AAPL', 10, 100.5)).toBeNull();
  });

  it('rejects missing symbol, non-positive shares, negative cost', () => {
    expect(validateLot('', 10, 1)).toMatch(/Symbol/);
    expect(validateLot('AAPL', 0, 1)).toMatch(/Shares/);
    expect(validateLot('AAPL', NaN, 1)).toMatch(/Shares/);
    expect(validateLot('AAPL', 10, -1)).toMatch(/cost/);
  });
});

describe('sortBookRows', () => {
  const rows = computeBook(
    [pos('1', 'AAPL', 1, 100), pos('2', 'MSFT', 1, 100), pos('3', 'NVDA', 1, 100)],
    new Map([
      ['AAPL', quote(90, -5)],
      ['MSFT', quote(110, 1)],
      ['NVDA', quote(130, 10)],
    ]),
  ).rows;

  it('sorts by market value desc by default', () => {
    expect(sortBookRows(rows, 'value').map(r => r.symbol)).toEqual(['NVDA', 'MSFT', 'AAPL']);
  });

  it('sorts alphabetically by symbol', () => {
    expect(sortBookRows(rows, 'symbol').map(r => r.symbol)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('sorts by day percent desc (unpriced last)', () => {
    expect(sortBookRows(rows, 'day').map(r => r.symbol)).toEqual(['NVDA', 'MSFT', 'AAPL']);
  });

  it('does not mutate the input array', () => {
    const before = rows.map(r => r.symbol);
    sortBookRows(rows, 'symbol');
    expect(rows.map(r => r.symbol)).toEqual(before);
  });
});
