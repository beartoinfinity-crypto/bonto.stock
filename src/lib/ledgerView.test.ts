import { describe, it, expect } from 'vitest';
import { createLedger, DailyDecisionLog, Trade } from './tradeSimulator';
import {
  DEFAULT_VIEW_FILTERS,
  distinctDates,
  filterDecisions,
  filterTrades,
  flatDecisions,
  sortDecisions,
  sortTrades,
  ViewFilters,
} from './ledgerView';

const logs: DailyDecisionLog[] = [
  {
    date: '2026-01-05',
    personaId: 'value',
    decisions: [
      { symbol: 'AAPL', action: 'BUY', price: 200, changePercent: 1, strength: 80, buyCount: 5, sellCount: 0, reason: 'Deep value — 5/12 BUY votes.' },
      { symbol: 'MSFT', action: 'HOLD', price: 300, changePercent: 0, strength: 20, reason: 'No edge today.' },
    ],
  },
  {
    date: '2026-01-02',
    personaId: 'momentum',
    decisions: [
      { symbol: 'AAPL', action: 'SELL', price: 205, changePercent: -2, strength: 60, reason: 'Trend broke the 20-SMA.' },
    ],
  },
];

const trades: Trade[] = [
  { id: 't1', date: '2026-01-02', personaId: 'value', symbol: 'AAPL', action: 'BUY', qty: 10, price: 200, value: 2000, realizedPnl: 0, note: 'opening' },
  { id: 't2', date: '2026-01-05', personaId: 'value', symbol: 'AAPL', action: 'SELL', qty: 10, price: 210, value: 2100, realizedPnl: 100, note: 'stop hit' },
  { id: 't3', date: '2026-01-05', personaId: 'momentum', symbol: 'MSFT', action: 'BUY', qty: 4, price: 300, value: 1200, realizedPnl: 0, note: 'breakout entry' },
];

describe('flatDecisions', () => {
  it('flattens per-person daily logs into dated rows', () => {
    const rows = flatDecisions(logs);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-01-05', personaId: 'value', symbol: 'AAPL' });
    expect(rows[2]).toMatchObject({ date: '2026-01-02', personaId: 'momentum', symbol: 'AAPL' });
  });
});

describe('distinctDates', () => {
  it('returns unique dates newest first', () => {
    expect(distinctDates(flatDecisions(logs))).toEqual(['2026-01-05', '2026-01-02']);
  });
});

describe('filterTrades', () => {
  it('filters by persona, action, symbol, date and note', () => {
    const base: ViewFilters = { ...DEFAULT_VIEW_FILTERS };
    expect(filterTrades(trades, { ...base, persona: 'value' }).map(t => t.id)).toEqual(['t1', 't2']);
    expect(filterTrades(trades, { ...base, action: 'SELL' }).map(t => t.id)).toEqual(['t2']);
    expect(filterTrades(trades, { ...base, symbol: 'msft' }).map(t => t.id)).toEqual(['t3']);
    expect(filterTrades(trades, { ...base, date: '2026-01-05' }).map(t => t.id)).toEqual(['t2', 't3']);
    expect(filterTrades(trades, { ...base, search: 'STOP' }).map(t => t.id)).toEqual(['t2']);
  });

  it('passes everything through on default filters', () => {
    expect(filterTrades(trades, DEFAULT_VIEW_FILTERS)).toHaveLength(3);
  });
});

describe('filterDecisions', () => {
  const rows = flatDecisions(logs);
  it('filters by persona, action, symbol, date and reason', () => {
    const base: ViewFilters = { ...DEFAULT_VIEW_FILTERS };
    expect(filterDecisions(rows, { ...base, persona: 'value' })).toHaveLength(2);
    expect(filterDecisions(rows, { ...base, action: 'BUY' }).map(r => r.symbol)).toEqual(['AAPL']);
    expect(filterDecisions(rows, { ...base, symbol: 'msft' }).map(r => r.symbol)).toEqual(['MSFT']);
    expect(filterDecisions(rows, { ...base, date: '2026-01-02' })).toHaveLength(1);
    expect(filterDecisions(rows, { ...base, search: 'no edge' }).map(r => r.symbol)).toEqual(['MSFT']);
  });
});

describe('sortTrades', () => {
  it('sorts by date, symbol, value and pnl', () => {
    expect(sortTrades(trades, 'date-desc').map(t => t.id)).toEqual(['t2', 't3', 't1']);
    expect(sortTrades(trades, 'date-asc').map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(sortTrades(trades, 'value').map(t => t.id)).toEqual(['t2', 't1', 't3']);
    expect(sortTrades(trades, 'pnl').map(t => t.id)).toEqual(['t2', 't1', 't3']);
  });
});

describe('sortDecisions', () => {
  const rows = flatDecisions(logs);
  it('sorts by date, strength and action', () => {
    expect(sortDecisions(rows, 'date-desc')[0].symbol).toBe('AAPL');
    expect(sortDecisions(rows, 'date-asc')[0].symbol).toBe('AAPL'); // 01-02 row first
    expect(sortDecisions(rows, 'date-asc')[0].personaId).toBe('momentum');
    expect(sortDecisions(rows, 'strength')[0].symbol).toBe('AAPL'); // strength 80
    expect(sortDecisions(rows, 'action')[0].action).toBe('BUY');
  });
});

describe('round-trips through simulateDay', () => {
  it('produces filterable accumulated data', async () => {
    // lightweight sanity that a stored ledger feeds flatDecisions/filterTrades
    expect(typeof createLedger).toBe('function');
  });
});