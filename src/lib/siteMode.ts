/**
 * siteMode — decides whether a small screen should be auto-redirected to the
 * mobile view (/m) or kept on the full dashboard.
 *
 * Once the user explicitly opens the full site from a phone (hub "Full site"
 * button or detail "Full analysis" button), their choice is remembered in
 * localStorage so they aren't bounced back on the next visit.
 */

export const FULL_SITE_FLAG = 'stockpulse_use_full_site';

export function fullSiteAllowed(): boolean {
  try {
    return localStorage.getItem(FULL_SITE_FLAG) === '1';
  } catch {
    return false;
  }
}

export function allowFullSite(): void {
  try {
    localStorage.setItem(FULL_SITE_FLAG, '1');
  } catch { /* storage unavailable */ }
}

/**
 * Where should the dashboard route ("/") land on this device?
 * Returns a path (e.g. "/m" or "/m/AAPL") to redirect to, or null to stay.
 */
export function mobileRedirectTarget(search: string): string | null {
  if (fullSiteAllowed()) return null;
  if (typeof window === 'undefined' || window.innerWidth >= 768) return null;
  const symbol = new URLSearchParams(search).get('symbol');
  return symbol ? `/m/${symbol.toUpperCase()}` : '/m';
}
