/**
 * useTradeLedger.reset.test.tsx — "Reset today" only clears THE CURRENT DAY's
 * simulation (trades + decision logs for today), keeps all earlier history,
 * rebuilds accounts by replaying the remaining fills, and overwrites the cloud
 * copy so the cleared state isn't re-merged back in by the next auto-push.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createLedger } from '@/lib/tradeSimulator';
import { simulateDay, todayStr, useTradeLedger } from '@/hooks/useTradeLedger';

const { pullLedgerMock, overwriteLedgerMock } = vi.hoisted(() => ({
  pullLedgerMock: vi.fn(async () => null),
  overwriteLedgerMock: vi.fn(async () => true),
}));

const mem = new Map<string, string>();

vi.mock('@/lib/storage', () => ({
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  getJson: <T,>(k: string): T | null => {
    const raw = mem.get(k);
    return raw ? JSON.parse(raw) : null;
  },
  setJson: (k: string, v: unknown) => { mem.set(k, JSON.stringify(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  CONFIG_KEYS: [],
  DOCUMENT_KEYS: [],
}));

vi.mock('@/lib/supabaseDb', () => ({
  pullLedger: pullLedgerMock,
  overwriteLedger: overwriteLedgerMock,
}));

vi.mock('@/lib/stockApi', () => ({
  fetchStockQuote: vi.fn(async () => null),
  fetchHistoricalData: vi.fn(async () => null),
}));

vi.mock('@/lib/tradingAgents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tradingAgents')>('@/lib/tradingAgents');
  return {
    ...actual,
    runTradingAgents: vi.fn(async (symbol: string) => ({
      symbol,
      final: { rating: 'Buy', conviction: 75 },
      price: 200,
    })),
  };
});

vi.mock('@/lib/supabaseHistory', () => ({
  fetchStoredHistoryForSymbol: vi.fn(async () => null),
}));

describe('useTradeLedger.reset — clears only today', () => {
  beforeEach(() => {
    mem.clear();
    pullLedgerMock.mockClear();
    overwriteLedgerMock.mockClear();
  });

  it('removes today trades/decisions, keeps history, rolls back lastRunDate', async () => {
    const today = todayStr();
    const ran = await simulateDay(createLedger(), today); // day-once rule permits first run
    expect(ran.trades.length).toBeGreaterThan(0);
    mem.set('stockpulse_trade_ledger', JSON.stringify(ran));

    const { result } = renderHook(() => useTradeLedger());
    await act(async () => result.current.reset());

    const ledger = result.current.ledger;
    expect(ledger.trades.every(t => t.date !== today)).toBe(true);
    expect(ledger.decisions.every(d => d.date !== today)).toBe(true);
    expect(ledger.lastRunDate).not.toBe(today);
    expect(ledger.trades.length).toBe(0); // fresh ledger — only today had run
    // Cloud copy was overwritten (not union-merged) so the clear sticks.
    expect(overwriteLedgerMock).toHaveBeenCalledTimes(1);
    expect((overwriteLedgerMock.mock.calls[0][0] as { trades: unknown[] }).trades.length).toBe(0);
  }, 30000); // full simulateDay pass is heavy

  it('allows the cleared day to be re-simulated (still day-once from then on)', async () => {
    const today = todayStr();
    const ran = await simulateDay(createLedger(), today);
    mem.set('stockpulse_trade_ledger', JSON.stringify(ran));
    const { result } = renderHook(() => useTradeLedger());
    await act(async () => result.current.reset());
    expect(result.current.ranToday).toBe(false);

    const reran = await act(async () => simulateDay(result.current.ledger, today));
    expect(reran.lastRunDate).toBe(today);
    expect(reran.trades.length).toBeGreaterThan(0);
  }, 30000);

  it('is a safe no-op when nothing has been simulated', () => {
    const { result } = renderHook(() => useTradeLedger());
    act(() => result.current.reset());
    expect(result.current.ledger.trades).toEqual([]);
    expect(result.current.ledger.lastRunDate).toBeNull();
  });

  it('keeps prior days untouched when clearing today', async () => {
    const yesterday = '2026-08-31';
    const today = todayStr();
    const day1 = await simulateDay(createLedger(), yesterday);
    const day2 = await simulateDay(day1, today);
    expect(day2.trades.length).toBeGreaterThan(day1.trades.length);
    mem.set('stockpulse_trade_ledger', JSON.stringify(day2));

    const { result } = renderHook(() => useTradeLedger());
    await act(async () => result.current.reset());

    const ledger = result.current.ledger;
    expect(ledger.trades.every(t => t.date !== today)).toBe(true);
    expect(ledger.trades.length).toBe(day1.trades.length); // yesterday's fills intact
    expect(ledger.lastRunDate).toBe(yesterday);
  }, 30000); // two full simulateDay passes
});