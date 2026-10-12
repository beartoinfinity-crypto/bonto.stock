/**
 * Regression: signal dots must render as <span>s, not as literal className
 * text (a helper once returned a class string that JSX rendered as children).
 * Seeds the 24h scan cache so the table renders without running a scan.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/lib/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';

// jsdom can't load the sql.js WASM binary — stub like page-smoke does.
vi.mock('sql.js', () => {
  class StubDatabase {
    exec(): unknown[] { return []; }
    run(): void { /* noop */ }
    export(): Uint8Array { return new Uint8Array(0); }
    close(): void { /* noop */ }
  }
  return {
    default: async () => ({ Database: StubDatabase }),
    Database: StubDatabase,
  };
});

import SmartMoneyScreener from './SmartMoneyScreener';
import { computeInsiderScore, computeInstitutionalScore, computeCongressScore, computeSqueezeScore, totalScore, classify, type SmartMoneyRow } from '@/lib/smartMoney';

beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('network disabled')));
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  });
  window.scrollTo = () => { /* noop */ };

  const insider = computeInsiderScore([
    { owner: 'A', title: 'CEO', value: 250_000, date: '2026-09-01', senior: true },
    { owner: 'B', title: 'CFO', value: 250_000, date: '2026-09-02', senior: true },
    { owner: 'C', title: 'Director', value: 250_000, date: '2026-09-03', senior: false },
  ]);
  const institutional = computeInstitutionalScore([
    { manager: 'Berkshire Hathaway', issuer: 'APPLE INC', value: 1e9, shares: 1e6 },
  ]);
  const congress = computeCongressScore([{ type: 'BUY', date: '2026-05-01' }]);
  const squeeze = computeSqueezeScore(12, 5);
  const score = totalScore(insider, institutional, congress, squeeze);
  const row: SmartMoneyRow = {
    symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', capTier: 'mega',
    price: 300, changePercent: 1.2, marketCap: 4e12,
    insider, institutional, congress, squeeze,
    score, classification: classify(score), detailError: null,
  };
  localStorage.setItem('stockpulse_sm_scan', JSON.stringify({ at: Date.now(), rows: [row] }));
});

afterAll(() => {
  localStorage.removeItem('stockpulse_sm_scan');
  vi.unstubAllGlobals();
});

afterEach(() => cleanup());

function renderPage() {
  return render(
    <LanguageProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/smart-money']}>
          <SmartMoneyScreener />
        </MemoryRouter>
      </TooltipProvider>
    </LanguageProvider>,
  );
}

describe('SmartMoneyScreener signal dots', () => {
  it('renders dots as elements, never as literal className text', () => {
    const { container } = renderPage();
    expect(screen.queryByText(/inline-block/)).toBeNull();
    expect(screen.queryByText(/rounded-full/)).toBeNull();
    const dots = container.querySelectorAll('span.rounded-full');
    expect(dots.length).toBeGreaterThanOrEqual(4);
  });

  it('lights up the dots whose signals scored', () => {
    const { container } = renderPage();
    // insider=25 (max, ring), congress=20 (max, ring), 13F=15, squeeze=20
    expect(container.querySelectorAll('span.bg-sky-500').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('span.bg-violet-500').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('span.bg-amber-500').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('span.bg-rose-500').length).toBeGreaterThanOrEqual(1);
  });
});
