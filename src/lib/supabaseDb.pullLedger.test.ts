import { describe, it, expect, vi, beforeEach } from 'vitest';

// Importing supabaseDb pulls in localDb (sql.js WASM init aborts under jsdom).
// Stub the loader with a never-resolving promise like localDb.staleness.test.
vi.mock('sql.js', () => ({
  default: vi.fn(async () => new Promise(() => { /* never resolves in tests */ })),
}));

import { pullLedger } from './supabaseDb';

const TEST_CFG = { url: 'https://test-project.supabase.co', anonKey: 'test-anon-key' };

const LEDGER = {
  accounts: { value: { personaId: 'value', cash: 100000, positions: [], lastRunDate: '2026-09-11' } },
  trades: [{ id: 't1', date: '2026-09-10', personaId: 'value', symbol: 'AAPL', action: 'BUY', qty: 10, price: 200, value: 2000, realizedPnl: 0, note: 'test' }],
  decisions: [], prices: { AAPL: 210 }, history: [], lastRunDate: '2026-09-10',
};

// supabase-js reads res.text()/res.headers on REST responses; provide a full
// Response-like so postgrest-js doesn't touch real globals.
function resOf(body: unknown) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => raw,
  };
}

// Mock fetch: handle /api/sync-config and Supabase REST (stockpulse_kv) queries.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  // Seed the saved config directly (fetchRemoteSyncConfig caches its module
  // promise across tests, so relying on the mock to persist it per-test fails).
  localStorage.setItem('stockpulse_supabase_config', JSON.stringify({ ...TEST_CFG, enabled: true }));
  mockFetch.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/sync-config')) {
      return resOf(TEST_CFG);
    }
    if (typeof url === 'string' && url.includes('stockpulse_kv')) {
      return resOf([{ key: 'stockpulse_trade_ledger', value: JSON.stringify(LEDGER) }]);
    }
    return resOf({});
  });
});

describe('pullLedger edge cases', () => {
  it('adopts the cloud copy when local storage is empty (fresh browser)', async () => {
    const result = await pullLedger();
    expect(result).not.toBeNull();
    expect(result!.accounts.value.cash).toBe(100000);
    expect(result!.trades[0].symbol).toBe('AAPL');
    expect(localStorage.getItem('stockpulse_trade_ledger')).toContain('AAPL');
  });

  it('returns local copy when cloud has no row', async () => {
    localStorage.setItem('stockpulse_trade_ledger', JSON.stringify(LEDGER));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/sync-config')) return resOf(TEST_CFG);
      if (url.includes('stockpulse_kv')) return resOf([]); // empty
      return resOf({});
    });
    const result = await pullLedger();
    expect(result).not.toBeNull();
    expect(result!.trades[0].symbol).toBe('AAPL');
  });

  it('merges cloud and local when both are valid', async () => {
    const local = {
      ...LEDGER,
      trades: [...LEDGER.trades, { id: 't2', date: '2026-09-10', personaId: 'contrarian', symbol: 'TSLA', action: 'BUY', qty: 5, price: 180, value: 900, realizedPnl: 0, note: 'local' }],
    };
    localStorage.setItem('stockpulse_trade_ledger', JSON.stringify(local));
    const result = await pullLedger();
    expect(result).not.toBeNull();
    const symbols = result!.trades.map(t => t.symbol).sort();
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('TSLA');
  });

  it('returns null when both local and cloud are absent', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/sync-config')) return resOf(TEST_CFG);
      if (url.includes('stockpulse_kv')) return resOf([]);
      return resOf({});
    });
    const result = await pullLedger();
    expect(result).toBeNull();
  });
});