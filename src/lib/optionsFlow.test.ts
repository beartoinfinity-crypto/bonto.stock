import { describe, expect, it } from 'vitest';
import {
  chainRows,
  contractsFor,
  expectedMove,
  listExpiries,
  maxPainStrike,
  nearestExpiry,
  oiWalls,
  parseTape,
  putCallRatios,
  ratioVerdict,
  unusualActivity,
  type OptionQuote,
  type OptionsTape,
} from './optionsFlow';

function q(partial: Partial<OptionQuote>): OptionQuote {
  return {
    expiry: '2026-11-20',
    strike: 100,
    type: 'C',
    bid: 0,
    ask: 0,
    last: 0,
    volume: 0,
    oi: 0,
    iv: null,
    delta: null,
    ...partial,
  };
}

function tape(contracts: OptionQuote[]): OptionsTape {
  return {
    symbol: 'TEST',
    price: 100,
    priceChangePercent: 1,
    iv30: 26,
    timestamp: '2026-10-08T16:00:00',
    contracts,
  };
}

describe('parseTape', () => {
  it('maps compact wire rows into typed quotes', () => {
    const parsed = parseTape({
      symbol: 'AAPL',
      price: 340.6,
      priceChangePercent: 1.11,
      iv30: 26.5,
      timestamp: '2026-10-08T16:00:00',
      contracts: [{ e: '2026-11-20', k: 340, t: 'C', b: 5.1, a: 5.3, l: 5.2, v: 10, o: 20, i: 0.26, d: 0.55 }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.symbol).toBe('AAPL');
    expect(parsed!.price).toBe(340.6);
    expect(parsed!.contracts).toHaveLength(1);
    expect(parsed!.contracts[0]).toEqual({
      expiry: '2026-11-20',
      strike: 340,
      type: 'C',
      bid: 5.1,
      ask: 5.3,
      last: 5.2,
      volume: 10,
      oi: 20,
      iv: 0.26,
      delta: 0.55,
    });
  });

  it('drops malformed rows and rejects non-arrays', () => {
    const parsed = parseTape({
      contracts: [
        { e: '2026-11-20', k: 100, t: 'X' },   // bad type
        { k: 100, t: 'C' },                    // missing expiry
        { e: '2026-11-20', t: 'P' },           // missing strike
        { e: '2026-11-20', k: 100, t: 'P', v: 5 },
      ],
    });
    expect(parsed!.contracts).toHaveLength(1);
    expect(parsed!.contracts[0].type).toBe('P');
    expect(parseTape({})).toBeNull();
    expect(parseTape(null as never)).toBeNull();
  });

  it('defaults missing numerics to 0 and NaN to null', () => {
    const parsed = parseTape({
      contracts: [{ e: '2026-11-20', k: 100, t: 'C', i: NaN, d: NaN }],
    });
    expect(parsed!.contracts[0].bid).toBe(0);
    expect(parsed!.contracts[0].iv).toBeNull();
    expect(parsed!.contracts[0].delta).toBeNull();
  });
});

describe('expiries', () => {
  const t = tape([
    q({ expiry: '2026-11-20', strike: 100 }),
    q({ expiry: '2026-12-18', strike: 100 }),
    q({ expiry: '2026-11-20', strike: 105 }),
  ]);

  it('lists unique sorted expiries', () => {
    expect(listExpiries(t)).toEqual(['2026-11-20', '2026-12-18']);
  });

  it('picks the nearest expiry on/after today', () => {
    expect(nearestExpiry(t, '2026-10-08')).toBe('2026-11-20');
    expect(nearestExpiry(t, '2026-11-25')).toBe('2026-12-18');
    expect(nearestExpiry(t, '2027-01-01')).toBe('2026-12-18'); // all past → last
    expect(nearestExpiry(tape([]), '2026-10-08')).toBeNull();
  });

  it('filters contracts by expiry', () => {
    expect(contractsFor(t, '2026-12-18')).toHaveLength(1);
  });
});

describe('chainRows', () => {
  it('pairs calls and puts per strike, ascending', () => {
    const rows = chainRows([
      q({ strike: 105, type: 'P' }),
      q({ strike: 100, type: 'C' }),
      q({ strike: 105, type: 'C' }),
      q({ strike: 100, type: 'P' }),
    ]);
    expect(rows.map(r => r.strike)).toEqual([100, 105]);
    expect(rows[0].call?.type).toBe('C');
    expect(rows[0].put?.type).toBe('P');
    expect(rows[1].call?.strike).toBe(105);
  });
});

describe('putCallRatios', () => {
  it('computes volume and OI ratios', () => {
    const r = putCallRatios([
      q({ type: 'C', volume: 100, oi: 300 }),
      q({ type: 'C', volume: 100, oi: 100 }),
      q({ type: 'P', volume: 50, oi: 400 }),
    ]);
    expect(r.byVolume).toBeCloseTo(0.25);   // 50/200
    expect(r.byOi).toBeCloseTo(1);          // 400/400
    expect(r.callVolume).toBe(200);
    expect(r.putVolume).toBe(50);
  });

  it('returns null when the call side is empty', () => {
    const r = putCallRatios([q({ type: 'P', volume: 10, oi: 10 })]);
    expect(r.byVolume).toBeNull();
    expect(r.byOi).toBeNull();
  });

  it('verdict thresholds', () => {
    expect(ratioVerdict(1.3)).toBe('bearish');
    expect(ratioVerdict(0.6)).toBe('bullish');
    expect(ratioVerdict(0.95)).toBe('neutral');
    expect(ratioVerdict(null)).toBeNull();
  });
});

describe('oiWalls', () => {
  it('finds the highest-OI strike per side and ignores zero OI', () => {
    const walls = oiWalls([
      q({ type: 'C', strike: 100, oi: 500 }),
      q({ type: 'C', strike: 110, oi: 900 }),
      q({ type: 'C', strike: 120, oi: 0 }),
      q({ type: 'P', strike: 90, oi: 700 }),
      q({ type: 'P', strike: 95, oi: 300 }),
    ]);
    expect(walls.call).toEqual({ strike: 110, oi: 900 });
    expect(walls.put).toEqual({ strike: 90, oi: 700 });

    const empty = oiWalls([q({ type: 'C', oi: 0 })]);
    expect(empty.call).toBeNull();
    expect(empty.put).toBeNull();
  });
});

describe('maxPainStrike', () => {
  it('finds the strike minimizing total payout (hand-computed)', () => {
    // S=100 → 80, S=105 → 20, S=110 → 125 (see lib docstring math)
    const pain = maxPainStrike([
      q({ strike: 100, type: 'C', oi: 10 }),
      q({ strike: 105, type: 'C', oi: 5 }),
      q({ strike: 105, type: 'P', oi: 8 }),
      q({ strike: 110, type: 'P', oi: 4 }),
    ]);
    expect(pain).toBe(105);
  });

  it('returns null for an empty tape and ignores zero-OI rows', () => {
    expect(maxPainStrike([])).toBeNull();
    expect(maxPainStrike([q({ strike: 100, oi: 0 })])).toBe(100);
  });
});

describe('expectedMove', () => {
  it('prices the ATM straddle at the nearest two-sided strike', () => {
    const em = expectedMove(100, [
      q({ strike: 95, type: 'C', bid: 6, ask: 6.4 }),   // mid 6.2 — farther from spot
      q({ strike: 95, type: 'P', bid: 1, ask: 1.2 }),
      q({ strike: 100, type: 'C', bid: 1.0, ask: 1.4 }), // mid 1.2
      q({ strike: 100, type: 'P', bid: 1.0, ask: 1.4 }), // mid 1.2
      q({ strike: 110, type: 'C', bid: 0.1, ask: 0.2 }),
    ]);
    expect(em).not.toBeNull();
    expect(em!.strike).toBe(100);
    expect(em!.straddleMid).toBeCloseTo(2.4);
    expect(em!.amount).toBeCloseTo(2.04);          // 2.4 × 0.85
    expect(em!.pct).toBeCloseTo(2.04);
    expect(em!.expiry).toBe('2026-11-20');
  });

  it('falls back to last when the market is one-sided', () => {
    const em = expectedMove(100, [
      q({ strike: 100, type: 'C', bid: 0, ask: 0, last: 2 }),
      q({ strike: 100, type: 'P', bid: 1, ask: 3 }),
    ]);
    expect(em!.straddleMid).toBeCloseTo(4); // 2 + 2
  });

  it('returns null without spot, without contracts, or with no usable quote', () => {
    expect(expectedMove(null, [q({})])).toBeNull();
    expect(expectedMove(100, [])).toBeNull();
    expect(expectedMove(100, [q({ strike: 100, type: 'C' })])).toBeNull(); // one-sided
    expect(
      expectedMove(100, [
        q({ strike: 100, type: 'C' }),
        q({ strike: 100, type: 'P' }),
      ]),
    ).toBeNull(); // both unpriced
  });
});

describe('unusualActivity', () => {
  it('keeps volume ≥ 2× OI (or volume with no OI), busiest first', () => {
    const rows = unusualActivity([
      q({ volume: 500, oi: 100, strike: 100 }), // 5× → in
      q({ volume: 30, oi: 100, strike: 101 }),  // 0.3× → out
      q({ volume: 100, oi: 0, strike: 102 }),   // no OI → in
      q({ volume: 0, oi: 50, strike: 103 }),    // no volume → out
      q({ volume: 800, oi: 100, strike: 104 }), // 8× → in, first
    ]);
    expect(rows.map(r => r.quote.strike)).toEqual([104, 100, 102]);
    expect(rows[2].turnover).toBe(Infinity);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      q({ volume: 1000 - i, oi: 1, strike: 90 + i }));
    expect(unusualActivity(many, 5)).toHaveLength(5);
  });
});
