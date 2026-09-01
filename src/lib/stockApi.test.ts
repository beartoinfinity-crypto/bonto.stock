import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localDb BEFORE importing stockApi
vi.mock('./localDb', () => ({
  getQuote: vi.fn().mockResolvedValue(null),
  putQuote: vi.fn().mockResolvedValue(undefined),
  getHistorical: vi.fn().mockResolvedValue(null),
  putHistorical: vi.fn().mockResolvedValue(undefined),
  getMeta: vi.fn().mockResolvedValue(null),
  putMeta: vi.fn().mockResolvedValue(undefined),
}));

// Mock fetch globally BEFORE importing stockApi
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Now import stockApi (after mocks are in place)
const { fetchStockQuote, fetchEarningsSurprises, getEarningsSurprises, resetYahooCrumb } = await import('./stockApi');

const { getMeta, putMeta } = await import('./localDb');

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function textResponse(text: string) {
  return {
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function errorResponse() {
  return Promise.reject(new Error('Network error'));
}

beforeEach(() => {
  mockFetch.mockReset();
  resetYahooCrumb();
});

/**
 * Build mock responses in the order fetch() will be called:
 * 1. proxyFetch → fetch(chartUrl)           — chart data
 * 2. getYahooCrumb → fetch(/api/yahoo/crumb) — server-side crumb
 * 3. proxyFetch → fetch(v10Url)             — quoteSummary data
 *
 * If the crumb step or v10 step fail, proxyFetch also tries 2 CORS proxies
 * per URL (each is another fetch call), so we may need extra mocks.
 */
function setupMocks(...responses: unknown[]) {
  for (const r of responses) {
    if (r === 'error') mockFetch.mockRejectedValueOnce(new Error('Network error'));
    else if (r === 'ok') mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    else if (typeof r === 'string') mockFetch.mockResolvedValueOnce(textResponse(r));
    else mockFetch.mockResolvedValueOnce(r as Response);
  }
}

describe('fetchStockQuote — quoteSummary integration', () => {
  it('populates pe, marketCap and sector from v10 with crumb', async () => {
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 195.89, fiftyTwoWeekHigh: 199.62, fiftyTwoWeekLow: 164.08, longName: 'Apple Inc.' }, indicators: { quote: [{ close: [190, 192, 195.89], volume: [50e6, 55e6, 60e6] }] } }] } }),
      jsonResponse({ crumb: 'abc123crumb' }),  // server-side crumb
      jsonResponse({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 32.1 }, marketCap: { raw: 3_000_000_000_000 } }, assetProfile: { sector: 'Technology' } }] } }),
    );

    const result = await fetchStockQuote('AAPL');
    expect(result.data?.pe).toBe(32.1);
    expect(result.data?.marketCap).toBe('3T');
    expect(result.data?.sector).toBe('Technology');
    expect(result.data?.price).toBe(195.89);
    expect(result.data?.name).toBe('Apple Inc.');
  });

  it('formats marketCap as billions', async () => {
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 45.20 }, indicators: { quote: [{ close: [44, 45], volume: [10e6, 12e6] }] } }] } }),
      jsonResponse({ crumb: 'crumbXYZ' }),
      jsonResponse({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 12.5 }, marketCap: { raw: 180_000_000_000 } }, assetProfile: { sector: 'Technology' } }] } }),
    );

    const result = await fetchStockQuote('INTC');
    expect(result.data?.marketCap).toBe('180B');
    expect(result.data?.pe).toBe(12.5);
    expect(result.data?.sector).toBe('Technology');
  });

  it('falls back to defaults when crumb and summary both fail', async () => {
    // chart succeeds, crumb fails, then v10 fails for both hosts (4 proxy attempts each = 8 errors)
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 100.0 }, indicators: { quote: [{ close: [99, 100], volume: [1e6, 2e6] }] } }] } }),
      'error', // crumb fails
      'error', 'error', 'error', 'error', // host 1: server + direct + 2 CORS proxies
      'error', 'error', 'error', 'error', // host 2: server + direct + 2 CORS proxies
    );

    const result = await fetchStockQuote('TEST');
    expect(result.data?.pe).toBe(0);
    expect(result.data?.marketCap).toBe('N/A');
    expect(result.data?.sector).toBe('Unknown');
  });

  it('falls back to curated local fundamentals when quoteSummary is unreachable for a tracked symbol', async () => {
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 100.0 }, indicators: { quote: [{ close: [99, 100], volume: [1e6, 2e6] }] } }] } }),
      'error', // crumb fails
      'error', 'error', 'error', 'error', // host 1: server + direct + 2 CORS proxies
      'error', 'error', 'error', 'error', // host 2: server + direct + 2 CORS proxies
    );

    const result = await fetchStockQuote('AAPL');
    // AAPL is in popularStocks, so even without live summary we show real values
    expect(result.data?.sector).toBe('Technology');
    expect(result.data?.pe).toBeGreaterThan(0);
    expect(result.data?.marketCap).toBeTruthy();
    expect(result.data?.marketCap).not.toBe('N/A');
    expect(result.data?.name).toBe('Apple Inc.');
  });

  it('falls back when quoteSummary returns empty result', async () => {
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 100.0 }, indicators: { quote: [{ close: [99, 100], volume: [1e6, 2e6] }] } }] } }),
      jsonResponse({ crumb: 'crumbOK' }),
      jsonResponse({ quoteSummary: { result: [{}] } }),
      jsonResponse({ crumb: 'crumbOK' }),
      jsonResponse({ quoteSummary: { result: [{}] } }),
    );

    const result = await fetchStockQuote('TEST');
    expect(result.data?.pe).toBe(0);
    expect(result.data?.marketCap).toBe('N/A');
    expect(result.data?.sector).toBe('Unknown');
  });

  it('returns N/A marketCap when marketCap is missing', async () => {
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 10.0 }, indicators: { quote: [{ close: [9, 10], volume: [1e6, 2e6] }] } }] } }),
      jsonResponse({ crumb: 'crumbOK' }),
      jsonResponse({ quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 15.0 } }, assetProfile: { sector: 'Healthcare' } }] } }),
    );

    const result = await fetchStockQuote('TEST');
    expect(result.data?.marketCap).toBe('N/A');
    expect(result.data?.pe).toBe(15.0);
    expect(result.data?.sector).toBe('Healthcare');
  });

  it('returns 0 pe when trailingPE is missing', async () => {
    setupMocks(
      jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 50.0 }, indicators: { quote: [{ close: [49, 50], volume: [3e6, 4e6] }] } }] } }),
      jsonResponse({ crumb: 'crumbOK' }),
      jsonResponse({ quoteSummary: { result: [{ summaryDetail: { marketCap: { raw: 5_000_000_000 } }, assetProfile: { sector: 'Financial' } }] } }),
    );

    const result = await fetchStockQuote('TEST');
    expect(result.data?.pe).toBe(0);
    expect(result.data?.marketCap).toBe('5B');
    expect(result.data?.sector).toBe('Financial');
  });
});

describe('fetchEarningsSurprises', () => {
  it('parses quarterly earnings into surprise rows', async () => {
    setupMocks(
      jsonResponse({ crumb: 'crumbE1' }),
      jsonResponse({
        quoteSummary: {
          result: [{
            earnings: {
              earningsChart: {
                quarterly: [
                  { date: '1Q2024', actual: { raw: 1.2 }, estimate: { raw: 1.0 } },
                  { date: '2Q2024', actual: { raw: 0.95 }, estimate: { raw: 1.0 } },
                ],
              },
            },
          }],
        },
      }),
    );

    const rows = await fetchEarningsSurprises('aapl');
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({
      period: '1Q2024',
      date: '2024-03-31',
      actual: 1.2,
      estimate: 1.0,
      surprise: 0.2,
      surprisePercent: 20,
    });
    expect(rows![1].surprisePercent).toBeCloseTo(-5.0);
  });

  it('derives a surprise percentage from actual/estimate when vectors are blank', async () => {
    setupMocks(
      jsonResponse({ crumb: 'crumbE2' }),
      jsonResponse({
        quoteSummary: {
          result: [{
            earnings: {
              earningsChart: {
                quarterly: [
                  { date: '3Q2024', actual: 3.0, estimate: 2.5 },
                ],
              },
            },
          }],
        },
      }),
    );

    const rows = await fetchEarningsSurprises('MSFT');
    expect(rows?.[0].surprise).toBe(0.5);
    expect(rows?.[0].surprisePercent).toBe(20);
  });

  it('returns null when no quarterly data is present', async () => {
    setupMocks(
      jsonResponse({ crumb: 'crumbE3' }),
      jsonResponse({ quoteSummary: { result: [{}] } }),
    );
    const rows = await fetchEarningsSurprises('XXX');
    expect(rows).toBeNull();
  });

  it('getEarningsSurprises returns cached rows without calling Yahoo', async () => {
    const cached = [
      { period: '4Q2024', date: '2024-12-31', actual: 2.0, estimate: 1.8, surprise: 0.2, surprisePercent: 11.11 },
    ];
    vi.mocked(getMeta).mockResolvedValueOnce(cached);

    const rows = await getEarningsSurprises('AAPL');

    expect(rows).toEqual(cached);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(putMeta).not.toHaveBeenCalled();
  });

  it('getEarningsSurprises fetches and stores on cache miss', async () => {
    vi.mocked(getMeta).mockResolvedValueOnce(null);
    setupMocks(
      jsonResponse({ crumb: 'crumbE4' }),
      jsonResponse({
        quoteSummary: {
          result: [{
            earnings: {
              earningsChart: {
                quarterly: [
                  { date: '1Q2024', actual: { raw: 1.2 }, estimate: { raw: 1.0 } },
                ],
              },
            },
          }],
        },
      }),
    );

    const rows = await getEarningsSurprises('AAPL');

    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(putMeta).toHaveBeenCalledWith('pead::AAPL', rows);
  });
});
