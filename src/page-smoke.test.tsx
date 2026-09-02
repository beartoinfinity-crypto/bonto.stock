/**
 * page-smoke.test.tsx — render smoke test for every app route.
 *
 * Guards against the "blank page" class of bug: an identifier used but never
 * imported (e.g. `useRef`) crashes a route at render time even when tsc/eslint
 * pass (strict: false). Each page is rendered inside the app's real providers
 * (QueryClient + Language + Tooltip + router) and must mount without throwing.
 * No network: fetch is stubbed to reject so pages render their idle/loading/
 * error states instead of hitting the live API.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ReactNode } from 'react';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';

// jsdom can't load the sql.js WASM binary — stub it so pages that read from the
// local SQLite archive (via localDb) render with empty query results instead of
// crashing the test garbage-collector with an unhandled wasm rejection.
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

import Index from '@/pages/Index';
import Screener from '@/pages/Screener';
import Tactical from '@/pages/Tactical';
import TradingMasters from '@/pages/TradingMasters';
import TradingAgentsPage from '@/pages/TradingAgentsPage';
import MasterMatrix from '@/pages/MasterMatrix';
import StockHistory from '@/pages/StockHistory';
import TradeLedger from '@/pages/TradeLedger';
import Settings from '@/pages/Settings';
import ApiSettings from '@/pages/ApiSettings';
import Admin from '@/pages/Admin';
import NotFound from '@/pages/NotFound';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// [initialEntries path, Route path pattern, page element]
const routes: Array<[string, string, ReactNode]> = [
  ['/', '/', <Index />],
  ['/screener', '/screener', <Screener />],
  ['/tactical', '/tactical', <Tactical />],
  ['/masters', '/masters', <TradingMasters />],
  ['/trading-agents', '/trading-agents', <TradingAgentsPage />],
  ['/masters-matrix', '/masters-matrix', <MasterMatrix />],
  ['/masters-matrix/AAPL', '/masters-matrix/:symbol', <StockHistory />],
  ['/ledger', '/ledger', <TradeLedger />],
  ['/settings', '/settings', <Settings />],
  ['/api-settings', '/api-settings', <ApiSettings />],
  ['/admin', '/admin', <Admin />],
  ['/does-not-exist', '*', <NotFound />],
];

const origScrollTo = window.scrollTo;

beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('network disabled in page smoke test')));
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  });
  window.scrollTo = () => { /* noop */ };
});

afterAll(() => {
  window.scrollTo = origScrollTo;
  vi.unstubAllGlobals();
});

afterEach(() => cleanup());

function renderRoute(entryPath: string, routePath: string, element: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[entryPath]}>
            <Routes>
              <Route path={routePath} element={element} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

describe('page routes render without crashing', () => {
  for (const [entryPath, routePath, element] of routes) {
    it(`renders ${routePath}`, () => {
      const { container } = renderRoute(entryPath, routePath, element);
      expect(container).toBeTruthy();
      expect(container.firstChild).not.toBeNull();
    });
  }
});