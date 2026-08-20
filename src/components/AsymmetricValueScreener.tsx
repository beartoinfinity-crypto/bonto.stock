import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { edgeFn, isEdgeFnAvailable } from '@/lib/edgeFn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Target, RefreshCw, Users, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import * as storage from '@/lib/storage';

interface AvsRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  market_cap: number | null;
  insider_count: number;
  insider_value: number;
  insider_score: number;
  nav_per_share: number | null;
  tangible_nav_per_share: number | null;
  nav_discount: number | null;
  pb_ratio: number | null;
  cash_to_mcap: number | null;
  value_score: number;
  momentum_score: number;
  total_score: number;
  classification: string | null;
  confidence: string | null;
  details: {
    clusterQualifies?: boolean;
    seniorCount?: number;
    insiders?: { owner: string; title: string; value: number; date: string }[];
  } | null;
  computed_at: string;
}

const fmtMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;

const classColor = (c: string | null) => {
  switch (c) {
    case 'High Conviction':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'Watch List':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'Background':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
};

const AVS_CACHE_KEY = 'stockpulse_avs_results';

function loadAvsFromCache(): AvsRow[] | null {
  try {
    const raw = storage.getItem(AVS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveAvsToCache(rows: AvsRow[]): void {
  try {
    storage.setItem(AVS_CACHE_KEY, JSON.stringify(rows));
  } catch { /* ignore */ }
}

export const AsymmetricValueScreener = () => {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['avs-results'],
    queryFn: async (): Promise<AvsRow[]> => {
      const cached = loadAvsFromCache();
      if (cached && cached.length > 0) return cached;
      return [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (data ?? []).filter(
      (r) =>
        r.total_score >= minScore &&
        (!q || r.symbol.includes(q) || (r.name ?? '').toUpperCase().includes(q)),
    );
  }, [data, search, minScore]);

  const visible = expanded ? rows : rows.slice(0, 10);
  const lastRun = data?.[0]?.computed_at ? new Date(data[0].computed_at) : null;
  const highConviction = (data ?? []).filter((r) => r.classification === 'High Conviction').length;

  const runScreen = async () => {
    if (!isEdgeFnAvailable()) {
      toast({ title: 'Not available', description: 'Asymmetric Value Screener requires Supabase edge functions. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.', variant: 'destructive' });
      return;
    }
    setIsRunning(true);
    toast({ title: 'Running Asymmetric Value Screener', description: 'Pulling SEC Form 4 and balance-sheet data — this can take a couple of minutes.' });
    try {
      const { data: res, error } = await edgeFn('asymmetric-value-screener', {});
      if (error) throw error;
      // Fetch updated results from Supabase REST and cache locally
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/avs_results?select=*&order=total_score.desc`;
        const resp = await fetch(url, {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        if (resp.ok) {
          const rows: AvsRow[] = await resp.json();
          if (rows.length > 0) saveAvsToCache(rows);
        }
      } catch { /* cache update failed, ignore */ }
      await queryClient.invalidateQueries({ queryKey: ['avs-results'] });
      toast({ title: 'Screen complete', description: `${res?.processed ?? 0} companies analyzed.` });
    } catch (e) {
      toast({
        title: 'Screen failed',
        description: e instanceof Error ? e.message : 'Unable to run the screener right now.',
        variant: 'destructive',
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Asymmetric Value Screener
          </CardTitle>
          <CardDescription>
            Insider buying clusters (SEC Form 4, {`≥3 insiders / ≥$500K / 60 days`}) crossed with hidden asset value
            (NAV discount, P/B, cash cushion). Composite score = 50% insider · 40% value · 10% momentum.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={runScreen} disabled={isRunning}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isRunning && 'animate-spin')} />
          {isRunning ? 'Screening…' : 'Run screen'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Universe screened</p>
            <p className="text-lg font-semibold">{data?.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">High conviction (80+)</p>
            <p className="text-lg font-semibold text-emerald-400">{highConviction}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Insider clusters found</p>
            <p className="text-lg font-semibold">{(data ?? []).filter((r) => r.details?.clusterQualifies).length}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Last run</p>
            <p className="text-sm font-medium">{lastRun ? lastRun.toLocaleString() : 'Never'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter by symbol or company"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          {[0, 40, 60, 80].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={minScore === s ? 'default' : 'outline'}
              onClick={() => setMinScore(s)}
            >
              {s === 0 ? 'All' : `${s}+`}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No results yet. Click “Run screen” to pull SEC insider filings and balance-sheet data.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">NAV/sh</TableHead>
                    <TableHead className="text-right">NAV disc.</TableHead>
                    <TableHead className="text-right">P/B</TableHead>
                    <TableHead className="text-right">Cash/Mcap</TableHead>
                    <TableHead className="text-right">Insiders</TableHead>
                    <TableHead className="text-right">Insider $</TableHead>
                    <TableHead className="w-40">Score</TableHead>
                    <TableHead>Signal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <>
                      <TableRow
                        key={r.symbol}
                        className="cursor-pointer"
                        onClick={() => setDetailSymbol(detailSymbol === r.symbol ? null : r.symbol)}
                      >
                        <TableCell>
                          <div className="font-semibold">{r.symbol}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{r.name}</div>
                        </TableCell>
                        <TableCell className="text-right">{r.price ? `$${r.price.toFixed(2)}` : '—'}</TableCell>
                        <TableCell className="text-right">
                          {r.nav_per_share ? `$${r.nav_per_share.toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right',
                            (r.nav_discount ?? 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground',
                          )}
                        >
                          {fmtPct(r.nav_discount)}
                        </TableCell>
                        <TableCell className="text-right">{r.pb_ratio ? r.pb_ratio.toFixed(2) : '—'}</TableCell>
                        <TableCell className="text-right">{fmtPct(r.cash_to_mcap)}</TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            {r.insider_count}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{r.insider_value ? fmtMoney(r.insider_value) : '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={r.total_score} className="h-2" />
                            <span className="text-xs font-semibold w-7 text-right">{r.total_score}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={classColor(r.classification)}>
                            {r.classification ?? '—'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {detailSymbol === r.symbol && (
                        <TableRow key={`${r.symbol}-detail`}>
                          <TableCell colSpan={10} className="bg-muted/30">
                            <div className="grid gap-4 md:grid-cols-3 py-2">
                              <div>
                                <p className="text-xs font-semibold mb-1 flex items-center gap-1">
                                  <Layers className="h-3 w-3" /> Score breakdown
                                </p>
                                <p className="text-xs text-muted-foreground">Insider signal (50%): {r.insider_score}</p>
                                <p className="text-xs text-muted-foreground">Value (40%): {r.value_score}</p>
                                <p className="text-xs text-muted-foreground">Momentum/quality (10%): {r.momentum_score}</p>
                                <p className="text-xs text-muted-foreground">Data confidence: {r.confidence}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold mb-1">Asset value</p>
                                <p className="text-xs text-muted-foreground">Market cap: {fmtMoney(r.market_cap)}</p>
                                <p className="text-xs text-muted-foreground">
                                  Tangible NAV/sh:{' '}
                                  {r.tangible_nav_per_share ? `$${r.tangible_nav_per_share.toFixed(2)}` : '—'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Cluster qualifies: {r.details?.clusterQualifies ? 'Yes' : 'No'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Senior execs buying: {r.details?.seniorCount ?? 0}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold mb-1">Recent insider purchases (60d)</p>
                                {r.details?.insiders?.length ? (
                                  r.details.insiders.map((i, idx) => (
                                    <p key={idx} className="text-xs text-muted-foreground">
                                      {i.owner} · {i.title || 'Insider'} · {fmtMoney(i.value)} {i.date && `· ${i.date}`}
                                    </p>
                                  ))
                                ) : (
                                  <p className="text-xs text-muted-foreground">No qualifying open-market buys.</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>

            {rows.length > 10 && (
              <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
                {expanded ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-2" /> Collapse
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-2" /> Show all {rows.length}
                  </>
                )}
              </Button>
            )}
          </>
        )}

        {(data?.length ?? 0) > 0 && highConviction === 0 && (data ?? []).every((r) => r.insider_count === 0) && (
          <p className="text-xs text-amber-400/90">
            Every name is “Ignore” because no qualifying insider buying was found in the last 60 days. The insider
            signal carries 50% of the score, so value-only names top out near 40 — below the “Background” threshold.
            This is a normal reading for mega caps, where insiders mostly receive awards rather than buy on the open
            market.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Data: SEC EDGAR Form 4 (open-market code “P” purchases ≥ $100K) and XBRL balance-sheet facts. Financials/REITs
          are excluded because asset-value models differ. Research tool only — not investment advice.
        </p>
      </CardContent>
    </Card>
  );
};
