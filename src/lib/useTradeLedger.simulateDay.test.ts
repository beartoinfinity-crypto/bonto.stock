import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLedger } from '@/lib/tradeSimulator';
import type { StockData } from '@/lib/stockData';

const { storedSpy } = vi.hoisted(() => {
    const storedSpy = vi.fn();
    function craftedBars(_endPrice: number): StockData[] {
      // Tight sideways consolidation (so regime is TRANSITIONING / low ADX) then
      // a closing spike well beyond the prior bar's high — fires the
      // C_VOLATILITY_BURST entry (requires move > 1.5×ATR + follow-through).
      const bars: StockData[] = [];
      for (let i = 0; i < 45; i++) {
        const base = 100 + Math.sin(i * 0.5) * 1.5;
        bars.push({
          date: `2026-06-${String(i).padStart(2, '0')}`,
          open: +(base - 0.4).toFixed(2),
          high: +(base + 1.2).toFixed(2),
          low: +(base - 1.2).toFixed(2),
          close: +base.toFixed(2),
          volume: 200000 + i * 100,
        } as StockData);
      }
      const last = bars[bars.length - 1];
      bars.push({
        date: '2026-07-01',
        open: +last.close.toFixed(2),
        high: +(last.close + 8).toFixed(2),
        low: +(last.close - 1).toFixed(2),
        close: +(last.close + 7).toFixed(2),
        volume: 900000,
      } as StockData);
      return bars;
    }
    // Stored Supabase history (`stock_price_history`) is the offline safety net.
    // Return bars designed to arm a tactical entry when the live APIs are down.
    return { storedSpy: storedSpy.mockImplementation(async (_symbol: string) => craftedBars(100)) };
  });

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

// Stored Supabase history is the offline safety net — see `storedSpy` above.

vi.mock('@/lib/supabaseHistory', () => ({
  fetchStoredHistoryForSymbol: storedSpy,
}));

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

  it('falls back to stored Supabase history when the network is down', async () => {
    storedSpy.mockClear();
    const next = await simulateDay(createLedger(), '2026-01-02');
    const byPerson: Record<string, number> = {};
    for (const t of next.trades) byPerson[t.personaId] = (byPerson[t.personaId] ?? 0) + 1;
    console.log('STORED_DIST', JSON.stringify(byPerson));
    expect(storedSpy).toHaveBeenCalled();
    // Tactical/agent need real bar series — fabricated + this wiring, and the
    // fill chain should keep prices > 0 for stored-covered symbols.
    const covered = next.trades.filter(t => t.personaId === 'tactical' || t.personaId === 'agent');
    const prices = next.prices;
    expect(Object.values(prices).some(p => p > 0)).toBe(true);
    expect(covered.length).toBeGreaterThan(0);
  });
});