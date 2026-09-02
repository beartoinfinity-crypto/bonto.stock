import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLedger } from '@/lib/tradeSimulator';

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

// Network is down: quotes & history return null so every persona must fall back
// to the derived/universe path (the common first-run scenario on a cold Render
// tier or with Yahoo/Finnhub blocked).
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

import { simulateDay } from '@/hooks/useTradeLedger';

describe('simulateDay integration (offline first-run)', () => {
  beforeEach(() => mem.clear());

  it('produces trades even when network is fully unavailable', async () => {
    const next = await simulateDay(createLedger(), '2026-01-02');
    expect(next.lastRunDate).toBe('2026-01-02');
    expect(next.decisions).toHaveLength(6);
    for (const r of next.decisions) expect(r.decisions.length).toBeGreaterThan(0);
    // Regression: the universe once silently contained `undefined`, crashing
    // runDayForPerson and leaving the ledger untouched.
    expect(next.trades.length).toBeGreaterThan(0);
  });

  it('never embeds undefined symbols in the daily watch list', async () => {
    const next = await simulateDay(createLedger(), '2026-01-02');
    for (const r of next.decisions) {
      for (const d of r.decisions) {
        expect(typeof d.symbol).toBe('string');
        expect(d.symbol.length).toBeGreaterThan(0);
      }
    }
  });

  it('does not corrupt the ledger on empty-holding personas', async () => {
    const fields = await simulateDay(createLedger(), '2026-01-02');
    for (const r of fields.decisions) {
      const acct = fields.accounts[r.personaId];
      expect(Array.isArray(acct.positions)).toBe(true);
      expect(acct.cash).toBeGreaterThan(0);
    }
  });
});