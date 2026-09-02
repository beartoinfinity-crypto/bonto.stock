/**
 * useTradeLedger.runOnceToday.test.tsx — the auto-run path must decide "has
 * today already been simulated?" against the CLOUD ledger (pulled + losslessly
 * merged first), never against a stale local snapshot.
 *
 * Regression: machine A pushed today's day; machine B re-rendered /ledger,
 * saw only its own local ledger (no boot hydration yet) and ran the same day
 * again with different live prices — diverging the records across browsers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createLedger } from '@/lib/tradeSimulator';
import { todayStr, useTradeLedger } from '@/hooks/useTradeLedger';

const { pullLedgerMock } = vi.hoisted(() => ({
  pullLedgerMock: vi.fn<() => Promise<ReturnType<typeof import('@/lib/supabaseDb')['pullLedger']>>>(),
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
}));

// Network is down: quotes & history return null so every persona falls back to
// the derived/universe path (keeps the simulation cheap and deterministic).
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

function ledgerLastRun(fileDate: string) {
  return { ...createLedger(), lastRunDate: fileDate };
}

describe('useTradeLedger.runOnceToday — cloud-aware auto-run', () => {
  beforeEach(() => {
    mem.clear();
    pullLedgerMock.mockReset();
  });

  it('skips simulation when the cloud ledger already ran today', async () => {
    pullLedgerMock.mockResolvedValue(ledgerLastRun(todayStr()));
    const { result } = renderHook(() => useTradeLedger());
    const ran = await act(async () => result.current.runOnceToday());
    expect(pullLedgerMock).toHaveBeenCalledTimes(1);
    expect(ran).toBe(false);
    // Today's cloud copy was adopted into state and no new day was simulated
    // (persistence of the adopted copy is pullLedger's own writeLocal).
    expect(result.current.ledger.lastRunDate).toBe(todayStr());
  });

  it('simulates only when the cloud ledger has not yet run today', async () => {
    pullLedgerMock.mockResolvedValue(ledgerLastRun('2026-01-05'));
    const { result } = renderHook(() => useTradeLedger());
    const ran = await act(async () => result.current.runOnceToday());
    expect(ran).toBe(true);
    const stored = JSON.parse(mem.get('stockpulse_trade_ledger')!);
    expect(stored.lastRunDate).toBe(todayStr());
    expect(Array.isArray(stored.trades)).toBe(true);
  }, 30000); // full simulateDay pass is heavy

  it('falls back to the local ledger (and its ran-today flag) when sync is off', async () => {
    pullLedgerMock.mockResolvedValue(null); // getClient() === null → no cloud
    mem.set('stockpulse_trade_ledger', JSON.stringify(ledgerLastRun(todayStr())));
    const { result } = renderHook(() => useTradeLedger());
    const ran = await act(async () => result.current.runOnceToday());
    expect(ran).toBe(false);
    expect(JSON.parse(mem.get('stockpulse_trade_ledger')!).lastRunDate).toBe(todayStr());
  });

  it('simulates a fresh day when sync is off and the local ledger is empty', async () => {
    pullLedgerMock.mockResolvedValue(null);
    const { result } = renderHook(() => useTradeLedger());
    const ran = await act(async () => result.current.runOnceToday());
    expect(ran).toBe(true);
    expect(JSON.parse(mem.get('stockpulse_trade_ledger')!).lastRunDate).toBe(todayStr());
  }, 30000); // full simulateDay pass

  it('ignores a second auto-run call while one is in flight', async () => {
    pullLedgerMock.mockResolvedValue(ledgerLastRun('2026-01-05'));
    const { result } = renderHook(() => useTradeLedger());
    const first = result.current.runOnceToday();
    const second = await result.current.runOnceToday(); // synchronous in-flight guard
    expect(second).toBe(false);
    expect(await first).toBe(true);
  }, 30000); // full simulateDay pass
});