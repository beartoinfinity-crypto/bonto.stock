import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Radar, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import * as storage from '@/lib/storage';
import {
  UNIVERSE,
  SECTORS,
  CAP_TIERS,
  FAST_MANAGERS,
  runSmartMoneyScan,
  type SmartMoneyRow,
  type ScanProgress,
} from '@/lib/smartMoney';

const SCAN_CACHE_KEY = 'stockpulse_sm_scan';
const INSIDER_CACHE_KEY = 'stockpulse_sm_insider';
const SCAN_TTL_MS = 24 * 60 * 60 * 1000;
const INSIDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

const dot = (score: number, max: number, active: string, inactive: string) =>
  cn('inline-block h-2 w-2 rounded-full', score > 0 ? active : inactive, score === max && 'ring-2 ring-offset-1 ring-offset-background');

const NOTES: ResearchNote[] = [
  { term: 'A four-signal composite (0–100)', body: 'Score = insider 25 + institutional 25 + congress 20 + squeeze 30. Squeeze carries the most weight because crowded shorts plus momentum is the most explosive setup; congress the least because disclosures arrive with a ~45-day lag. Every input is computed live from public filings and quotes — no AI, no paid data.' },
  { term: 'Insider buying (0–25)', body: 'SEC Form 4 open-market purchases (transaction code “P”) of at least $100K in the last 60 days. A single qualifying buy scores 15; a cluster of 3+ distinct insiders totalling $500K+ scores 25. The scan reads each company’s 20 most recent Form 4s in the window — grant/sell filings crowd the list, so an older qualifying buy can be missed. Mega caps rarely score here: their insiders receive equity awards rather than buy in the open market.' },
  { term: 'Institutional ownership (0–25)', body: `Latest 13F-HR holdings of ${FAST_MANAGERS.length} famous managers whose filings are small enough to parse in a browser (Berkshire, Bridgewater, Baupost, Pershing Square, Scion, Soros, Tiger Global, Greenlight, Lone Pine, Coatue). 1 manager = 15, 2 = 20, 3+ = 25. 13F carries CUSIPs, not tickers — matches are made on normalized issuer names, so some positions go unmatched. The mega index funds (Vanguard, BlackRock, State Street) are deliberately excluded: they hold everything and signal nothing. See /funds for full manager browsing.` },
  { term: 'Congress trades (0–20)', body: 'STOCK Act disclosures from the Kadoa congress-trading feed for the past 12 months. Any disclosed purchase scores 20; sells-only scores 8 (a sell is often portfolio pruning, not a short thesis). Remember the ~45-day disclosure lag: you are reading last month’s action, never a real-time signal.' },
  { term: 'Squeeze pressure (0–30)', body: 'Short interest as a percent of float from Yahoo: ≥5% = 10 pts, ≥10% = 20, ≥20% = 30. Days-to-cover (short ratio) is shown in the detail row as context — high short interest plus low days-to-cover is the classic squeeze fuel. A missing reading (Yahoo throttling, thin coverage) scores 0, not a penalty.' },
  { term: 'Reading the table', body: 'Default sort is score descending. The four dots per row light up when that signal scored (blue insider, violet institutional, amber congress, rose squeeze). Classification: Strong ≥60, Watch ≥40, Light >0. Click any row to expand the full breakdown. First run takes ~2 minutes (paced SEC fetches); results and the insider scan are cached so re-runs are fast.' },
];

interface CachedScan { at: number; rows: SmartMoneyRow[] }
interface CachedInsider { at: number; buys: SmartMoneyRow['insider']['buys'] }

function loadScan(): SmartMoneyRow[] | null {
  try {
    const raw = storage.getItem(SCAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedScan;
    if (!parsed?.rows?.length || Date.now() - parsed.at > SCAN_TTL_MS) return null;
    return parsed.rows;
  } catch { return null; }
}

function saveScan(rows: SmartMoneyRow[]): void {
  try { storage.setItem(SCAN_CACHE_KEY, JSON.stringify({ at: Date.now(), rows })); } catch { /* ignore */ }
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

type SortKey = 'score_desc' | 'change_desc' | 'mktcap_desc' | 'short_desc';

export default function SmartMoneyScreener() {
  const [rows, setRows] = useState<SmartMoneyRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('All sectors');
  const [capTier, setCapTier] = useState('All caps');
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<SortKey>('score_desc');
  const [expanded, setExpanded] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);

  useEffect(() => {
    const cached = loadScan();
    if (cached) setRows(cached);
  }, []);

  const runScan = useCallback(async () => {
    setRunning(true);
    setError(null);
    setProgress({ stage: 'insider', done: 0, total: UNIVERSE.length, label: 'SEC Form 4 insider scan' });
    toast.message('Running Smart Money Screener', {
      description: 'First run pulls ~2 minutes of SEC Form 4 filings — later runs use the 1-hour EDGAR cache.',
    });
    try {
      const result = await runSmartMoneyScan({
        insiderCache: loadInsiderCache(),
        onInsiderCached: saveInsiderBuy,
        onProgress: setProgress,
      });
      setRows(result);
      saveScan(result);
      const strong = result.filter(r => r.classification === 'Strong').length;
      toast.success('Screen complete', { description: `${result.length} stocks scanned · ${strong} Strong (60+).` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setError(msg);
      toast.error('Screen failed', { description: msg });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const out = rows.filter(r =>
      r.score >= minScore
      && (sector === 'All sectors' || r.sector === sector)
      && (capTier === 'All caps' || r.capTier === capTier)
      && (!q || r.symbol.includes(q) || r.name.toUpperCase().includes(q)),
    );
    const cmp: Record<SortKey, (a: SmartMoneyRow, b: SmartMoneyRow) => number> = {
      score_desc: (a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol),
      change_desc: (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
      mktcap_desc: (a, b) => (b.marketCap ?? -Infinity) - (a.marketCap ?? -Infinity),
      short_desc: (a, b) => (b.squeeze.shortPercentOfFloat ?? -Infinity) - (a.squeeze.shortPercentOfFloat ?? -Infinity),
    };
    return out.sort(cmp[sort]);
  }, [rows, search, sector, capTier, minScore, sort]);

  const visible = expanded ? filtered : filtered.slice(0, 25);
  const strong = rows.filter(r => r.classification === 'Strong').length;
  const watch = rows.filter(r => r.classification === 'Watch').length;
  const top = rows.length ? [...rows].sort((a, b) => b.score - a.score)[0] : null;
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

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
                  ? `${UNIVERSE.length}-stock universe · live insider · 13F · congress · short-interest signals`
                  : 'Click “Run screen” to pull live SEC, congress and short-interest data'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={runScan} disabled={running}>
            <RefreshCw className={cn('h-4 w-4 mr-2', running && 'animate-spin')} />
            {running ? 'Screening…' : rows.length ? 'Re-run screen' : 'Run screen'}
          </Button>
        </div>

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
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Top score</p>
              <p className="text-lg font-semibold">{top ? `${top.symbol} · ${top.score}` : '—'}</p>
            </div>
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
                {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
            <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score_desc">Signal score ↓</SelectItem>
                <SelectItem value="change_desc">Top gainers</SelectItem>
                <SelectItem value="mktcap_desc">Largest cap</SelectItem>
                <SelectItem value="short_desc">Most shorted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {rows.length === 0 && !running ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              No results yet. Run the screen to pull live SEC Form 4 filings, 13F holdings, congress disclosures and
              short interest for the {UNIVERSE.length}-stock universe.
            </p>
            <Button onClick={runScan} disabled={running}>
              <RefreshCw className={cn('h-4 w-4 mr-2', running && 'animate-spin')} /> Run screen
            </Button>
          </div>
        ) : rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="w-40">Score</TableHead>
                  <TableHead className="text-right">Insider $</TableHead>
                  <TableHead className="text-right">13F mgrs</TableHead>
                  <TableHead className="text-right">Congress B/S</TableHead>
                  <TableHead className="text-right">Short %Float</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Δ%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r, i) => (
                  <>
                    <TableRow
                      key={r.symbol}
                      className="cursor-pointer"
                      onClick={() => setDetailSymbol(detailSymbol === r.symbol ? null : r.symbol)}
                    >
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-semibold">{r.symbol}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[160px]">{r.name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={r.score} className="h-2" />
                          <span className="text-xs font-semibold w-7 text-right">{r.score}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {dot(r.insider.score, 25, 'bg-sky-500', 'bg-sky-500/20')}
                          {dot(r.institutional.score, 25, 'bg-violet-500', 'bg-violet-500/20')}
                          {dot(r.congress.score, 20, 'bg-amber-500', 'bg-amber-500/20')}
                          {dot(r.squeeze.score, 30, 'bg-rose-500', 'bg-rose-500/20')}
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
                        {fmtPct(r.squeeze.shortPercentOfFloat)}
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
                              <p className="text-xs text-muted-foreground">
                                Short % of float: {fmtPct(r.squeeze.shortPercentOfFloat)}
                                {r.squeeze.shortRatio !== null && ` · days-to-cover ${r.squeeze.shortRatio.toFixed(1)}`}
                              </p>
                              {r.detailError && <p className="text-xs text-amber-400/90 mt-1">{r.detailError}</p>}
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
