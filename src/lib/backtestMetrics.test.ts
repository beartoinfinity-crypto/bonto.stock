/**
 * backtestMetrics.test.ts — unit tests for the real metric suite.
 * Guards trade statistics, the mark-to-market equity curve, drawdown math and
 * replayEngine integration, all against deterministic synthetic data.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEquityCurve, maxDrawdownStats, computeBacktestMetrics,
} from './backtestMetrics';
import { DEFAULT_PARAMS, replayEngine, ReplayTrade } from './tacticalEngine';
import { StockData } from './stockData';

// Chronological daily bars with UNIQUE ISO dates (a real daily series).
function makeBars(n: number, base = 100): StockData[] {
  const bars: StockData[] = [];
  let close = base;
  const d0 = new Date('2026-01-01T00:00:00Z').getTime();
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 2 + (i % 5 === 0 ? 1.5 : -0.3);
    const open = close;
    close = open + drift;
    bars.push({
      date: new Date(d0 + i * 86400000).toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
      volume: 1_000_000,
    });
  }
  return bars;
}

const trade = (over: Partial<ReplayTrade>): ReplayTrade => ({
  side: 'LONG',
  entryDate: '2026-01-01',
  entryPrice: 100,
  exitDate: '2026-01-02',
  exitPrice: 101,
  size: 100,
  barsHeld: 1,
  reason: 'Take_Profit',
  pnl: 100,
  pnlPct: 1,
  ...over,
});

describe('buildEquityCurve', () => {
  it('marks the open position to market at the final bar', () => {
    const bars = makeBars(3);
    const closed = trade({
      entryDate: bars[0].date, entryPrice: bars[0].close,
      exitDate: bars[1].date, exitPrice: bars[1].close, pnl: 100,
    });
    const open = trade({
      entryDate: bars[1].date, entryPrice: bars[1].close,
      exitDate: bars[2].date, exitPrice: bars[2].close, reason: 'Open',
      pnl: (bars[2].close - bars[1].close) * 100,
    });
    const curve = buildEquityCurve([closed], bars, 100000, open);
    expect(curve).toHaveLength(3);
    expect(curve[0]).toBe(100000);                       // flat before any fill
    expect(curve[1]).toBe(100100);                       // closed trade realizes
    expect(curve[2]).toBe(100100 + open.pnl);            // open position marked
  });

  it('marks the open position while it is held and realizes on the exit bar', () => {
    const bars = makeBars(4);
    const t = trade({
      entryDate: bars[0].date, entryPrice: bars[0].close,
      exitDate: bars[2].date, exitPrice: bars[2].close,
      pnl: 250,
    });
    const curve = buildEquityCurve([t], bars, 100000);
    expect(curve).toHaveLength(4);
    expect(curve[0]).toBe(100000);                                          // entry bar, no move yet
    expect(curve[1]).toBe(100000 + (bars[1].close - bars[0].close) * 100);  // marked while open
    expect(curve[2]).toBe(100250);                                          // realizes on exit
    expect(curve[3]).toBe(100250);                                          // flat cash after exit
  });

  it('returns an empty curve for empty bars', () => {
    expect(buildEquityCurve([], [], 100000)).toEqual([]);
  });
});

describe('maxDrawdownStats', () => {
  it('measures the peak-to-trough drop and the underwater streak', () => {
    expect(maxDrawdownStats([100, 120, 90, 110])).toEqual({ maxDrawdown: -25, duration: 2 });
  });

  it('returns zeros for a monotonically rising curve', () => {
    expect(maxDrawdownStats([100, 110, 120, 130])).toEqual({ maxDrawdown: 0, duration: 0 });
  });

  it('returns zeros for an empty curve', () => {
    expect(maxDrawdownStats([])).toEqual({ maxDrawdown: 0, duration: 0 });
  });
});

describe('computeBacktestMetrics — trade statistics', () => {
  const bars = makeBars(5);

  it('computes win rate, profit factor, averages and expectancy', () => {
    const trades = [
      trade({ pnl: 200, entryDate: bars[0].date, exitDate: bars[1].date }),
      trade({ pnl: 100, entryDate: bars[1].date, exitDate: bars[2].date }),
      trade({ pnl: -150, entryDate: bars[2].date, exitDate: bars[3].date }),
    ];
    const m = computeBacktestMetrics({ trades, bars });
    expect(m.totalTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(200 / 3, 5);
    expect(m.profitFactor).toBeCloseTo(2, 5);
    expect(m.avgWin).toBeCloseTo(150, 5);
    expect(m.avgLoss).toBeCloseTo(-150, 5);
    expect(m.expectancy).toBeCloseTo(50, 5);
    expect(m.netPnl).toBeCloseTo(150, 5);
  });

  it('returns zeroed metrics when there are no trades', () => {
    const m = computeBacktestMetrics({ trades: [], bars });
    expect(m.totalTrades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(m.expectancy).toBe(0);
    expect(m.netPnl).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.sharpe).toBe(0);
    expect(m.totalReturn).toBe(0);
  });

  it('reports zero win rate and profit factor when every trade loses', () => {
    const trades = [
      trade({ pnl: -100, entryDate: bars[0].date, exitDate: bars[1].date }),
      trade({ pnl: -80, entryDate: bars[1].date, exitDate: bars[2].date }),
    ];
    const m = computeBacktestMetrics({ trades, bars });
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(Number.isFinite(m.profitFactor)).toBe(true);
    expect(m.avgWin).toBe(0);
    expect(m.avgLoss).toBeCloseTo(-90, 5);
    expect(m.netPnl).toBeCloseTo(-180, 5);
  });

  it('yields finite Sharpe, Sortino and volatility for a mixed curve', () => {
    const trades = [
      trade({ pnl: 500, entryDate: bars[0].date, exitDate: bars[1].date }),
      trade({ pnl: -200, entryDate: bars[1].date, exitDate: bars[2].date }),
      trade({ pnl: 300, entryDate: bars[2].date, exitDate: bars[3].date }),
    ];
    const m = computeBacktestMetrics({ trades, bars });
    expect(Number.isFinite(m.volatility)).toBe(true);
    expect(Number.isFinite(m.sharpe)).toBe(true);
    expect(Number.isFinite(m.sortino)).toBe(true);
    expect(m.totalReturn).toBeCloseTo(0.6, 5);           // +600 on 100000
  });
});

describe('replayEngine integration', () => {
  it('attaches metrics consistent with the replay summary', () => {
    const bars = makeBars(120);
    const r = replayEngine(bars, DEFAULT_PARAMS, 60);
    expect(r).not.toBeNull();
    const m = r!.metrics;
    expect(m.totalTrades).toBe(r!.summary.closedTrades);
    expect(m.winRate).toBeCloseTo(r!.summary.winRate, 5);
    expect(m.netPnl).toBeCloseTo(r!.summary.netPnl, 5);
    // Every field is finite except the degenerate no-loss / no-drawdown case.
    for (const v of [m.totalReturn, m.cagr, m.maxDrawdown, m.maxDrawdownDuration, m.volatility, m.sharpe, m.sortino, m.winRate, m.avgWin, m.avgLoss, m.expectancy, m.totalTrades, m.netPnl]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
