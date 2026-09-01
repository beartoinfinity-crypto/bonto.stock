import { describe, it, expect } from 'vitest';
import {
  createLedger,
  runDayForPerson,
  accountEquity,
  personaPnl,
  STARTING_CASH,
  POSITION_FRACTION,
  valueDecision,
  wealthDecision,
  contrarianDecision,
  momentumDecision,
  agentDecision,
  PersonaDaySignals,
  PersonAccount,
  Position,
} from './tradeSimulator';
import { PERSONAS } from './tradeSimulator';

function acct(over: Partial<PersonAccount> = {}): PersonAccount {
  return {
    personaId: 'value',
    cash: STARTING_CASH,
    positions: [],
    lastRunDate: null,
    ...over,
  };
}

function day(personaId = 'value', over: Partial<PersonaDaySignals> = {}): PersonaDaySignals {
  return {
    date: '2025-01-02',
    personaId: personaId as PersonaDaySignals['personaId'],
    buySignals: [],
    watch: [],
    ...over,
  };
}

describe('tradeSimulator — money model', () => {
  it('createLedger gives every persona starting cash', () => {
    const l = createLedger();
    expect(Object.keys(l.accounts)).toHaveLength(PERSONAS.length);
    for (const p of PERSONAS) expect(l.accounts[p.id].cash).toBe(STARTING_CASH);
    expect(l.trades).toEqual([]);
  });

  it('opens a long position on a BUY signal with ~10% equity sizing', () => {
    const a = acct();
    const d = day('value', {
      buySignals: [{ symbol: 'AAPL', price: 200, changePercent: 1, action: 'BUY', strength: 70 }],
      watch: [{ symbol: 'AAPL', price: 200, changePercent: 1, action: 'BUY', strength: 70 }],
    });
    const { account, trades } = runDayForPerson(a, d);
    expect(trades).toHaveLength(1);
    expect(trades[0].action).toBe('BUY');
    const qty = Math.floor((STARTING_CASH * POSITION_FRACTION) / 200);
    expect(account.positions).toHaveLength(1);
    expect(account.positions[0].qty).toBe(qty);
    expect(account.positions[0].avgCost).toBe(200);
    expect(account.cash).toBeCloseTo(STARTING_CASH - 200 * qty, 0);
  });

  it('does not buy a symbol already held (no doubling up)', () => {
    const a = acct({
      positions: [{ symbol: 'AAPL', qty: 10, avgCost: 200, stop: 184, target: 260 } as Position],
      cash: STARTING_CASH,
    });
    const d = day('value', {
      buySignals: [{ symbol: 'AAPL', price: 220, changePercent: 2, action: 'BUY', strength: 70 }],
      watch: [{ symbol: 'AAPL', price: 220, changePercent: 2, action: 'BUY', strength: 70 }],
    });
    const { trades } = runDayForPerson(a, d);
    expect(trades.filter(t => t.action === 'BUY')).toHaveLength(0);
  });

  it('sells a position when the signal flips to SELL', () => {
    const a = acct({
      positions: [{ symbol: 'AAPL', qty: 10, avgCost: 200, stop: 184, target: 260 } as Position],
      cash: 80000,
    });
    const d = day('value', {
      buySignals: [],
      watch: [{ symbol: 'AAPL', price: 210, changePercent: -1, action: 'SELL', strength: 20 }],
    });
    const { account, trades } = runDayForPerson(a, d);
    expect(trades).toHaveLength(1);
    expect(trades[0].action).toBe('SELL');
    expect(trades[0].realizedPnl).toBeCloseTo((210 - 200) * 10, 0);
    expect(account.positions).toHaveLength(0);
    expect(account.cash).toBeCloseTo(80000 + 210 * 10, 0);
  });

  it('sells a position when stop-loss is hit', () => {
    const a = acct({
      positions: [{ symbol: 'AAPL', qty: 10, avgCost: 200, stop: 184, target: 260 } as Position],
      cash: 80000,
    });
    const d = day('value', {
      buySignals: [],
      watch: [{ symbol: 'AAPL', price: 183, changePercent: -3, action: 'HOLD', strength: 0 }],
    });
    const { trades } = runDayForPerson(a, d);
    expect(trades).toHaveLength(1);
    expect(trades[0].action).toBe('SELL');
    expect(trades[0].note).toContain('stop-loss');
  });

  it('sells a position when take-profit is hit', () => {
    const a = acct({
      positions: [{ symbol: 'AAPL', qty: 10, avgCost: 200, stop: 184, target: 260 } as Position],
      cash: 80000,
    });
    const d = day('value', {
      buySignals: [],
      watch: [{ symbol: 'AAPL', price: 261, changePercent: 4, action: 'HOLD', strength: 0 }],
    });
    const { trades } = runDayForPerson(a, d);
    expect(trades).toHaveLength(1);
    expect(trades[0].note).toContain('take-profit');
  });

  it('accountEquity marks positions to the given prices', () => {
    const a = acct({
      cash: 50000,
      positions: [{ symbol: 'AAPL', qty: 10, avgCost: 100, stop: 92, target: 130 } as Position],
    });
    expect(accountEquity(a, { AAPL: 150 })).toBe(50000 + 10 * 150);
    expect(personaPnl(a, { AAPL: 150 })).toBe(50000 + 10 * 150 - STARTING_CASH);
  });
});

describe('tradeSimulator — persona decisions', () => {
  it('valueDecision buys on strong BUY consensus', () => {
    const s = valueDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 60, buyCount: 6, sellCount: 1 });
    expect(s.action).toBe('BUY');
  });

  it('valueDecision holds on weak consensus', () => {
    const s = valueDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 10, buyCount: 1, sellCount: 1 });
    expect(s.action).toBe('HOLD');
  });

  it('wealthDecision needs ~60% buy votes', () => {
    const hold = wealthDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 40, buyCount: 5, sellCount: 2 });
    expect(hold.action).toBe('HOLD');
    const buy = wealthDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 60, buyCount: 8, sellCount: 1 });
    expect(buy.action).toBe('BUY');
  });

  it('contrarianDecision buys names the consensus hates', () => {
    const s = contrarianDecision({ symbol: 'AAPL', price: 200, changePercent: -4, score: 2, buyCount: 1, sellCount: 6 });
    expect(s.action).toBe('BUY');
  });

  it('momentumDecision buys strong score + uptrend only', () => {
    const up = momentumDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 45, buyCount: 6, sellCount: 1 }, true);
    expect(up.action).toBe('BUY');
    const down = momentumDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 45, buyCount: 6, sellCount: 1 }, false);
    expect(down.action).toBe('SELL');
  });

  it('agentDecision buys on Buy/Overweight rating only', () => {
    expect(agentDecision({ symbol: 'AAPL', price: 200, rating: 'Buy', conviction: 80 }).action).toBe('BUY');
    expect(agentDecision({ symbol: 'AAPL', price: 200, rating: 'Hold', conviction: 50 }).action).toBe('HOLD');
    expect(agentDecision({ symbol: 'AAPL', price: 200, rating: 'Sell', conviction: 20 }).action).toBe('SELL');
  });
});
