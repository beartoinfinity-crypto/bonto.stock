import { describe, it, expect } from 'vitest';
import {
  createLedger,
  runDayForPerson,
  accountEquity,
  personaPnl,
  buildDecisionLog,
  appendHistory,
  dailyPnlSeries,
  STARTING_CASH,
  POSITION_FRACTION,
  valueDecision,
  wealthDecision,
  invertedWealthDecision,
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
  it('valueDecision buys on BUY-leaning consensus', () => {
    const s = valueDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 27.5, buyCount: 2, sellCount: 1 });
    expect(s.action).toBe('BUY');
  });

  it('valueDecision holds on weak consensus', () => {
    const s = valueDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 0, buyCount: 0, sellCount: 1 });
    expect(s.action).toBe('HOLD');
  });

  it('wealthDecision needs a clear majority of buy votes', () => {
    const hold = wealthDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 27.5, buyCount: 2, sellCount: 1 });
    expect(hold.action).toBe('HOLD');
    const buy = wealthDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 60, buyCount: 5, sellCount: 1 });
    expect(buy.action).toBe('BUY');
  });

  it('invertedWealthDecision fades Eleanor exactly (mirror bars)', () => {
    // Eleanor BUY bar: >=35% BUY votes -> Rosalind SELLs the same row
    const eleanorBuy = { symbol: 'AAPL', price: 200, changePercent: 1, score: 60, buyCount: 5, sellCount: 1 };
    expect(wealthDecision(eleanorBuy).action).toBe('BUY');
    expect(invertedWealthDecision(eleanorBuy).action).toBe('SELL');

    // Eleanor SELL bar: >=5 SELL/AVOID -> Rosalind BUYs the same row
    const eleanorSell = { symbol: 'TSLA', price: 200, changePercent: -2, score: 5, buyCount: 1, sellCount: 6 };
    expect(wealthDecision(eleanorSell).action).toBe('SELL');
    expect(invertedWealthDecision(eleanorSell).action).toBe('BUY');

    // Between the bars: both HOLD
    const mid = { symbol: 'MSFT', price: 200, changePercent: 0, score: 20, buyCount: 2, sellCount: 2 };
    expect(wealthDecision(mid).action).toBe('HOLD');
    expect(invertedWealthDecision(mid).action).toBe('HOLD');
  });

  it('contrarianDecision buys names the consensus hates', () => {
    const s = contrarianDecision({ symbol: 'AAPL', price: 200, changePercent: -4, score: 2, buyCount: 1, sellCount: 6 });
    expect(s.action).toBe('BUY');
  });

  it('momentumDecision buys strong score + uptrend only', () => {
    const up = momentumDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 27.5, buyCount: 2, sellCount: 1 }, true);
    expect(up.action).toBe('BUY');
    const down = momentumDecision({ symbol: 'AAPL', price: 200, changePercent: 1, score: 27.5, buyCount: 2, sellCount: 1 }, false);
    expect(down.action).toBe('SELL');
  });

  it('agentDecision buys on Buy/Overweight rating only', () => {
    expect(agentDecision({ symbol: 'AAPL', price: 200, rating: 'Buy', conviction: 80 }).action).toBe('BUY');
    expect(agentDecision({ symbol: 'AAPL', price: 200, rating: 'Hold', conviction: 50 }).action).toBe('HOLD');
    expect(agentDecision({ symbol: 'AAPL', price: 200, rating: 'Sell', conviction: 20 }).action).toBe('SELL');
  });
});

describe('tradeSimulator — decision log', () => {
  it('buildDecisionLog records every evaluated symbol incl. HOLDs', () => {
    const d: PersonaDaySignals = {
      date: '2025-01-02',
      personaId: 'value',
      buySignals: [{ symbol: 'AAPL', price: 200, changePercent: 1, action: 'BUY', strength: 70, reason: 'consensus' }],
      watch: [
        { symbol: 'AAPL', price: 200, changePercent: 1, action: 'BUY', strength: 70, reason: 'consensus' },
        { symbol: 'MSFT', price: 300, changePercent: 0, action: 'HOLD', strength: 0, reason: 'No signal evaluated' },
      ],
    };
    const log = buildDecisionLog(d);
    expect(log.date).toBe('2025-01-02');
    expect(log.personaId).toBe('value');
    expect(log.decisions).toHaveLength(2);
    // BUY signal is preferred over the bare HOLD placeholder for the same symbol.
    const aapl = log.decisions.find(x => x.symbol === 'AAPL');
    expect(aapl?.action).toBe('BUY');
    expect(aapl?.price).toBe(200);
    expect(aapl?.reason).toBe('consensus');
    expect(log.decisions.find(x => x.symbol === 'MSFT')?.action).toBe('HOLD');
  });
});

describe('tradeSimulator — daily performance history', () => {
  it('appendHistory records one equity snapshot per day and unions by date', () => {
    const ledger = createLedger();
    const accounts = { ...ledger.accounts };
    // value persona spent 10k on a position now worth 11k -> equity 101k
    accounts.value = {
      personaId: 'value', cash: 90_000, lastRunDate: '2026-01-02',
      positions: [{ symbol: 'AAPL', qty: 100, avgCost: 100, stop: null, target: null }],
    };
    const prices = { AAPL: 110 };

    const h1 = appendHistory(ledger, '2026-01-02', accounts, prices);
    expect(h1).toHaveLength(1);
    expect(h1[0].date).toBe('2026-01-02');
    expect(h1[0].equity.value).toBe(101_000); // 90k cash + 100 * 110

    // every persona gets an entry (all hold starting cash)
    expect(h1[0].equity.agent).toBe(STARTING_CASH);

    // a second day replaces nothing, just appends
    const h2 = appendHistory({ ...ledger, history: h1 }, '2026-01-03', accounts, { AAPL: 105 });
    expect(h2.map(x => x.date)).toEqual(['2026-01-02', '2026-01-03']);

    // re-recording the SAME date replaces that day's entry (re-run semantics)
    const h3 = appendHistory({ ...ledger, history: h2 }, '2026-01-03', accounts, { AAPL: 120 });
    expect(h3).toHaveLength(2);
    expect(h3[1].equity.value).toBe(102_000); // 90k + 100*120
  });

  it('dailyPnlSeries computes day-over-day equity deltas', () => {
    const history = [
      { date: '2026-01-02', equity: { value: 100_500 }, prices: {} },
      { date: '2026-01-03', equity: { value: 101_200 }, prices: {} },
      { date: '2026-01-06', equity: { value: 100_900 }, prices: {} },
    ];
    const series = dailyPnlSeries(history, 'value', STARTING_CASH);
    expect(series.map(s => s.date)).toEqual(['2026-01-02', '2026-01-03', '2026-01-06']);
    expect(series[0].pnl).toBe(500);       // 100.5k - 100k starting
    expect(series[1].pnl).toBe(700);       // 101.2k - 100.5k
    expect(series[2].pnl).toBe(-300);      // 100.9k - 101.2k
  });

  it('dailyPnlSeries skips days without the persona recorded', () => {
    const history = [
      { date: '2026-01-02', equity: { value: 100_500 }, prices: {} },
      { date: '2026-01-03', equity: { agent: 100_000 }, prices: {} }, // no value entry
      { date: '2026-01-04', equity: { value: 101_000 }, prices: {} },
    ];
    const series = dailyPnlSeries(history, 'value', STARTING_CASH);
    expect(series.map(s => s.date)).toEqual(['2026-01-02', '2026-01-04']);
    expect(series[1].pnl).toBe(500); // 101k - 100.5k (delta over the gap)
  });
});
