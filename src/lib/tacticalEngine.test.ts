/**
 * tacticalEngine.test.ts — unit tests for the pure engine modules.
 * Guards indicator math, entry/exit rules, sizing, kill switch, and replay
 * parity assumptions (replay uses manageExit with minutesHeld = barsHeld × 390).
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARAMS, atr, adx, bollinger, rsi, marketRegime, entrySignal,
  calculatePositionSize, manageExit, buildIcebergPlan, killSwitch,
  runEngine, replayEngine, checkLiquidityAndImbalance, deriveOrderBook,
} from './tacticalEngine';
import { StockData } from './stockData';
import { usesDefaultParams } from '@/hooks/useTacticalHistory';

// Deterministic synthetic series: mild uptrend with enough range for ATR/ADX.
function makeBars(n: number, base = 100): StockData[] {
  const bars: StockData[] = [];
  let close = base;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 2 + (i % 5 === 0 ? 1.5 : -0.3);
    const open = close;
    close = open + drift;
    const high = Math.max(open, close) + 0.8;
    const low = Math.min(open, close) - 0.8;
    bars.push({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open, high, low, close,
      volume: 1_000_000 + (i % 7) * 50_000,
    });
  }
  return bars;
}

describe('indicators', () => {
  it('atr returns positive value for non-empty data', () => {
    const a = atr(makeBars(30), 14);
    expect(a).toBeGreaterThan(0);
    expect(Number.isFinite(a)).toBe(true);
  });

  it('atr returns 0 for empty data', () => {
    expect(atr([], 14)).toBe(0);
  });

  it('adx returns structured result with non-negative adx', () => {
    const r = adx(makeBars(50), 14);
    expect(r.adx).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.plusDI)).toBe(true);
    expect(Number.isFinite(r.minusDI)).toBe(true);
  });

  it('bollinger bands are ordered upper >= middle >= lower', () => {
    const b = bollinger(makeBars(30), 20, 2);
    expect(b.upper).toBeGreaterThanOrEqual(b.middle);
    expect(b.middle).toBeGreaterThanOrEqual(b.lower);
    expect(b.bandwidth).toBeGreaterThanOrEqual(0);
  });

  it('rsi stays within 0..100', () => {
    const r = rsi(makeBars(30), 14);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
  });
});

describe('marketRegime', () => {
  it('classifies into one of the four states', () => {
    const s = marketRegime(makeBars(50), DEFAULT_PARAMS);
    expect(['STRONG_UPTREND', 'STRONG_DOWNTREND', 'SIDEWAYS_TIGHT', 'TRANSITIONING']).toContain(s.state);
  });
});

describe('entrySignal', () => {
  it('returns a check list and either HOLD or a priced entry', () => {
    const data = makeBars(50);
    const regime = marketRegime(data, DEFAULT_PARAMS);
    const book = deriveOrderBook(data);
    const liq = checkLiquidityAndImbalance(book, DEFAULT_PARAMS.minDepth);
    const sig = entrySignal(data, regime, liq.imbalanceRatio, DEFAULT_PARAMS);
    expect(sig.checks.length).toBeGreaterThan(0);
    if (sig.action === 'HOLD') {
      expect(sig.entryPrice).toBeNull();
    } else {
      expect(sig.entryPrice).toBeGreaterThan(0);
      expect(sig.stopLoss).not.toBeNull();
      expect(sig.takeProfit).not.toBeNull();
    }
  });
});

describe('liquidity / order book', () => {
  it('deriveOrderBook produces 5 bid and 5 ask levels', () => {
    const book = deriveOrderBook(makeBars(25));
    expect(book.bids).toHaveLength(5);
    expect(book.asks).toHaveLength(5);
  });

  it('flags extreme imbalance when book is one-sided', () => {
    const book = {
      bids: Array.from({ length: 5 }, (_, i) => ({ price: 100 - i, volume: 1000 })),
      asks: Array.from({ length: 5 }, (_, i) => ({ price: 101 + i, volume: 1 })),
    };
    const r = checkLiquidityAndImbalance(book, 50);
    expect(r.canTrade).toBe(false);
    expect(r.reason).toBe('Extreme_Imbalance');
  });

  it('flags liquidity too low when depth is below floor', () => {
    const book = {
      bids: Array.from({ length: 5 }, (_, i) => ({ price: 100 - i, volume: 2 })),
      asks: Array.from({ length: 5 }, (_, i) => ({ price: 101 + i, volume: 2 })),
    };
    const r = checkLiquidityAndImbalance(book, 50);
    expect(r.canTrade).toBe(false);
    expect(r.reason).toBe('Liquidity_Too_Low');
  });
});

describe('position sizing', () => {
  it('caps final size by liquidity (5% of bid volume)', () => {
    const data = makeBars(50);
    const s = calculatePositionSize(100, 98, data, 100, DEFAULT_PARAMS);
    expect(s.liquidityCap).toBe(5);
    expect(s.finalSize).toBeLessThanOrEqual(5);
    expect(s.cappedBy).toBe('liquidity');
  });

  it('risk budget equals equity × maxRiskPerTrade', () => {
    const s = calculatePositionSize(100, 98, makeBars(50), 1e6, DEFAULT_PARAMS);
    expect(s.riskDollars).toBeCloseTo(DEFAULT_PARAMS.accountEquity * DEFAULT_PARAMS.maxRiskPerTrade);
  });
});

describe('manageExit', () => {
  const data = makeBars(40);

  it('exits on trailing-stop breach for LONG', () => {
    // entry well above current price after a sharp drop → close below trail
    const p = { ...DEFAULT_PARAMS, minutesHeld: 0 };
    const plan = manageExit('LONG', 50, 100, data, p, 45);
    expect(plan.action).toBe('EXIT');
    expect(plan.reason).toBe('Trailing_Stop');
  });

  it('holds when price is above the trail', () => {
    const p = { ...DEFAULT_PARAMS, minutesHeld: 0, accelerator: 0.08 };
    // very tight trail from high accelerator + high extreme
    const plan = manageExit('LONG', 1000, 100, data, p, 50);
    // extreme includes bar highs near ~100, trail = extreme - 0.08*atr*10;
    // 1000 is way above any trail → HOLD
    expect(plan.action).toBe('HOLD');
    expect(plan.reason).toBe('Active');
  });

  it('fires time stop when flat past threshold', () => {
    const price = data[data.length - 1].close;
    const p = { ...DEFAULT_PARAMS, minutesHeld: 60, timeStopMinutes: 30, accelerator: 0.02 };
    const plan = manageExit('LONG', price, price, data, p, price * 0.9);
    expect(plan.action).toBe('EXIT');
    expect(plan.reason).toBe('Time_Stop');
    expect(plan.timeStopArmed).toBe(true);
  });

  it('accelerator grows with minutesHeld', () => {
    const price = data[data.length - 1].close;
    const early = manageExit('LONG', price, price, data, { ...DEFAULT_PARAMS, minutesHeld: 0 }, price * 0.5);
    const late = manageExit('LONG', price, price, data, { ...DEFAULT_PARAMS, minutesHeld: 120 }, price * 0.5);
    expect(late.acceleratorUsed).toBeGreaterThan(early.acceleratorUsed);
  });
});

describe('iceberg plan', () => {
  it('splits size into the configured number of slices', () => {
    const slices = buildIcebergPlan('BUY', 100, 50, DEFAULT_PARAMS);
    expect(slices).toHaveLength(DEFAULT_PARAMS.icebergSlices);
    const sum = slices.reduce((s, x) => s + x.quantity, 0);
    expect(sum).toBe(50);
    expect(slices[0].delaySeconds).toBe(0);
    expect(slices[1].delaySeconds).toBe(8);
  });

  it('single unit → one slice', () => {
    const slices = buildIcebergPlan('SELL', 100, 1, DEFAULT_PARAMS);
    expect(slices).toHaveLength(1);
    expect(slices[0].quantity).toBe(1);
  });
});

describe('kill switch', () => {
  it('triggers below 95% of initial equity', () => {
    expect(killSwitch({ ...DEFAULT_PARAMS, accountEquity: 94_000, initialEquity: 100_000 }).triggered).toBe(true);
    expect(killSwitch({ ...DEFAULT_PARAMS, accountEquity: 96_000, initialEquity: 100_000 }).triggered).toBe(false);
  });

  it('reports drawdown percentage', () => {
    const k = killSwitch({ ...DEFAULT_PARAMS, accountEquity: 90_000, initialEquity: 100_000 });
    expect(k.drawdownPct).toBeCloseTo(10);
  });
});

describe('runEngine / replayEngine', () => {
  it('runEngine returns null with fewer than 30 bars', () => {
    expect(runEngine(makeBars(20), DEFAULT_PARAMS)).toBeNull();
  });

  it('runEngine returns a full result with enough bars', () => {
    const r = runEngine(makeBars(60), DEFAULT_PARAMS);
    expect(r).not.toBeNull();
    expect(r!.regime).toBeDefined();
    expect(r!.entry).toBeDefined();
    expect(r!.kill.triggered).toBe(false);
  });

  it('replayEngine returns null with fewer than 40 bars', () => {
    expect(replayEngine(makeBars(30), DEFAULT_PARAMS, 30)).toBeNull();
  });

  it('replayEngine produces sessions, summary, and chronological rows', () => {
    const r = replayEngine(makeBars(80), DEFAULT_PARAMS, 40);
    expect(r).not.toBeNull();
    expect(r!.summary.sessions).toBeGreaterThan(0);
    expect(r!.rows.length).toBe(r!.summary.sessions);
    // rows are newest-first
    expect(r!.rows[0].date >= r!.rows[r!.rows.length - 1].date).toBe(true);
    expect(r!.summary.winRate).toBeGreaterThanOrEqual(0);
    expect(r!.summary.winRate).toBeLessThanOrEqual(100);
  });

  it('usesDefaultParams is true for defaults and false when tweaked', () => {
    expect(usesDefaultParams(DEFAULT_PARAMS)).toBe(true);
    expect(usesDefaultParams({ ...DEFAULT_PARAMS, accelerator: 0.05 })).toBe(false);
  });
});
