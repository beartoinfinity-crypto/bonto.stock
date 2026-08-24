import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Landmark, Loader2, Plus, AlertCircle, RefreshCw, Star, ExternalLink, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Side = 'BUY' | 'SELL' | 'EXCHANGE' | 'OTHER';
type SideFilter = 'ALL' | 'BUY' | 'SELL';
type SourceId = 'capitol' | 'congress' | 'unusualwhales' | 'stockspill';

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
  sources: Set<SourceId>;
  source_url?: string;
  source_name?: SourceId;
}

const PAGE_SIZE = 20;

const FEATURED_POLITICIANS = [
  { name: 'Donald J. Trump', slug: 'donald-trump', sources: ['unusualwhales'] as SourceId[], description: 'President — OGE Form 278T filings' },
  { name: 'Nancy Pelosi', slug: 'nancy-pelosi', sources: ['stockspill', 'unusualwhales'] as SourceId[], description: 'House (D-CA) — STOCK Act disclosures' },
];

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

function parseAmountRange(str: string | null): { from: number | null; to: number | null } {
  if (!str) return { from: null, to: null };
  const clean = (s: string) => Number(s.replace(/[^0-9.]/g, '')) || null;
  const parts = str.split(/\s*[-–]\s*/);
  if (parts.length === 2) return { from: clean(parts[0]), to: clean(parts[1]) };
  if (parts.length === 1) return { from: null, to: clean(parts[0]) };
  return { from: null, to: null };
}

const SERVER_PROXY = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url: string, timeoutMs = 10000): Promise<Response> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(SERVER_PROXY(url), { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* server proxy unavailable — try fallbacks */ }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* CORS blocked */ }
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

// ─── Map raw API rows to TradeRow ──────────────────────────────────

function mapCapitolRows(json: any): TradeRow[] {
  const rows: unknown[] = json?.data ?? (Array.isArray(json) ? json : []);
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const raw = r as Record<string, unknown>;
    const tt = String(raw.transaction_type ?? '').toLowerCase();
    let side: Side = 'OTHER';
    if (tt === 'purchase' || tt === 'buy') side = 'BUY';
    else if (tt === 'sale' || tt === 'sale_full' || tt === 'sell') side = 'SELL';
    else if (tt === 'exchange' || tt === 'exchange_received' || tt === 'exchange_sold') side = 'EXCHANGE';
    return {
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
      sources: new Set(['capitol'] as SourceId[]),
      source_url: raw.source_url ? String(raw.source_url) : undefined,
      source_name: 'capitol' as SourceId,
    };
  });
}

function mapCongressRows(json: any): TradeRow[] {
  const trades: any[] = json?.trades ?? [];
  if (!Array.isArray(trades)) return [];
  return trades.map((r) => {
    const tt = String(r.trade_type ?? '').toLowerCase();
    let side: Side = 'OTHER';
    if (tt === 'buy' || tt === 'purchase') side = 'BUY';
    else if (tt === 'sell' || tt === 'sale') side = 'SELL';
    const amountStr = String(r.amount ?? '');
    const parts = amountStr.split(/\s*[-–]\s*/);
    const clean = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || null;
    return {
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
      sources: new Set(['congress'] as SourceId[]),
      source_url: r.link ? String(r.link) : undefined,
      source_name: 'congress' as SourceId,
    };
  });
}

function mapUnusualWhalesRows(json: any): TradeRow[] {
  const trades: any[] = json?.trades ?? [];
  if (!Array.isArray(trades)) return [];
  return trades.map((r) => {
    const tt = String(r.txn_type ?? '').toLowerCase();
    let side: Side = 'OTHER';
    if (tt === 'buy' || tt === 'purchase') side = 'BUY';
    else if (tt === 'sell' || tt === 'sale') side = 'SELL';
    else if (tt === 'exchange') side = 'EXCHANGE';
    const { from, to } = parseAmountRange(r.amounts ?? null);
    return {
      id: `uw-${r.file_record_id ?? Math.random().toString(36).slice(2)}`,
      symbol: String(r.ticker ?? ''),
      politician: String(r.name ?? ''),
      transaction_date: String(r.transaction_date ?? '').slice(0, 10),
      filing_date: r.filed_at_date ? String(r.filed_at_date).slice(0, 10) : null,
      transaction_type: side,
      amount_from: from,
      amount_to: to,
      asset_name: r.issuer ? String(r.issuer) : null,
      position_held: r.affiliation ? String(r.affiliation) : null,
      sources: new Set(['unusualwhales'] as SourceId[]),
      source_url: r.link_url ? String(r.link_url) : undefined,
      source_name: 'unusualwhales' as SourceId,
    };
  });
}

function mapStockSpillRows(json: any): TradeRow[] {
  const trades: any[] = json?.trades ?? [];
  if (!Array.isArray(trades)) return [];
  return trades.map((r) => {
    const tt = String(r.transaction_type ?? '').toLowerCase();
    let side: Side = 'OTHER';
    if (tt === 'purchase' || tt === 'buy') side = 'BUY';
    else if (tt === 'sale' || tt === 'sell') side = 'SELL';
    else if (tt === 'exchange') side = 'EXCHANGE';
    const { from, to } = parseAmountRange(r.amount_range ?? null);
    return {
      id: `ss-${r.id ?? ''}`,
      symbol: String(r.ticker ?? ''),
      politician: String(r.member_name ?? ''),
      transaction_date: String(r.transaction_date ?? '').slice(0, 10),
      filing_date: r.disclosure_date ? String(r.disclosure_date).slice(0, 10) : null,
      transaction_type: side,
      amount_from: from,
      amount_to: to,
      asset_name: r.asset_name ? String(r.asset_name) : null,
      position_held: r.owner ? String(r.owner) : null,
      sources: new Set(['stockspill'] as SourceId[]),
      source_url: r.source_url ? String(r.source_url) : undefined,
      source_name: 'stockspill' as SourceId,
    };
  });
}

// ─── Merge / dedup helper ──────────────────────────────────────────

function mergeTrade(existing: TradeRow, incoming: TradeRow): TradeRow {
  const merged = { ...existing };
  for (const s of incoming.sources) merged.sources.add(s);
  if (!merged.source_url && incoming.source_url) merged.source_url = incoming.source_url;
  return merged;
}

function dedupKey(t: TradeRow): string {
  const date = t.transaction_date?.slice(0, 10) ?? '';
  const symbol = t.symbol?.toUpperCase() ?? '';
  const politician = t.politician?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  const side = t.transaction_type;
  return `${politician}|${symbol}|${date}|${side}`;
}

function mergeInto(target: TradeRow[], incoming: TradeRow[]): TradeRow[] {
  const map = new Map<string, TradeRow>();
  for (const t of target) map.set(dedupKey(t), t);
  for (const t of incoming) {
    const key = dedupKey(t);
    const existing = map.get(key);
    if (existing) {
      map.set(key, mergeTrade(existing, t));
    } else {
      map.set(key, t);
    }
  }
  return Array.from(map.values());
}

// ─── Component ─────────────────────────────────────────────────────

export const PoliticianTrades = () => {
  const [side, setSide] = useState<SideFilter>('ALL');
  const [politicianQ, setPoliticianQ] = useState('');
  const [symbolQ, setSymbolQ] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Data state
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // API pagination state
  const [capitolPage, setCapitolPage] = useState(2);
  const [congressOffset, setCongressOffset] = useState(0);
  const [source, setSource] = useState<'capitol' | 'congress' | 'done'>('capitol');
  const [hasMore, setHasMore] = useState(true);

  // Featured politician state
  const [featuredActive, setFeaturedActive] = useState<string | null>(null);
  const [featuredLoading, setFeaturedLoading] = useState(false);

  // ── Fetch featured politician trades ────────────────────────────
  const fetchFeatured = async (politician: typeof FEATURED_POLITICIANS[0]) => {
    setFeaturedLoading(true);
    setFeaturedActive(politician.slug);
    setTrades([]);
    setLoading(true);
    setError(false);

    const allTrades: TradeRow[] = [];

    for (const src of politician.sources) {
      try {
        if (src === 'unusualwhales') {
          const res = await fetch(`/api/politician-trades/unusualwhales?politician=${encodeURIComponent(politician.name)}`);
          if (res.ok) {
            const json = await res.json();
            allTrades.push(...mapUnusualWhalesRows(json));
          }
        } else if (src === 'stockspill') {
          const res = await fetch(`/api/politician-trades/stockspill?member_name=${encodeURIComponent(politician.name)}`);
          if (res.ok) {
            const json = await res.json();
            allTrades.push(...mapStockSpillRows(json));
          }
        }
      } catch { /* skip failed source */ }
    }

    // Also try CapitolExposed and CongressInvests for cross-check
    try {
      const res = await proxyFetch(`https://www.capitolexposed.com/api/v1/trades?page=1&per_page=100`);
      const json = await res.json();
      const capitolRows = mapCapitolRows(json);
      const matching = capitolRows.filter(r =>
        r.politician.toLowerCase().includes(politician.name.toLowerCase().split(' ').pop() ?? '')
      );
      allTrades.push(...matching);
    } catch { /* skip */ }

    try {
      const res = await proxyFetch(`https://congressinvests.com/trades?limit=100&offset=0`);
      const json = await res.json();
      const congressRows = mapCongressRows(json);
      const matching = congressRows.filter(r =>
        r.politician.toLowerCase().includes(politician.name.toLowerCase().split(' ').pop() ?? '')
      );
      allTrades.push(...matching);
    } catch { /* skip */ }

    setTrades(mergeInto([], allTrades));
    setFetchedAt(Date.now());
    setHasMore(false);
    setLoading(false);
    setFeaturedLoading(false);
  };

  // ── Initial fetch: 20 records only ─────────────────────────────
  const fetchInitial = async () => {
    setLoading(true);
    setError(false);
    setHasMore(true);
    setCapitolPage(2);
    setCongressOffset(0);
    setSource('capitol');
    setFeaturedActive(null);

    // Try CapitolExposed first (most recent ~30 days)
    try {
      const res = await proxyFetch(`https://www.capitolexposed.com/api/v1/trades?page=1&per_page=${PAGE_SIZE}`);
      const json = await res.json();
      const rows = mapCapitolRows(json);
      if (rows.length > 0) {
        setTrades(rows);
        setFetchedAt(Date.now());
        setLoading(false);
        return;
      }
    } catch { /* fall through */ }

    // Fallback: CongressInvests first page
    try {
      const res = await proxyFetch(`https://congressinvests.com/trades?limit=${PAGE_SIZE}&offset=0`);
      const json = await res.json();
      const rows = mapCongressRows(json);
      setTrades(rows);
      setFetchedAt(Date.now());
      setSource('congress');
      setCongressOffset(PAGE_SIZE);
    } catch {
      setError(true);
      setHasMore(false);
    }
    setLoading(false);
  };

  useEffect(() => { fetchInitial(); }, []);

  // ── Load more: fetch next page from current source ─────────────
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      if (source === 'capitol') {
        const res = await proxyFetch(`https://www.capitolexposed.com/api/v1/trades?page=${capitolPage}&per_page=${PAGE_SIZE}`);
        const json = await res.json();
        const rows = mapCapitolRows(json);
        if (rows.length > 0) {
          setTrades(prev => mergeInto(prev, rows));
          setCapitolPage(p => p + 1);
          setFetchedAt(Date.now());
        } else {
          setSource('congress');
        }
      } else if (source === 'congress') {
        const res = await proxyFetch(`https://congressinvests.com/trades?limit=${PAGE_SIZE}&offset=${congressOffset}`);
        const json = await res.json();
        const rows = mapCongressRows(json);
        if (rows.length > 0) {
          setTrades(prev => mergeInto(prev, rows));
          setCongressOffset(o => o + PAGE_SIZE);
          setFetchedAt(Date.now());
        } else {
          setSource('done');
          setHasMore(false);
        }
      }
    } catch {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  // ── Refresh: re-fetch from scratch ─────────────────────────────
  const handleRefresh = () => {
    setTrades([]);
    if (featuredActive) {
      const fp = FEATURED_POLITICIANS.find(p => p.slug === featuredActive);
      if (fp) { fetchFeatured(fp); return; }
    }
    fetchInitial();
  };

  // ── Client-side filter ─────────────────────────────────────────
  const filtered = useMemo(() => {
    const pq = politicianQ.trim().toLowerCase();
    const sq = symbolQ.trim().toUpperCase();
    return trades.filter((t) => {
      if (side !== 'ALL' && t.transaction_type !== side) return false;
      if (pq && !t.politician.toLowerCase().includes(pq)) return false;
      if (sq && !t.symbol.toUpperCase().includes(sq)) return false;
      return true;
    });
  }, [trades, side, politicianQ, symbolQ]);

  const hasActiveFilter = politicianQ.trim() !== '' || symbolQ.trim() !== '' || side !== 'ALL';
  const DEFAULT_VISIBLE = 10;
  const visible = (expanded || hasActiveFilter) ? filtered : filtered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = Math.max(0, filtered.length - DEFAULT_VISIBLE);

  const isStale = fetchedAt ? (Date.now() - fetchedAt) > 1000 * 60 * 60 * 24 : true;
  const lastUpdatedText = fetchedAt ? new Date(fetchedAt).toLocaleString() : null;

  const SOURCE_LABELS: Record<SourceId, string> = {
    capitol: 'CapitolExposed',
    congress: 'CongressInvests',
    unusualwhales: 'UnusualWhales',
    stockspill: 'StockSpill',
  };

  const SOURCE_COLORS: Record<SourceId, string> = {
    capitol: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    congress: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    unusualwhales: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    stockspill: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  };

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
          President Donald J. Trump's OGE Form 278T filings. Data from CongressInvests, CapitolExposed, UnusualWhales, and StockSpill.
        </p>

        {/* ── Featured Politicians ────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {FEATURED_POLITICIANS.map((fp) => (
            <Button
              key={fp.slug}
              size="sm"
              variant={featuredActive === fp.slug ? 'default' : 'outline'}
              onClick={() => featuredActive === fp.slug ? handleRefresh() : fetchFeatured(fp)}
              disabled={featuredLoading}
              className="h-8 text-xs gap-1.5"
            >
              <Star className={cn('h-3 w-3', featuredActive === fp.slug && 'fill-current')} />
              {fp.name}
              <span className="text-[10px] text-muted-foreground ml-1 hidden sm:inline">{fp.description}</span>
            </Button>
          ))}
          {featuredActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setFeaturedActive(null); fetchInitial(); }}
              className="h-8 text-xs"
            >
              View all
            </Button>
          )}
        </div>

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
            disabled={loading}
            className="h-6 px-2 text-xs"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', loading && 'animate-spin')} />
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
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {featuredLoading ? 'Fetching featured politician data...' : 'Loading trades...'}
            </div>
          ) : error ? (
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
                  <TableHead className="hidden md:table-cell">Source</TableHead>
                  <TableHead className="hidden md:table-cell">Traded</TableHead>
                  <TableHead className="hidden md:table-cell">Disclosed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => {
                  const isBuy = t.transaction_type === 'BUY';
                  const isSell = t.transaction_type === 'SELL';
                  const sourceCount = t.sources.size;
                  const isCrossChecked = sourceCount >= 2;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{t.politician}</span>
                            {isCrossChecked && (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" title="Cross-checked by multiple sources" />
                            )}
                          </div>
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
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(t.sources).map(s => (
                            <Badge key={s} variant="outline" className={cn('text-[10px] px-1.5 py-0', SOURCE_COLORS[s])}>
                              {SOURCE_LABELS[s]}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
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
              Showing {visible.length} of {filtered.length}{!expanded && hiddenCount > 0 ? ` (+${hiddenCount} hidden)` : ''}
              {trades.length < 1000 && ` (${trades.length} loaded)`}
            </span>
            <div className="flex gap-2">
              {hiddenCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpanded(v => !v)}
                  className="h-8 text-xs"
                >
                  {expanded ? (
                    <><ChevronUp className="h-3 w-3 mr-1" /> Collapse</>
                  ) : (
                    <><ChevronDown className="h-3 w-3 mr-1" /> Show all ({filtered.length})</>
                  )}
                </Button>
              )}
              {hasMore && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="h-8 text-xs"
                >
                  {loadingMore ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
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
