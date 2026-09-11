/**
 * useTradeLedger.rerun.test.tsx — "Re-run session" is SERVER-authoritative:
 * the hook POSTs /api/ledger/rerun, adopts the returned ledger locally
 * (mirror, not merge), and reports failures. The browser never recomputes
 * fills — local recompute is what let browser and cloud states diverge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createLedger, LEDGER_KEY } from '@/lib/tradeSimulator';
import { todayStr, useTradeLedger } from '@/hooks/useTradeLedger';

const { pullLedgerMock } = vi.hoisted(() => ({
  pullLedgerMock: vi.fn(async () => null),
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
  pullFreshCloudPrices: vi.fn(async () => new Map()),
  pullLedger: pullLedgerMock,
}));

vi.mock('@/lib/stockApi', () => ({
  fetchStockQuote: vi.fn(async () => null),
  fetchHistoricalData: vi.fn(async () => null),
}));

vi.mock('@/lib/supabaseHistory', () => ({
  fetchStoredHistoryForSymbol: vi.fn(async () => null),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('useTradeLedger.rerunOnServer — server-authoritative re-run', () => {
  beforeEach(() => {
    mem.clear();
    pullLedgerMock.mockClear();
    fetchMock.mockReset();
  });

  it('POSTs /api/ledger/rerun and adopts the returned ledger (mirror, not merge)', async () => {
    const local = createLedger();
    mem.set(LEDGER_KEY, JSON.stringify(local));

    const serverLedger = { ...createLedger(), lastRunDate: '2026-09-10', prices: { INTC: 100.32 } };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/ledger/rerun' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, simulated: true, reran: true, date: '2026-09-10', ledger: serverLedger }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { result } = renderHook(() => useTradeLedger());
    const r = await act(async () => result.current.rerunOnServer());

    expect(r.ok).toBe(true);
    expect(r.date).toBe('2026-09-10');
    // Local state was replaced by the server copy verbatim.
    expect(result.current.ledger.lastRunDate).toBe('2026-09-10');
    expect(result.current.ledger.prices).toEqual({ INTC: 100.32 });
    // And mirrored into storage.
    expect(JSON.parse(mem.get(LEDGER_KEY)!).lastRunDate).toBe('2026-09-10');
  });

  it('reports failure when the server errors', async () => {
    mem.set(LEDGER_KEY, JSON.stringify(createLedger()));
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: 'simulate-ledger rerun failed' }),
    }));

    const { result } = renderHook(() => useTradeLedger());
    const r = await act(async () => result.current.rerunOnServer());

    expect(r.ok).toBe(false);
    expect(r.error).toContain('simulate-ledger rerun failed');
    // Local state untouched.
    expect(result.current.ledger.lastRunDate).toBeNull();
  });

  it('is guarded against concurrent invocation', async () => {
    mem.set(LEDGER_KEY, JSON.stringify(createLedger()));
    let resolveServer: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise(resolve => { resolveServer = resolve; }));

    const { result } = renderHook(() => useTradeLedger());
    const first = result.current.rerunOnServer();
    const second = await act(async () => result.current.rerunOnServer());
    expect(second.ok).toBe(false);
    expect(second.error).toBe('already running');

    resolveServer({ ok: true, json: async () => ({ ok: true, date: '2026-09-10', ledger: createLedger() }) });
    const done = await first;
    expect(done.ok).toBe(true);
  });

  it('adopts the cloud ledger on mount (viewer pull)', async () => {
    const cloud = { ...createLedger(), lastRunDate: '2026-09-09', prices: { AAPL: 326.57 } };
    pullLedgerMock.mockImplementation(async () => cloud);
    mem.set(LEDGER_KEY, JSON.stringify(createLedger())); // stale local copy

    const { result } = renderHook(() => useTradeLedger());
    await waitFor(() => {
      expect(result.current.ledger.lastRunDate).toBe('2026-09-09');
    });
    expect(result.current.ledger.prices).toEqual({ AAPL: 326.57 });
  });

  it('keeps the local copy when the cloud is unreachable on mount', async () => {
    pullLedgerMock.mockImplementation(async () => { throw new Error('offline'); });
    const local = { ...createLedger(), lastRunDate: todayStr() };
    mem.set(LEDGER_KEY, JSON.stringify(local));

    const { result } = renderHook(() => useTradeLedger());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.ledger.lastRunDate).toBe(todayStr());
  });
});
