import { describe, it, expect } from 'vitest';
import { healSameDayConflicts, mergeLedgers } from './ledgerMerge';
import { LedgerStore, PersonaId, STARTING_CASH } from './tradeSimulator';

function makeTrade(id: string, date: string, personaId: PersonaId, symbol: string, action: 'BUY' | 'SELL', qty: number, price: number): LedgerStore['trades'][number] {
  return { id, date, personaId, symbol, action, qty, price, value: Math.round(qty * price * 100) / 100, realizedPnl: action === 'SELL' ? 0 : 0, note: action === 'BUY' ? 'open' : 'exit' };
}

function makeLedger(overrides: Partial<LedgerStore> = {}): LedgerStore {
  return {
    createdAt: '2026-01-02T00:00:00.000Z',
    initialCash: STARTING_CASH,
    accounts: {},
    trades: [],
    lastRunDate: null,
    prices: {},
    decisions: [],
    ...overrides,
  };
}

function decisionsFor(date: string, personaId: PersonaId, symbols: string[], action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD') {
  return {
    date,
    personaId,
    decisions: symbols.map(sym => ({
      symbol: sym,
      action,
      price: 100,
      changePercent: 0,
      strength: 50,
      reason: 'test',
    })),
  };
}

function personaAccounts(empty = {}) {
  return {} as LedgerStore['accounts'];
}

describe('mergeLedgers', () => {
  it('unions trades and decisions from both machines and takes the latest run date', () => {
    const day1 = makeTrade('t1', '2026-01-02', 'value', 'AAPL', 'BUY', 10, 100);
    const day2 = makeTrade('t2', '2026-01-03', 'value', 'MSFT', 'BUY', 5, 200);
    const a = makeLedger({
      trades: [day1],
      decisions: [decisionsFor('2026-01-02', 'value', ['AAPL', 'MSFT'])],
      lastRunDate: '2026-01-02',
      prices: { AAPL: 100, MSFT: 200 },
      accounts: personaAccounts(),
    });
    const b = makeLedger({
      trades: [day2],
      decisions: [decisionsFor('2026-01-03', 'value', ['TSLA'])],
      lastRunDate: '2026-01-03',
      prices: { TSLA: 250 },
      accounts: personaAccounts(),
    });

    const m = mergeLedgers(a, b);
    expect(m.trades.map(t => t.id).sort()).toEqual(['t1', 't2']);
    expect(m.decisions.map(d => `${d.personaId}|${d.date}`).sort())
      .toEqual(['value|2026-01-02', 'value|2026-01-03']);
    expect(m.lastRunDate).toBe('2026-01-03');
    expect(m.createdAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('reveals accounts by replaying the merged fills (no lost buys)', () => {
    const a = makeLedger({
      trades: [makeTrade('t1', '2026-01-02', 'value', 'AAPL', 'BUY', 10, 100)],
      accounts: personaAccounts(),
    });
    const b = makeLedger({
      trades: [makeTrade('t2', '2026-01-03', 'value', 'MSFT', 'BUY', 5, 200)],
      accounts: personaAccounts(),
    });

    const m = mergeLedgers(a, b);
    const acct = m.accounts.value;
    expect(acct.cash).toBe(STARTING_CASH - 1000 - 1000);
    expect(acct.positions.map(p => p.symbol).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('sells reduce cash and remove the position', () => {
    const a = makeLedger({
      trades: [
        makeTrade('t1', '2026-01-02', 'value', 'AAPL', 'BUY', 10, 100),
        makeTrade('t2', '2026-01-05', 'value', 'AAPL', 'SELL', 10, 100),
      ],
      accounts: personaAccounts(),
    });
    const b = makeLedger({ accounts: personaAccounts() });

    const m = mergeLedgers(a, b);
    expect(m.accounts.value.positions).toEqual([]);
    expect(m.accounts.value.cash).toBe(STARTING_CASH);
  });

  it('keeps the fuller decision log when both sides re-ran the same day', () => {
    const a = makeLedger({ decisions: [decisionsFor('2026-01-02', 'contrarian', ['AAPL', 'MSFT', 'TSLA'])], accounts: personaAccounts() });
    const b = makeLedger({ decisions: [decisionsFor('2026-01-02', 'contrarian', ['AAPL'])], accounts: personaAccounts() });

    const m = mergeLedgers(a, b);
    expect(m.decisions).toHaveLength(1);
    expect(m.decisions[0].decisions).toHaveLength(3);
  });

  it('collapses the same (persona, day, symbol, side) fill from two machines into one', () => {
    const a = makeLedger({
      trades: [makeTrade('mA1', '2026-01-03', 'value', 'AAPL', 'BUY', 10, 100)],
      accounts: personaAccounts(),
    });
    const b = makeLedger({
      trades: [makeTrade('mB1', '2026-01-03', 'value', 'AAPL', 'BUY', 11, 95)],
      accounts: personaAccounts(),
    });

    const m = mergeLedgers(a, b);
    // One canonical fill (the larger value: 11 × 95 = 1045 > 10 × 100 = 1000)
    expect(m.trades).toHaveLength(1);
    expect(m.trades[0].id).toBe('mB1');
    // Replayed once — no double-spend
    expect(m.accounts.value.cash).toBe(STARTING_CASH - 11 * 95);
    expect(m.accounts.value.positions).toHaveLength(1);
  });

  it('is idempotent', () => {
    const a = makeLedger({
      trades: [makeTrade('t1', '2026-01-02', 'tactical', 'NVDA', 'BUY', 3, 300)],
      decisions: [decisionsFor('2026-01-02', 'tactical', ['NVDA'], 'BUY')],
      lastRunDate: '2026-01-02',
      prices: { NVDA: 300 },
      accounts: personaAccounts(),
    });

    const m = mergeLedgers(a, JSON.parse(JSON.stringify(a)));
    // A merged ledger merged with itself must be unchanged (accounts rebuilt once).
    expect(mergeLedgers(m, JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('uses the prices snapshot of the side with the latest run', () => {
    const a = makeLedger({ lastRunDate: '2026-01-02', prices: { AAPL: 100, MSFT: 200 }, accounts: personaAccounts() });
    const b = makeLedger({ lastRunDate: '2026-01-03', prices: { AAPL: 101, TSLA: 250 }, accounts: personaAccounts() });

    const m = mergeLedgers(a, b);
    expect(m.prices).toEqual({ AAPL: 101, TSLA: 250 });
  });

  it('heals a same-day buy+sell with conflicting prices (keeps the buy)', () => {
    // Corruption from two same-day runs: bought AAPL @316.85, "sold" @178.72.
    const a = makeLedger({
      trades: [makeTrade('buy1', '2026-09-02', 'value', 'AAPL', 'BUY', 30, 316.85)],
      accounts: personaAccounts(),
    });
    const b = makeLedger({
      trades: [makeTrade('sell1', '2026-09-02', 'value', 'AAPL', 'SELL', 30, 178.72)],
      accounts: personaAccounts(),
    });

    const m = mergeLedgers(a, b);
    // The rogue same-day sell is dropped; the correct buy survives.
    expect(m.trades).toHaveLength(1);
    expect(m.trades[0]).toMatchObject({ action: 'BUY', id: 'buy1', price: 316.85 });
    // Replaying keeps the position instead of selling it at the bogus price.
    expect(m.accounts.value.positions).toHaveLength(1);
    expect(m.accounts.value.positions[0].avgCost).toBe(316.85);
  });

  it('keeps a same-day buy+sell pair whose prices agree', () => {
    const a = makeLedger({
      trades: [
        makeTrade('b1', '2026-09-02', 'agent', 'AAPL', 'BUY', 10, 100),
        makeTrade('s1', '2026-09-02', 'agent', 'AAPL', 'SELL', 10, 100),
      ],
      accounts: personaAccounts(),
    });

    // Merge with an empty side so the pair survives union untouched.
    const m = mergeLedgers(a, makeLedger({ accounts: personaAccounts() }));
    expect(m.trades).toHaveLength(2);
  });

  it('healSameDayConflicts is a pure no-op when prices agree', () => {
    const trades = [
      makeTrade('b1', '2026-09-02', 'agent', 'AAPL', 'BUY', 10, 100),
      makeTrade('s1', '2026-09-02', 'agent', 'AAPL', 'SELL', 10, 100),
    ];
    expect(healSameDayConflicts(trades)).toEqual(trades);
  });
});