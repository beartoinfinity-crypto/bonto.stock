import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mobileRedirectTarget, allowFullSite, fullSiteAllowed, FULL_SITE_FLAG } from './siteMode';

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

const origWidth = window.innerWidth;

beforeEach(() => {
  localStorage.clear();
  setWidth(1024);
});

afterEach(() => {
  localStorage.clear();
  setWidth(origWidth);
});

describe('mobileRedirectTarget', () => {
  it('stays on the dashboard for desktop widths', () => {
    setWidth(1024);
    expect(mobileRedirectTarget('')).toBeNull();
  });

  it('redirects small screens to /m', () => {
    setWidth(390);
    expect(mobileRedirectTarget('')).toBe('/m');
  });

  it('keeps the ?symbol param when redirecting', () => {
    setWidth(390);
    expect(mobileRedirectTarget('?symbol=aapl')).toBe('/m/AAPL');
  });

  it('stays on the dashboard once the user chose the full site', () => {
    setWidth(390);
    allowFullSite();
    expect(mobileRedirectTarget('')).toBeNull();
    expect(mobileRedirectTarget('?symbol=AAPL')).toBeNull();
  });

  it('boundary: 768px counts as desktop', () => {
    setWidth(768);
    expect(mobileRedirectTarget('')).toBeNull();
    setWidth(767);
    expect(mobileRedirectTarget('')).toBe('/m');
  });
});

describe('allowFullSite / fullSiteAllowed', () => {
  it('starts disallowed', () => {
    expect(fullSiteAllowed()).toBe(false);
  });

  it('persists the choice', () => {
    allowFullSite();
    expect(fullSiteAllowed()).toBe(true);
    expect(localStorage.getItem(FULL_SITE_FLAG)).toBe('1');
  });
});
