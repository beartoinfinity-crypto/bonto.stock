import { describe, it, expect } from 'vitest';
import {
  analyzeStock,
  summarizeMasterResult,
  rankByScore,
  filterToSP500,
  filterToNASDAQ100,
  filterStocksByUniverse,
  NASDAQ100_TICKERS,
  SP500_TICKERS,
  MASTER_ORDER,
  buildStockInput,
} from './masterAnalysis';
import { generateHistoricalData, popularStocks, Stock } from './stockData';

const aapl = popularStocks.find(s => s.symbol === 'AAPL')!;

function buildInput(stock: Stock, overrides?: Partial<{ historical: ReturnType<typeof generateHistoricalData> }>) {
  const input = buildStockInput(stock, overrides?.historical ?? generateHistoricalData(stock.price));
  return input;
}

describe('masterAnalysis', () => {
  it('returns all 12 masters in canonical order for a stock', () => {
    const input = buildInput(aapl);
    const masters = analyzeStock('AAPL', input);
    expect(masters).toHaveLength(12);
    expect(masters.map(m => m.id)).toEqual(MASTER_ORDER);
  });

  it('every master verdict is one of the valid enum values', () => {
    const input = buildInput(aapl);
    const valid = ['BUY', 'HOLD', 'SELL', 'AVOID', 'WATCH'];
    for (const m of analyzeStock('AAPL', input)) {
      expect(valid).toContain(m.verdict);
    }
  });

  it('summarizeMasterResult computes buy count, avg confidence and score', () => {
    const input = buildInput(aapl);
    const masters = analyzeStock('AAPL', input);
    const summary = summarizeMasterResult('AAPL', aapl, aapl.price, 1.33, masters);
    expect(summary.buyCount).toBe(masters.filter(m => m.verdict === 'BUY').length);
    expect(summary.avgConfidence).toBeGreaterThan(0);
    expect(summary.avgConfidence).toBeLessThanOrEqual(100);
    expect(summary.symbol).toBe('AAPL');
    expect(summary.analyses).toHaveLength(12);
  });

  it('rankByScore sorts highest-scoring stock first', () => {
    const mk = (symbol: string, buyCount: number) => ({
      symbol, name: symbol, sector: 'x', price: 1, changePercent: 0,
      analyses: [], buyCount, avgConfidence: 70, score: buyCount * 10 + 7,
    });
    const ranked = [mk('B', 2), mk('A', 8)].sort(rankByScore);
    expect(ranked[0].symbol).toBe('A');
  });

  it('filterToSP500 only keeps genuine constituents and excludes non-SP500 names', () => {
    const stocks = popularStocks;
    const filtered = filterToSP500(stocks.map(s => ({ symbol: s.symbol })));
    expect(filtered.some(f => f.symbol === 'AAPL')).toBe(true);
    expect(filtered.some(f => f.symbol === 'TSM')).toBe(false);
    expect(filtered.some(f => f.symbol === 'COKE')).toBe(false);
    expect(filtered.some(f => f.symbol === 'SOFI')).toBe(false);
    for (const f of filtered) {
      expect(SP500_TICKERS.has(f.symbol)).toBe(true);
    }
  });

  it('filterToNASDAQ100 keeps constituents and excludes non-NDX names', () => {
    const stocks = popularStocks.map(s => ({ symbol: s.symbol }));
    const filtered = filterToNASDAQ100(stocks);
    expect(filtered.some(f => f.symbol === 'AAPL')).toBe(true);
    expect(filtered.some(f => f.symbol === 'NVDA')).toBe(true);
    // Financials/energy/industrials/REITs are S&P-only, not Nasdaq-100
    expect(filtered.some(f => f.symbol === 'JPM')).toBe(false);
    expect(filtered.some(f => f.symbol === 'XOM')).toBe(false);
    expect(filtered.some(f => f.symbol === 'GE')).toBe(false);
    // Nasdaq-100 membership present in popularStocks
    expect(filtered.some(f => f.symbol === 'COIN' || f.symbol === 'MSTR' || f.symbol === 'ARM')).toBe(true);
    for (const f of filtered) {
      expect(NASDAQ100_TICKERS.has(f.symbol)).toBe(true);
    }
  });

  it('filterStocksByUniverse dispatches on universe id', () => {
    const stocks = popularStocks.map(s => ({ symbol: s.symbol }));
    const sp = filterStocksByUniverse(stocks, 'sp500');
    const ndx = filterStocksByUniverse(stocks, 'nasdaq100');
    const all = filterStocksByUniverse(stocks, 'all');
    expect(sp.every(f => SP500_TICKERS.has(f.symbol))).toBe(true);
    expect(ndx.every(f => NASDAQ100_TICKERS.has(f.symbol))).toBe(true);
    expect(all).toHaveLength(stocks.length);
  });

  it('buildStockInput parses marketCap strings into numbers', () => {
    const input = buildStockInput({ ...aapl, marketCap: '2.8T' }, []);
    expect(input.marketCap).toBe(2.8e12);
  });

  it('fundamental masters refuse to invent valuation when P/E is missing', () => {
    // No P/E data → Greenblatt and Lynch must not fabricate a BUY off today's
    // price change. They return WATCH with an explicit "no P/E data" signal.
    const input = { ...buildInput(aapl), pe: undefined };
    const masters = analyzeStock('AAPL', input);
    const greenblatt = masters.find(m => m.id === 'greenblatt')!;
    const lynch = masters.find(m => m.id === 'peter-lynch')!;
    const buffett = masters.find(m => m.id === 'buffett-graham')!;

    expect(greenblatt.verdict).toBe('WATCH');
    expect(greenblatt.metrics.some(m => m.value === 'n/a')).toBe(true);
    expect(greenblatt.risks.join(' ')).toMatch(/no P\/E data/i);
    expect(lynch.verdict).toBe('WATCH');
    expect(lynch.metrics.some(m => m.value === 'n/a')).toBe(true);
    // Buffett's P/E metric also reads n/a without valuation data.
    expect(buffett.metrics.some(m => m.label === 'P/E' && m.value === 'n/a')).toBe(true);
  });

  it('fundamental masters use real P/E when provided (no single-day-change formulas)', () => {
    const input = { ...buildInput(aapl), pe: 25 };
    const masters = analyzeStock('AAPL', input);
    const greenblatt = masters.find(m => m.id === 'greenblatt')!;
    const lynch = masters.find(m => m.id === 'peter-lynch')!;
    const buffett = masters.find(m => m.id === 'buffett-graham')!;

    const earningsYield = greenblatt.metrics.find(m => m.label.includes('Earnings Yield'))!;
    expect(earningsYield.value).toBe('4.0%'); // 1/25
    // Metrics no longer claim fake "ROC" or bare relative-strength PEG.
    expect(greenblatt.metrics.some(m => m.label === 'ROC Est.')).toBe(false);
    expect(lynch.metrics.some(m => m.label === 'PEG (est.)')).toBe(true);
    expect(buffett.metrics.some(m => m.label === 'P/E' && m.value === '25.0')).toBe(true);
  });
});
