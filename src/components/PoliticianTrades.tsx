import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Landmark, Loader2, Plus, AlertCircle, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as storage from '@/lib/storage';


type Side = 'BUY' | 'SELL' | 'EXCHANGE' | 'OTHER';
type SideFilter = 'ALL' | 'BUY' | 'SELL';

interface TradeRow {
  id: string;
  symbol: string;
  politician: string;
  transaction_date: string;
  filing_date: string | null;
  transaction_type: Side;
  amount_from: number | null;
  amount_to: number | null;
  asset_name: string | null;
  position_held: string | null;
}

const PAGE_SIZE = 200;
const DEFAULT_VISIBLE = 10;

function formatAmount(from: number | null, to: number | null): string {
  const fmt = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    : n >= 1_000 ? `$${Math.round(n / 1_000)}K`
    : `$${n}`;
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `${fmt(from)}+`;
  if (to) return `≤ ${fmt(to)}`;
  return '—';
}

const TRADES_CACHE_KEY = 'stockpulse_politician_trades';

interface TradeCache {
  data: TradeRow[];
  fetchedAt: number;
}

function loadTradesFromCache(): TradeRow[] | null {
  try {
    const raw = storage.getItem(TRADES_CACHE_KEY);
    if (!raw) return null;
    const cache: TradeCache = JSON.parse(raw);
    return cache.data ?? null;
  } catch {
    return null;
  }
}

function loadCacheFetchedAt(): number | null {
  try {
    const raw = storage.getItem(TRADES_CACHE_KEY);
    if (!raw) return null;
    const cache: TradeCache = JSON.parse(raw);
    return cache.fetchedAt ?? null;
  } catch {
    return null;
  }
}

function saveTradesToCache(data: TradeRow[]): void {
  try {
    storage.setItem(TRADES_CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch { /* ignore */ }
}

const SERVER_PROXY = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url: string, timeoutMs = 10000): Promise<Response> {
  // 1. Server-side proxy (primary — no CORS restrictions)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(SERVER_PROXY(url), { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* server proxy unavailable — try fallbacks */ }

  // 2. Direct (works for same-origin or non-CORS URLs)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* CORS blocked */ }

  // 3. Third-party CORS proxies (legacy fallback)
  for (const proxy of CORS_PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(proxy(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch { continue; }
  }

  throw new Error('All fetch methods failed');
}

export const PoliticianTrades = () => {
  const [side, setSide] = useState<SideFilter>('ALL');
  const [politicianQ, setPoliticianQ] = useState('');
  const [symbolQ, setSymbolQ] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [pages, setPages] = useState(1);

  const { data, isLoading, isError, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['politician-trades', pages],
    queryFn: async (): Promise<TradeRow[]> => {
      const existingCached = loadTradesFromCache();

      const allTrades: TradeRow[] = [];
      let sourcesOk = { congress: false, capitol: false };

      // Fetch from CongressInvests (full history back to 2015, House + Senate)
      {
        const PAGE_SIZE = 500;
        const maxOffset = 6000;
        for (let offset = 0; offset < maxOffset; offset += PAGE_SIZE) {
          try {
            const res = await proxyFetch(`https://congressinvests.com/trades?limit=${PAGE_SIZE}&offset=${offset}`);
            const json = await res.json();
            const trades: any[] = json?.trades ?? [];
            if (!Array.isArray(trades) || trades.length === 0) break;
            sourcesOk.congress = true;
            for (const r of trades) {
              const tt = String(r.trade_type ?? '').toLowerCase();
              let side: Side = 'OTHER';
              if (tt === 'buy' || tt === 'purchase') side = 'BUY';
              else if (tt === 'sell' || tt === 'sale') side = 'SELL';
              const amountStr = String(r.amount ?? '');
              const parts = amountStr.split(/\s*[-–]\s*/);
              const clean = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || null;
              allTrades.push({
                id: `ci-${r.link ?? ''}`,
                symbol: String(r.ticker ?? ''),
                politician: String(r.member ?? ''),
                transaction_date: String(r.tx_date ?? '').slice(0, 10),
                filing_date: r.disclosed ? String(r.disclosed).slice(0, 10) : null,
                transaction_type: side,
                amount_from: parts.length === 2 ? clean(parts[0]) : clean(amountStr),
                amount_to: parts.length === 2 ? clean(parts[1]) : null,
                asset_name: r.asset ? String(r.asset) : null,
                position_held: r.chamber ? String(r.chamber) : null,
              });
            }
            if (!json?.has_more) break;
          } catch { break; }
        }
      }

      // Also fetch from CapitolExposed (recent ~30 days)
      for (let p = 1; p <= 10; p++) {
        try {
          const res = await proxyFetch(`https://www.capitolexposed.com/api/v1/trades?page=${p}&per_page=100`);
          const json = await res.json();
          const rows: unknown[] = json?.data ?? (Array.isArray(json) ? json : []);
          if (!Array.isArray(rows) || rows.length === 0) break;
          sourcesOk.capitol = true;
          for (const r of rows) {
            const raw = r as Record<string, unknown>;
            const tt = String(raw.transaction_type ?? '').toLowerCase();
            let side: Side = 'OTHER';
            if (tt === 'purchase' || tt === 'buy') side = 'BUY';
            else if (tt === 'sale' || tt === 'sale_full' || tt === 'sell') side = 'SELL';
            else if (tt === 'exchange' || tt === 'exchange_received' || tt === 'exchange_sold') side = 'EXCHANGE';
            allTrades.push({
              id: String(raw.id ?? ''),
              symbol: String(raw.ticker ?? ''),
              politician: String(raw.member_name ?? ''),
              transaction_date: String(raw.transaction_date ?? '').slice(0, 10),
              filing_date: raw.disclosure_date ? String(raw.disclosure_date).slice(0, 10) : null,
              transaction_type: side,
              amount_from: raw.amount_min ? Number(String(raw.amount_min).replace(/[^0-9.]/g, '')) || null : null,
              amount_to: raw.amount_max ? Number(String(raw.amount_max).replace(/[^0-9.]/g, '')) || null : null,
              asset_name: raw.asset_description ? String(raw.asset_description) : null,
              position_held: raw.owner ? String(raw.owner) : null,
            });
          }
          const hasMore = json?.meta?.has_more ?? rows.length >= 100;
          if (!hasMore) break;
        } catch { break; }
      }

      // Merge with existing cached data so partial failures don't lose what we have
      let merged: TradeRow[];
      if (allTrades.length > 0) {
        // Dedup newly fetched trades among themselves
        const seen = new Set<string>();
        const fetched = allTrades.filter((t) => {
          const key = `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Merge with existing cache: keep cached trades not in fetched set
        const fetchedKeys = new Set(fetched.map((t) => `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`));
        const preserved = (existingCached || []).filter((t) => {
          const key = `${t.symbol}|${t.politician}|${t.transaction_date}|${t.transaction_type}`;
          return !fetchedKeys.has(key);
        });

        merged = [...fetched, ...preserved];
      } else if (existingCached && existingCached.length > 0) {
        // Both APIs failed — use cached data as-is
        merged = existingCached;
      } else {
        throw new Error('No data available from any source');
      }

      // Sort by disclosed date newest first, fall back to transaction date
      merged.sort((a, b) => {
        const da = a.filing_date || a.transaction_date;
        const db = b.filing_date || b.transaction_date;
        return db.localeCompare(da);
      });

      saveTradesToCache(merged);
      return merged;
    },
    staleTime: 1000 * 60 * 30,
  });

  const filtered = useMemo(() => {
    const list = data || [];
    const pq = politicianQ.trim().toLowerCase();
    const sq = symbolQ.trim().toUpperCase();
    return list.filter((t) => {
      if (side !== 'ALL' && t.transaction_type !== side) return false;
      if (pq && !t.politician.toLowerCase().includes(pq)) return false;
      if (sq && !t.symbol.toUpperCase().includes(sq)) return false;
      return true;
    });
  }, [data, side, politicianQ, symbolQ]);

  const hasActiveFilter = politicianQ.trim() !== '' || symbolQ.trim() !== '' || side !== 'ALL';
  const visible = (expanded || hasActiveFilter) ? filtered : filtered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = Math.max(0, filtered.length - DEFAULT_VISIBLE);
  const canLoadMore = (data?.length ?? 0) >= pages * PAGE_SIZE;

  const cacheFetchedAt = loadCacheFetchedAt();
  const isStale = cacheFetchedAt ? (Date.now() - cacheFetchedAt) > 1000 * 60 * 60 * 24 : true;
  const lastUpdatedText = cacheFetchedAt
    ? new Date(cacheFetchedAt).toLocaleString()
    : null;

  const queryClient = useQueryClient();
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['politician-trades'] });
  };
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['politician-trades'] });
    window.addEventListener('stockpulse-politician-sync', handler);
    return () => window.removeEventListener('stockpulse-politician-sync', handler);
  }, [queryClient]);

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5 text-primary" />
            Politician Trades
          </CardTitle>
          <div className="flex gap-1">
            {(['ALL', 'BUY', 'SELL'] as SideFilter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={side === f ? 'default' : 'outline'}
                onClick={() => setSide(f)}
                className="h-7 px-3 text-xs"
              >
                {f}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          US Congressional STOCK Act disclosures (House Clerk &amp; Senate eFD) plus
          President Donald J. Trump's OGE Form 278T filings. Data from CongressInvests and CapitolExposed.
        </p>
        <div className="flex items-center gap-2 text-xs">
          {lastUpdatedText && (
            <span className={cn('flex items-center gap-1', isStale ? 'text-amber-400' : 'text-muted-foreground')}>
              {isStale && <AlertCircle className="h-3 w-3" />}
              Last updated: {lastUpdatedText}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            disabled={isFetching}
            className="h-6 px-2 text-xs"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            placeholder="Filter by politician (e.g. Pelosi, Trump)"
            value={politicianQ}
            onChange={(e) => setPoliticianQ(e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            placeholder="Filter by symbol (e.g. NVDA)"
            value={symbolQ}
            onChange={(e) => setSymbolQ(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading trades...
            </div>
          ) : isError ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Unable to load politician trades.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No trades match your filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Politician</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="hidden md:table-cell">Traded</TableHead>
                  <TableHead className="hidden md:table-cell">Disclosed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => {
                  const isBuy = t.transaction_type === 'BUY';
                  const isSell = t.transaction_type === 'SELL';
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{t.politician}</span>
                          {t.position_held && (
                            <span className="text-[10px] text-muted-foreground">{t.position_held}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-mono font-semibold">{t.symbol}</span>
                          {t.asset_name && (
                            <span className="text-[10px] text-muted-foreground line-clamp-1">{t.asset_name}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'gap-1',
                            isBuy && 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                            isSell && 'bg-rose-500/15 text-rose-400 border-rose-500/30',
                            !isBuy && !isSell && 'bg-muted text-muted-foreground',
                          )}
                        >
                          {isBuy && <ArrowUpRight className="h-3 w-3" />}
                          {isSell && <ArrowDownRight className="h-3 w-3" />}
                          {t.transaction_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatAmount(t.amount_from, t.amount_to)}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{t.transaction_date}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{t.filing_date || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
            <span className="text-xs text-muted-foreground">
              Showing {visible.length} of {filtered.length} {!expanded && hiddenCount > 0 ? `(+${hiddenCount} hidden)` : ''}
            </span>
            <div className="flex gap-2">
              {hiddenCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpanded((v) => !v)}
                  className="h-8 text-xs"
                >
                  {expanded ? (
                    <><ChevronUp className="h-3 w-3 mr-1" /> Collapse</>
                  ) : (
                    <><ChevronDown className="h-3 w-3 mr-1" /> Show all ({filtered.length})</>
                  )}
                </Button>
              )}
              {canLoadMore && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPages((p) => p + 1)}
                  disabled={isFetching}
                  className="h-8 text-xs"
                >
                  {isFetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                  Load older records
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
