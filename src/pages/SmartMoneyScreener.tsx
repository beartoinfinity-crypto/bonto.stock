import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import { ResearchNotes, type ResearchNote } from '@/components/ResearchNotes';
import { Radar, RefreshCw, ChevronDown, ChevronUp, ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import * as storage from '@/lib/storage';
import {
  CAP_TIERS,
  FAST_MANAGERS,
  runSmartMoneyScan,
  universeForMode,
  modeUniverseSize,
  fetchQuoteShort,
  totalScore,
  computeSqueezeScore,
  serverScanForMode,
  serverScanQueryForMode,
  SERVER_SCANNED_MODES,
  type SmartMoneyRow,
  type SmartMoneyScanDbRow,
  type ScanProgress,
  type UniverseMode,
} from '@/lib/smartMoney';
import { edgeRest } from '@/lib/edgeFn';

const SCAN_CACHE_KEY = 'stockpulse_sm_scan';
// v2: the v1 cache was filled while the Form 4 fetcher parsed EDGAR's HTML
// viewer (all-empty buys) — bump the key so those results are ignored.
// v3: universe modes (curated/index) — bump so mode-less v2 caches are ignored.
const INSIDER_CACHE_KEY = 'stockpulse_sm_insider_v3';
const INSIDER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — index Form 4s are expensive
const SCAN_TTL_MS = 24 * 60 * 60 * 1000;

const fmtMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : `${v.toFixed(digits)}%`;

const classColor = (c: SmartMoneyRow['classification']) => {
  switch (c) {
    case 'Strong': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'Watch': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'Light': return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
};

const SignalDot = ({ score, max, active, inactive }: { score: number; max: number; active: string; inactive: string }) => (
  <span
    className={cn(
      'inline-block h-2 w-2 rounded-full',
      score > 0 ? active : inactive,
      score === max && 'ring-2 ring-offset-1 ring-offset-background',
    )}
    title={score > 0 ? `${score}/${max}` : undefined}
  />
);

const NOTES: ResearchNote[] = [
  { term: 'A four-signal composite (0–100)', body: 'Score = insider 25 + institutional 25 + congress 20 + squeeze 30. Squeeze carries the most weight because crowded shorts plus momentum is the most explosive setup; congress the least because disclosures arrive with a ~45-day lag. Every input is computed live from public filings and quotes — no AI, no paid data.' },
  { term: 'Insider buying (0–25)', body: 'SEC Form 4 open-market purchases (transaction code “P”) of at least $100K in the last 60 days. A single qualifying buy scores 15; a cluster of 3+ distinct insiders totalling $500K+ scores 25. The scan reads each company’s 20 most recent Form 4s in the window — grant/sell filings crowd the list, so an older qualifying buy can be missed. Mega caps rarely score here: their insiders receive equity awards rather than buy in the open market.' },
  { term: 'Institutional ownership (0–25)', body: `Latest 13F-HR holdings of ${FAST_MANAGERS.length} famous managers whose filings are small enough to parse in a browser (Berkshire, Bridgewater, Baupost, Pershing Square, Scion, Soros, Tiger Global, Greenlight, Lone Pine, Coatue). 1 manager = 15, 2 = 20, 3+ = 25. 13F carries CUSIPs, not tickers — matches are made on normalized issuer names, so some positions go unmatched. The mega index funds (Vanguard, BlackRock, State Street) are deliberately excluded: they hold everything and signal nothing. See /funds for full manager browsing.` },
  { term: 'Congress trades (0–20)', body: 'STOCK Act disclosures from the Kadoa congress-trading feed for the past 12 months. Any disclosed purchase scores 20; sells-only scores 8 (a sell is often portfolio pruning, not a short thesis). Remember the ~45-day disclosure lag: you are reading last month’s action, never a real-time signal.' },
  { term: 'Squeeze pressure (0–30)', body: 'Short interest as a percent of float from Yahoo: ≥5% = 10 pts, ≥10% = 20, ≥20% = 30. Days-to-cover (short ratio) is shown in the detail row as context — high short interest plus low days-to-cover is the classic squeeze fuel. A missing reading (Yahoo throttling, thin coverage) scores 0, not a penalty.' },
  { term: 'Reading the table', body: 'Pick a universe (Curated 41, S&P 500 + NDX, S&P 500, or NASDAQ-100), then Run screen. Default sort is score descending. The four dots per row light up when that signal scored (blue insider, violet institutional, amber congress, rose squeeze). Classification: Strong ≥60, Watch ≥40, Light >0. Click any row to expand the full breakdown and lazy-load short interest. Index universes (~500 symbols) scan insider Form 4s in ~100-symbol batches to respect SEC fair-access limits — use “Scan next 100” to cover the rest; results and the insider scan cache so re-runs are fast.' },
];

interface CachedScan { at: number; rows: SmartMoneyRow[] }
interface CachedInsider { at: number; buys: SmartMoneyRow['insider']['buys'] }

function loadScan(mode: UniverseMode): SmartMoneyRow[] | null {
  try {
    const raw = storage.getItem(`${SCAN_CACHE_KEY}_${mode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedScan;
    if (!parsed?.rows?.length || Date.now() - parsed.at > SCAN_TTL_MS) return null;
    return parsed.rows;
  } catch { return null; }
}

function saveScan(mode: UniverseMode, rows: SmartMoneyRow[]): void {
  try { storage.setItem(`${SCAN_CACHE_KEY}_${mode}`, JSON.stringify({ at: Date.now(), rows })); } catch { /* ignore */ }
}

function loadInsiderCache(): Record<string, SmartMoneyRow['insider']['buys']> {
  const out: Record<string, SmartMoneyRow['insider']['buys']> = {};
  try {
    const raw = storage.getItem(INSIDER_CACHE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, CachedInsider>;
    for (const [sym, entry] of Object.entries(parsed)) {
      if (entry?.buys && Date.now() - entry.at <= INSIDER_TTL_MS) out[sym] = entry.buys;
    }
  } catch { /* ignore */ }
  return out;
}

function saveInsiderBuy(symbol: string, buys: SmartMoneyRow['insider']['buys']): void {
  try {
    const all = ((): Record<string, CachedInsider> => {
      try { return JSON.parse(storage.getItem(INSIDER_CACHE_KEY) || '{}'); } catch { return {}; }
    })();
    all[symbol] = { at: Date.now(), buys };
    storage.setItem(INSIDER_CACHE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

type SortKey = 'score' | 'change' | 'mktcap' | 'short' | 'insider' | 'institutional' | 'congress' | 'price';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortKey, string> = {
  score: 'signal score',
  change: 'gainers',
  mktcap: 'market cap',
  short: 'short interest',
  insider: 'insider buying',
  institutional: '13F managers',
  congress: 'congress activity',
  price: 'price',
};

export default function SmartMoneyScreener() {
  const [mode, setMode] = useState<UniverseMode>('curated');
  const [rows, setRows] = useState<SmartMoneyRow[]>([]);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('All sectors');
  const [capTier, setCapTier] = useState('All caps');
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const universe = useMemo(() => universeForMode(mode), [mode]);
  const sectors = useMemo(() => ['All sectors', ...[...new Set(universe.map(u => u.sector))].sort()], [universe]);
  const pendingCount = useMemo(() => rows.filter(r => r.insiderPending).length, [rows]);

  useEffect(() => {
    let cancelled = false;
    // Every mode has a local 24h cache — show it immediately. On top of that
    // we overwrite with the fresher server pre-scan (index union, filtered to
    // this mode's symbols — see SERVER_SCANNED_MODES).
    const cached = loadScan(mode);
    setRows(cached ?? []);
    setExpanded(false);
    setDetailSymbol(null);
    if (!SERVER_SCANNED_MODES.has(mode)) {
      setSyncing(false);
      return () => { cancelled = true; };
    }
    (async () => {
      const q = serverScanQueryForMode(mode);
      if (!q || cancelled) return;
      setSyncing(true);
      try {
        const remote = await edgeRest<SmartMoneyScanDbRow[]>(q);
        if (cancelled) return;
        const serverRows = serverScanForMode(mode, remote ?? []);
        if (serverRows.length) {
          setRows(serverRows);
          saveScan(mode, serverRows);
        }
      } catch {
        /* keep the local cache when the server pre-scan is unreachable */
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode]);

  const runScan = useCallback(async (opts: { bucket?: number } = {}) => {
    setRunning(true);
    setError(null);
    const targets = universeForMode(mode);
    setProgress({ stage: 'insider', done: 0, total: targets.length, label: 'SEC Form 4 insider scan' });
    toast.message('Running Smart Money Screener', {
      description: 'First run pulls SEC Form 4 filings — later runs use the 1-hour EDGAR cache.',
    });
    try {
      const result = await runSmartMoneyScan({
        universe: targets,
        insiderCache: loadInsiderCache(),
        onInsiderCached: saveInsiderBuy,
        onProgress: setProgress,
        insiderBucket: opts.bucket,
      });
      setRows(result);
      saveScan(mode, result);
      const strong = result.filter(r => r.classification === 'Strong').length;
      const pending = result.filter(r => r.insiderPending).length;
      toast.success('Screen complete', {
        description: pending
          ? `${result.length} scanned · ${strong} Strong (60+) · insider pending for ${pending}.`
          : `${result.length} stocks scanned · ${strong} Strong (60+).`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setError(msg);
      toast.error('Screen failed', { description: msg });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [mode]);

  // Lazy short-interest: index universes only fetch squeeze stats for the
  // top-100 during a scan. Fetching on row expand fills the rest on demand.
  const loadSqueeze = useCallback(async (symbol: string) => {
    setRows(prev => prev.map(x => (x.symbol === symbol ? { ...x, squeezeLoading: true } : x)));
    try {
      const q = await fetchQuoteShort(symbol);
      setRows(prev => prev.map(x => (x.symbol === symbol
        ? {
            ...x,
            squeezeLoading: false,
            squeeze: { ...x.squeeze, shortPercentOfFloat: q.shortPercentOfFloat, shortRatio: q.shortRatio },
            score: totalScore(x.insider, x.institutional, x.congress, computeSqueezeScore(q.shortPercentOfFloat, q.shortRatio)),
            squeezeLoaded: true,
          }
        : x)));
    } catch {
      setRows(prev => prev.map(x => (x.symbol === symbol ? { ...x, squeezeLoading: false } : x)));
    }
  }, []);

  const toggleDetail = useCallback((symbol: string) => {
    const row = rows.find(x => x.symbol === symbol);
    if (detailSymbol === symbol) {
      setDetailSymbol(null);
      return;
    }
    setDetailSymbol(symbol);
    if (row && !row.squeezeLoaded && !row.squeezeLoading) void loadSqueeze(symbol);
  }, [rows, detailSymbol, loadSqueeze]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const out = rows.filter(r =>
      r.score >= minScore
      && (sector === 'All sectors' || r.sector === sector)
      && (capTier === 'All caps' || r.capTier === capTier)
      && (!q || r.symbol.includes(q) || r.name.toUpperCase().includes(q)),
    );
    const valueOf = (r: SmartMoneyRow): number => {
      switch (sort) {
        case 'change': return r.changePercent ?? -Infinity;
        case 'mktcap': return r.marketCap ?? -Infinity;
        case 'short': return r.squeeze.shortPercentOfFloat ?? -Infinity;
        case 'insider': return r.insider.totalValue;
        case 'institutional': return r.institutional.holdings.length;
        case 'congress': return r.congress.buys + r.congress.sells;
        case 'price': return r.price ?? -Infinity;
        default: return r.score;
      }
    };
    return out.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      const byValue = sortDir === 'asc' ? av - bv : bv - av;
      return byValue || a.symbol.localeCompare(b.symbol);
    });
  }, [rows, search, sector, capTier, minScore, sort, sortDir]);

  const visible = expanded ? filtered : filtered.slice(0, 25);
  const strong = rows.filter(r => r.classification === 'Strong').length;
  const watch = rows.filter(r => r.classification === 'Watch').length;
  const top = rows.length ? [...rows].sort((a, b) => b.score - a.score)[0] : null;
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  const sortedByScoreDesc = sort === 'score' && sortDir === 'desc';

  const toggleSort = (key: SortKey) => {
    if (sort === key) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(key); setSortDir('desc'); }
  };

  const sortHead = (key: SortKey, label: string, right = false) => (
    <TableHead className={right ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', right && 'w-full justify-end')}
        title={`Sort by ${SORT_LABELS[key]}`}
      >
        {label}
        {sort === key && (sortDir === 'desc'
          ? <ArrowDown className="h-3 w-3" />
          : <ArrowUp className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Radar className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Smart Money Screener</h1>
              <p className="text-xs text-muted-foreground">
                {rows.length
                  ? `${mode === 'curated' ? 'Curated 41-stock' : mode === 'index' ? 'S&P 500 + NDX' : mode === 'sp500' ? 'S&P 500' : 'NASDAQ-100'} universe · live insider · 13F · congress · short-interest signals`
                  : 'Pick a universe, then click “Run screen” to pull live SEC, congress and short-interest data'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={v => setMode(v as UniverseMode)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['curated', 'index', 'sp500', 'ndx100'] as UniverseMode[]).map(m => (
                  <SelectItem key={m} value={m}>
                    {modeUniverseSize(m)} · {m === 'curated' ? 'Curated' : m === 'index' ? 'S&P 500 + NDX' : m === 'sp500' ? 'S&P 500' : 'NASDAQ-100'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => runScan()} disabled={running}>
              <RefreshCw className={cn('h-4 w-4 mr-2', running && 'animate-spin')} />
              {running ? 'Screening…' : rows.length ? 'Re-run screen' : 'Run screen'}
            </Button>
          </div>
        </div>

        {syncing && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading {modeUniverseSize(mode)} rows from the daily scan…
          </p>
        )}

        {running && progress && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{progress.label}</span>
                <span className="text-muted-foreground">{progress.done}/{progress.total}</span>
              </div>
              <Progress value={pct} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Paced SEC requests — the first scan takes ~2 minutes. You can leave this page open; results cache for 24 hours.
              </p>
            </CardContent>
          </Card>
        )}

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {!running && pendingCount > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-amber-200/90">
                Insider (Form 4) scan pending for <span className="font-semibold">{pendingCount}</span> of {rows.length} stocks —
                index universes scan ~100 per run to stay within SEC fair-access limits.
              </p>
              <Button size="sm" onClick={() => runScan({ bucket: 100 })} disabled={running}>
                Scan next 100
              </Button>
            </CardContent>
          </Card>
        )}

        {rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Scanned</p>
              <p className="text-lg font-semibold">{rows.length}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Strong (60+)</p>
              <p className="text-lg font-semibold text-emerald-400">{strong}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Watch (40–59)</p>
              <p className="text-lg font-semibold text-amber-400">{watch}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!top) return;
                setSearch(prev => (prev === top.symbol ? '' : top.symbol));
                document.getElementById('sm-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="rounded-lg border border-border/60 p-3 text-left transition-colors hover:bg-accent/20"
              title={top ? `Filter to ${top.symbol} (${top.score}/100)` : undefined}
            >
              <p className="text-xs text-muted-foreground">Top score</p>
              <p className="text-lg font-semibold">{top ? `${top.symbol} · ${top.score}/100` : '—'}</p>
            </button>
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by symbol or company"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={capTier} onValueChange={setCapTier}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAP_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {[0, 40, 60].map(s => (
              <Button
                key={s}
                size="sm"
                variant={minScore === s ? 'default' : 'outline'}
                onClick={() => setMinScore(s)}
              >
                {s === 0 ? 'All scores' : `${s}+`}
              </Button>
            ))}
            <Select value={sort} onValueChange={v => { setSort(v as SortKey); setSortDir('desc'); }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Signal score</SelectItem>
                <SelectItem value="change">Top gainers</SelectItem>
                <SelectItem value="mktcap">Largest cap</SelectItem>
                <SelectItem value="short">Most shorted</SelectItem>
                <SelectItem value="insider">Insider buying</SelectItem>
                <SelectItem value="institutional">13F managers</SelectItem>
                <SelectItem value="congress">Congress activity</SelectItem>
                <SelectItem value="price">Price</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {rows.length === 0 && !running ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              No results yet. Run the screen to pull live SEC Form 4 filings, 13F holdings, congress disclosures and
              short interest for the {universe.length}-stock universe.
            </p>
            <Button onClick={() => runScan()} disabled={running}>
              <RefreshCw className={cn('h-4 w-4 mr-2', running && 'animate-spin')} /> Run screen
            </Button>
          </div>
        ) : rows.length > 0 && (
          <div id="sm-results" className="space-y-2 scroll-mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Showing {visible.length === 0 ? 0 : 1}–{visible.length} of {filtered.length}
                {' · '}sorted by {SORT_LABELS[sort]} {sortDir === 'desc' ? '↓' : '↑'}
              </span>
              {!expanded && filtered.length > visible.length && (
                <button type="button" className="hover:text-foreground" onClick={() => setExpanded(true)}>
                  Show all {filtered.length}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  {sortHead('score', 'Score')}
                  {sortHead('insider', 'Insider $', true)}
                  {sortHead('institutional', '13F mgrs', true)}
                  {sortHead('congress', 'Congress B/S', true)}
                  {sortHead('short', 'Short %Float', true)}
                  {sortHead('price', 'Price', true)}
                  {sortHead('change', 'Δ%', true)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r, i) => {
                  const isTop = sortedByScoreDesc && i === 0;
                  return (
                  <Fragment key={r.symbol}>
                    <TableRow
                      className={cn('cursor-pointer', isTop && 'bg-emerald-500/5')}
                      onClick={() => toggleDetail(r.symbol)}
                    >
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-semibold flex items-center gap-2">
                          {r.symbol}
                          {isTop && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-400 border-emerald-500/40">
                              TOP
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[160px]">{r.name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={r.score} className="h-2" />
                          <span className="text-xs font-semibold w-7 text-right">{r.score}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <SignalDot score={r.insider.score} max={25} active="bg-sky-500" inactive="bg-sky-500/20" />
                          <SignalDot score={r.institutional.score} max={25} active="bg-violet-500" inactive="bg-violet-500/20" />
                          <SignalDot score={r.congress.score} max={20} active="bg-amber-500" inactive="bg-amber-500/20" />
                          <SignalDot score={r.squeeze.score} max={30} active="bg-rose-500" inactive="bg-rose-500/20" />
                          <Badge variant="outline" className={cn('ml-1 text-[10px] px-1.5 py-0', classColor(r.classification))}>
                            {r.classification}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{r.insider.totalValue > 0 ? fmtMoney(r.insider.totalValue) : '—'}</TableCell>
                      <TableCell className="text-right">{r.institutional.holdings.length || '—'}</TableCell>
                      <TableCell className="text-right">
                        {r.congress.buys || r.congress.sells
                          ? `${r.congress.buys}/${r.congress.sells}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.squeezeLoading
                          ? <span className="text-muted-foreground text-xs">Loading…</span>
                          : fmtPct(r.squeeze.shortPercentOfFloat)}
                      </TableCell>
                      <TableCell className="text-right">{r.price !== null ? `$${r.price.toFixed(2)}` : '—'}</TableCell>
                      <TableCell className={cn('text-right', (r.changePercent ?? 0) > 0 ? 'text-emerald-400' : (r.changePercent ?? 0) < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                        {r.changePercent !== null ? `${r.changePercent > 0 ? '+' : ''}${r.changePercent.toFixed(2)}%` : '—'}
                      </TableCell>
                    </TableRow>
                    {detailSymbol === r.symbol && (
                      <TableRow key={`${r.symbol}-detail`}>
                        <TableCell colSpan={9} className="bg-muted/30">
                          <div className="grid gap-4 md:grid-cols-4 py-2">
                            <div>
                              <p className="text-xs font-semibold mb-1">Insider · {r.insider.score}/25</p>
                              {r.insider.buys.length ? r.insider.buys.slice(0, 5).map((b, idx) => (
                                <p key={idx} className="text-xs text-muted-foreground">
                                  {b.owner} · {b.title} · {fmtMoney(b.value)} {b.date && `· ${b.date}`}
                                </p>
                              )) : <p className="text-xs text-muted-foreground">No qualifying open-market buys (60d, ≥$100K).</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold mb-1">13F holders · {r.institutional.score}/25</p>
                              {r.institutional.holdings.length ? r.institutional.holdings.map((h, idx) => (
                                <p key={idx} className="text-xs text-muted-foreground">
                                  {h.manager} · {fmtMoney(h.value)}
                                </p>
                              )) : <p className="text-xs text-muted-foreground">Not held by the {FAST_MANAGERS.length} scanned managers.</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold mb-1">Congress · {r.congress.score}/20</p>
                              <p className="text-xs text-muted-foreground">
                                {r.congress.buys} buys / {r.congress.sells} sells in 12 months
                                {r.congress.latestDate && ` · latest ${r.congress.latestDate}`}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Disclosures lag ~45 days.</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold mb-1">Squeeze · {r.squeeze.score}/30</p>
                              {r.squeezeLoading ? (
                                <p className="text-xs text-muted-foreground">Fetching short interest…</p>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Short % of float: {fmtPct(r.squeeze.shortPercentOfFloat)}
                                  {r.squeeze.shortRatio !== null && ` · days-to-cover ${r.squeeze.shortRatio.toFixed(1)}`}
                                </p>
                              )}
                              {r.insiderPending && (
                                <p className="text-xs text-amber-400/90 mt-1">Insider scan pending for this symbol — runs with the next “Scan next 100” batch.</p>
                              )}
                              {r.detailError && <p className="text-xs text-amber-400/90 mt-1">{r.detailError}</p>}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </div>
        )}

        {filtered.length > 25 && (
          <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <><ChevronUp className="h-4 w-4 mr-2" /> Collapse</> : <><ChevronDown className="h-4 w-4 mr-2" /> Show all {filtered.length}</>}
          </Button>
        )}

        <ResearchNotes notes={NOTES} />

        <p className="text-xs text-muted-foreground">
          Sources: SEC EDGAR Form 4 & 13F-HR (via /api/edgar), Kadoa congress-trading feed, Yahoo Finance
          short-interest stats. Composite score is a rule-based ranking of public disclosures — not investment advice,
          and not a substitute for your own diligence.
        </p>
      </div>
      <BackToTop />
    </div>
  );
}
