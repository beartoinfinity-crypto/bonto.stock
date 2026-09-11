import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Header } from '@/components/Header';
import { useTradeLedger } from '@/hooks/useTradeLedger';
import {
  PERSONAS, STARTING_CASH, accountEquity, positionValue, personaPnl, dailyPnlSeries,
  PersonaId, Trade, Position, LedgerHistoryEntry,
} from '@/lib/tradeSimulator';
import { fetchStockQuote } from '@/lib/stockApi';
import {
  DEFAULT_VIEW_FILTERS,
  ViewFilters,
  distinctDates,
  filterDecisions,
  filterTrades,
  flatDecisions,
  sortDecisions,
  sortTrades,
} from '@/lib/ledgerView';
import {
  RotateCcw, RefreshCw, TrendingUp, TrendingDown, Minus, Users, History, Briefcase, ListChecks, CloudDownload, LineChart, Radio,
} from 'lucide-react';
import { toast } from 'sonner';

const LEADER_ICON = { value: '🦁', wealth: '💎', inverted: '🪞', contrarian: '🐻', momentum: '⚡', tactical: '🎯', agent: '🤖' };

function nl(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(v: number): string {
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function actionColor(a: string): string {
  return a === 'BUY' ? 'text-emerald-500' : a === 'SELL' ? 'text-red-500' : 'text-muted-foreground';
}

interface ViewFilterOption { value: string; label: string }

const DECISION_ACTIONS: ViewFilterOption[] = [
  { value: 'all', label: 'All actions' },
  { value: 'BUY', label: 'BUY' },
  { value: 'SELL', label: 'SELL' },
  { value: 'HOLD', label: 'HOLD' },
];

const TRADE_ACTIONS: ViewFilterOption[] = [
  { value: 'all', label: 'All actions' },
  { value: 'BUY', label: 'BUY' },
  { value: 'SELL', label: 'SELL' },
];

const DECISION_SORTS: ViewFilterOption[] = [
  { value: 'date-desc', label: 'Newest day' },
  { value: 'date-asc', label: 'Oldest day' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'strength', label: 'Strength' },
  { value: 'action', label: 'Action' },
];

const TRADE_SORTS: ViewFilterOption[] = [
  { value: 'date-desc', label: 'Newest day' },
  { value: 'date-asc', label: 'Oldest day' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'value', label: 'Notional' },
  { value: 'pnl', label: 'Realized P/L' },
];

const PERSON_OPTIONS: ViewFilterOption[] = [
  { value: 'all', label: 'All persons' },
  ...PERSONAS.map(p => ({ value: p.id, label: p.name })),
];

function FilterBar({ f, onChange, actions, sorts, dates, searchPlaceholder }: {
  f: ViewFilters;
  onChange: (patch: Partial<ViewFilters>) => void;
  actions: ViewFilterOption[];
  sorts: ViewFilterOption[];
  dates: string[];
  searchPlaceholder: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={f.persona} onValueChange={v => onChange({ persona: v as ViewFilters['persona'] })}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PERSON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={f.action} onValueChange={v => onChange({ action: v as ViewFilters['action'] })}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {actions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={f.date} onValueChange={v => onChange({ date: v })}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All dates</SelectItem>
          {dates.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={f.sort} onValueChange={v => onChange({ sort: v })}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {sorts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input
        className="w-28"
        value={f.symbol}
        onChange={e => onChange({ symbol: e.target.value })}
        placeholder="Symbol"
      />
      <Input
        className="w-56"
        value={f.search}
        onChange={e => onChange({ search: e.target.value })}
        placeholder={searchPlaceholder}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ persona: 'all', action: 'all', date: 'all', symbol: '', search: '' })}
      >
        Clear
      </Button>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold ${className ?? ''}`}>{value}</span>
    </span>
  );
}

function Pager({ page, total, pageSize, onPage }: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
      <span>Showing {from}–{to} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button>
        <span>Page {page}/{pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export default function TradeLedger() {
  const { ledger, syncFromCloud, rerunOnServer, running } = useTradeLedger();
  const [active, setActive] = useState<PersonaId>('value');

  // Live re-marking: fetch fresh quotes for every open-position symbol so the
  // leaderboard/positions show current prices, not the last simulated day's
  // snapshot. Falls back to the snapshot when live fetch fails (offline/asleep).
  const openSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const acct of Object.values(ledger?.accounts ?? {})) {
      for (const pos of acct.positions) s.add(pos.symbol.toUpperCase());
    }
    return [...s];
  }, [ledger]);

  const [livePrices, setLivePrices] = useState<Record<string, number> | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const liveFetchedRef = useRef<string>('');

  useEffect(() => {
    const key = openSymbols.join(',');
    if (!key || liveFetchedRef.current === key) return;
    liveFetchedRef.current = key;
    let cancelled = false;
    setLiveLoading(true);
    (async () => {
      const out: Record<string, number> = {};
      await Promise.all(openSymbols.map(async sym => {
        try {
          const q = await fetchStockQuote(sym);
          if (q?.data?.price && q.data.price > 0) out[sym] = q.data.price;
        } catch { /* keep snapshot */ }
      }));
      if (!cancelled && Object.keys(out).length) setLivePrices(prev => ({ ...(prev ?? {}), ...out }));
    })().finally(() => { if (!cancelled) setLiveLoading(false); });
    return () => { cancelled = true; };
  }, [openSymbols]);

  /** Mark price: live when available, else the snapshot price, else cost. */
  const markPrice = (snapshotPrices: Record<string, number>, symbol: string, avgCost: number): number =>
    livePrices?.[symbol.toUpperCase()] ?? snapshotPrices[symbol.toUpperCase()] ?? avgCost;

  const handleRerun = async () => {
    const r = await rerunOnServer();
    if (r.ok) toast.success(`Session ${r.date} re-simulated on the server`);
    else toast.error(`Re-run failed — ${r.error ?? 'server unreachable'}`);
  };

  const handleSyncFromCloud = async () => {
    const ok = await syncFromCloud();
    toast[ok ? 'success' : 'error'](
      ok ? 'Ledger synced from Supabase' : 'Cloud sync failed — no Supabase copy reachable (server may be waking; try again shortly)'
    );
  };

  const prices = ledger?.prices ?? {};
  // Live/snapshot blend: live quotes win for held symbols; the snapshot fills the rest.
  const markPrices = useMemo(() => {
    if (!livePrices) return prices;
    return { ...prices, ...livePrices };
  }, [prices, livePrices]);
  const isLive = livePrices != null && openSymbols.some(s => livePrices[s] != null);

  const leaderboard = PERSONAS.map(p => {
    const acct = ledger?.accounts[p.id];
    const cash = acct?.cash ?? 0;
    const marketValue = acct ? positionValue(acct, markPrices) : 0;
    const equity = acct ? accountEquity(acct, markPrices) : STARTING_CASH;
    const pnl = acct ? personaPnl(acct, markPrices) : 0;
    return { ...p, cash, marketValue, equity, pnl, positions: acct?.positions.length ?? 0 };
  }).sort((a, b) => b.pnl - a.pnl);

  const maxPnl = Math.max(...leaderboard.map(l => l.pnl), 1);

  const rawTrades: Trade[] = ledger?.trades ?? [];
  const allTrades: Trade[] = [...rawTrades].reverse();
  const activeAcct = ledger?.accounts[active];

  // Accumulated view data + filter/sort state.
  const decisionRows = flatDecisions(ledger?.decisions ?? []);
  const decisionDates = distinctDates(decisionRows);
  const tradeDates = distinctDates(rawTrades);

  const [decFilters, setDecFilters] = useState<ViewFilters>({ ...DEFAULT_VIEW_FILTERS });
  const [txFilters, setTxFilters] = useState<ViewFilters>({ ...DEFAULT_VIEW_FILTERS });
  const [decPage, setDecPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const PAGE_SIZE = 100;

  const patchDec = (patch: Partial<ViewFilters>) => { setDecFilters(prev => ({ ...prev, ...patch })); setDecPage(1); };
  const patchTx = (patch: Partial<ViewFilters>) => { setTxFilters(prev => ({ ...prev, ...patch })); setTxPage(1); };

  const filteredDecisions = sortDecisions(filterDecisions(decisionRows, decFilters), decFilters.sort);
  const filteredTrades = sortTrades(filterTrades(rawTrades, txFilters), txFilters.sort);

  const pageDecisions = filteredDecisions.slice((decPage - 1) * PAGE_SIZE, decPage * PAGE_SIZE);
  const pageTrades = filteredTrades.slice((txPage - 1) * PAGE_SIZE, txPage * PAGE_SIZE);

  const decBuys = filteredDecisions.filter(d => d.action === 'BUY').length;
  const decSells = filteredDecisions.filter(d => d.action === 'SELL').length;
  const decHolds = filteredDecisions.filter(d => d.action === 'HOLD').length;

  const txBuys = filteredTrades.filter(t => t.action === 'BUY');
  const txSells = filteredTrades.filter(t => t.action === 'SELL');
  const buyNotional = txBuys.reduce((s, t) => s + t.value, 0);
  const sellNotional = txSells.reduce((s, t) => s + t.value, 0);
  const realizedPnl = filteredTrades.reduce((s, t) => s + t.realizedPnl, 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Simulated Traders</h1>
            <p className="text-muted-foreground text-sm">
              {PERSONAS.length} personas trade the shared S&amp;P 500 / NASDAQ-100 universe daily; every transaction is recorded.
              <span> Daily simulation runs on a schedule — configure it in Settings.</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRerun} disabled={running}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {running ? 'Re-running…' : 'Re-run session'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleSyncFromCloud} disabled={running}>
              {running
                ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                : <CloudDownload className="h-4 w-4 mr-2" />}
              {running ? 'Syncing…' : 'Sync from Supabase'}
            </Button>
          </div>
        </div>

        {/* Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Leaderboard
              {liveLoading ? (
                <Badge variant="outline" className="text-muted-foreground"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />marking live…</Badge>
              ) : isLive ? (
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/40"><Radio className="h-3 w-3 mr-1" />live</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Mark-to-market equity vs ${STARTING_CASH.toLocaleString()} starting cash{isLive ? ' — re-marked at current live prices' : ' — as of the last simulated day'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {leaderboard.map((l, i) => (
              <button key={l.id} onClick={() => setActive(l.id)} className="block w-full text-left">
                <div className={`rounded-lg border p-3 transition-colors ${active === l.id ? 'border-primary bg-accent/40' : 'border-border hover:bg-accent/20'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{LEADER_ICON[l.id]}</span>
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <span>{i + 1}. {l.name}</span>
                          <Badge variant="outline" className="text-muted-foreground">{l.engine}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{l.description}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{nl(l.equity)}</div>
                      <div className={`font-mono text-xs ${l.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {l.pnl >= 0 ? '+' : ''}{nl(l.pnl)} ({pct(l.pnl / STARTING_CASH * 100)})
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Cash {nl(l.cash)}</span>
                    <span className="text-border">·</span>
                    <span>Positions {nl(l.marketValue)}</span>
                    <span className="text-border hidden sm:inline">·</span>
                    <span className="hidden sm:inline">{l.positions} open</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden ml-2">
                      <div
                        className={`h-full rounded-full ${l.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.max(2, (Math.abs(l.pnl) / maxPnl) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Performance history — one equity snapshot per simulated day */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><LineChart className="h-4 w-4" /> Performance History</CardTitle>
            <CardDescription>
              Daily mark-to-market equity per persona, recorded once on each simulated day ({(ledger?.history ?? []).length} day(s) tracked). Daily P/L = day-over-day equity change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(ledger?.history ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No days recorded yet — history accrues from each simulated day.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {PERSONAS.map(p => (
                      <TableHead key={p.id} className="text-right">{LEADER_ICON[p.id]} {p.name}{p.id === active ? ' ●' : ''}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(ledger?.history ?? [])].reverse().map((h: LedgerHistoryEntry) => (
                    <TableRow key={h.date} className={h.date === ledger?.lastRunDate ? 'bg-accent/30' : undefined}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{h.date}</TableCell>
                      {PERSONAS.map(p => {
                        const eq = h.equity[p.id];
                        const pnl = eq != null ? eq - STARTING_CASH : null;
                        return (
                          <TableCell key={p.id} className={`text-right font-mono text-xs ${pnl == null ? 'text-muted-foreground' : pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {eq != null ? `${nl(eq)} (${pct(pnl! / STARTING_CASH * 100)})` : '—'}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Tabs value={active} onValueChange={v => setActive(v as PersonaId)} className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            {PERSONAS.map(p => (
              <TabsTrigger key={p.id} value={p.id}>{LEADER_ICON[p.id]} {p.name}</TabsTrigger>
            ))}
          </TabsList>

          {PERSONAS.map(p => (
            <TabsContent key={p.id} value={p.id}>
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Positions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2"><Briefcase className="h-4 w-4" /> Positions — {p.name}</CardTitle>
                    <CardDescription>{p.engine} strategy</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {p.id === active && activeAcct && activeAcct.positions.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No open positions yet.</p>
                    ) : null}
                    {p.id === active && activeAcct && activeAcct.positions.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Avg Cost</TableHead>
                            <TableHead className="text-right">Market</TableHead>
                            <TableHead className="text-right">Stop</TableHead>
                            <TableHead className="text-right">Target</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeAcct.positions.map((pos: Position, idx) => {
                            const mkt = markPrice(prices, pos.symbol, pos.avgCost);
                            const pl = (mkt - pos.avgCost) * pos.qty;
                            const live = livePrices?.[pos.symbol.toUpperCase()];
                            return (
                              <TableRow key={idx}>
                                <TableCell className="font-mono font-medium">{pos.symbol}</TableCell>
                                <TableCell className="text-right font-mono">{pos.qty}</TableCell>
                                <TableCell className="text-right font-mono">{nl(pos.avgCost)}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {nl(mkt)}{live != null ? <span className="ml-1 text-[10px] text-emerald-500">live</span> : null}
                                </TableCell>
                                <TableCell className="text-right font-mono">{pos.stop ? nl(pos.stop) : '—'}</TableCell>
                                <TableCell className={`text-right font-mono ${pl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{nl(pl)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    ) : null}
                  </CardContent>
                </Card>

                {/* Trades for this person */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Trades — {p.name}</CardTitle>
                    {p.id === active ? (
                      <CardDescription>
                        {(() => {
                          const series = dailyPnlSeries(ledger?.history ?? [], p.id, ledger?.initialCash ?? STARTING_CASH);
                          const total = series.reduce((s, d) => s + d.pnl, 0);
                          const best = series.reduce((b, d) => (d.pnl > b.pnl ? d : b), { date: '—', pnl: 0 });
                          const worst = series.reduce((w, d) => (d.pnl < w.pnl ? d : w), { date: '—', pnl: 0 });
                          return (
                            <span>
                              Daily P/L {total >= 0 ? '+' : ''}{nl(total)} across {series.length} day(s)
                              {series.length > 0 && (
                                <> · best <span className="text-emerald-500">{nl(best.pnl)} ({best.date})</span>
                                  · worst <span className="text-red-500">{nl(worst.pnl)} ({worst.date})</span></>
                              )}
                            </span>
                          );
                        })()}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    {p.id === active && allTrades.filter(t => t.personaId === active).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No trades recorded yet.</p>
                    ) : null}
                    {p.id === active ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">P/L</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allTrades.filter(t => t.personaId === active).slice(0, 30).map(t => (
                            <TableRow key={t.id}>
                              <TableCell className="font-mono text-xs">{t.date}</TableCell>
                              <TableCell className="font-mono">{t.symbol}</TableCell>
                              <TableCell className={actionColor(t.action)}>{t.action}</TableCell>
                              <TableCell className="text-right font-mono">{t.qty}</TableCell>
                              <TableCell className="text-right font-mono">{nl(t.price)}</TableCell>
                              <TableCell className={`text-right font-mono ${t.realizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {t.action === 'SELL' ? nl(t.realizedPnl) : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Decisions — accumulated daily signal log, filterable */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" /> Decisions</CardTitle>
            <CardDescription>
              {decisionRows.length.toLocaleString()} signals logged across {decisionDates.length} day(s) and {PERSONAS.length} personas, all within the S&amp;P 500 / NASDAQ-100 universe — every symbol each day, including HOLDs. Filter by person, action, symbol, date or reason to verify any day.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FilterBar
              f={decFilters}
              onChange={patchDec}
              actions={DECISION_ACTIONS}
              sorts={DECISION_SORTS}
              dates={decisionDates}
              searchPlaceholder="Reason contains…"
            />
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <Stat label="Rows" value={filteredDecisions.length.toLocaleString()} />
              <Stat label="BUY" value={String(decBuys)} className="text-emerald-500" />
              <Stat label="SELL" value={String(decSells)} className="text-red-500" />
              <Stat label="HOLD" value={String(decHolds)} className="text-muted-foreground" />
            </div>
            {filteredDecisions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No decisions match the filters — clear filters or wait for the next scheduled run.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Buy</TableHead>
                      <TableHead className="text-right">Sell</TableHead>
                      <TableHead className="text-right">Strength</TableHead>
                      <TableHead className="text-right">Stop</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageDecisions.map((d, idx) => (
                      <TableRow key={`${d.date}_${d.personaId}_${d.symbol}_${idx}`}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{d.date}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{PERSONAS.find(x => x.id === d.personaId)?.name ?? d.personaId}</TableCell>
                        <TableCell className="font-mono">{d.symbol}</TableCell>
                        <TableCell className={actionColor(d.action)}>{d.action}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.price ? nl(d.price) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.buyCount ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.sellCount ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.strength ? d.strength.toFixed(0) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.stopLoss ? nl(d.stopLoss) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.takeProfit ? nl(d.takeProfit) : '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager page={decPage} total={filteredDecisions.length} pageSize={PAGE_SIZE} onPage={setDecPage} />
              </>
            )}
          </CardContent>
        </Card>

        {/* All transactions — merged, accumulated, filterable */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> All Transactions</CardTitle>
            <CardDescription>
              {rawTrades.length.toLocaleString()} fills across {PERSONAS.length} personas accumulating over time. Filter by person, side, symbol or date to audit trading activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FilterBar
              f={txFilters}
              onChange={patchTx}
              actions={TRADE_ACTIONS}
              sorts={TRADE_SORTS}
              dates={tradeDates}
              searchPlaceholder="Note contains…"
            />
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <Stat label="Fills" value={filteredTrades.length.toLocaleString()} />
              <Stat label="Buys" value={String(txBuys.length)} className="text-emerald-500" />
              <Stat label="Sells" value={String(txSells.length)} className="text-red-500" />
              <Stat label="Buy notional" value={nl(buyNotional)} />
              <Stat label="Sell notional" value={nl(sellNotional)} />
              <Stat label="Realized P/L" value={nl(realizedPnl)} className={realizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500'} />
            </div>
            {filteredTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No trades match the filters — clear filters or wait for the next scheduled run.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Realized P/L</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageTrades.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{t.date}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{PERSONAS.find(x => x.id === t.personaId)?.name ?? t.personaId}</TableCell>
                        <TableCell className="font-mono">{t.symbol}</TableCell>
                        <TableCell className={actionColor(t.action)}>{t.action}</TableCell>
                        <TableCell className="text-right font-mono">{t.qty}</TableCell>
                        <TableCell className="text-right font-mono">{nl(t.price)}</TableCell>
                        <TableCell className="text-right font-mono">{nl(t.value)}</TableCell>
                        <TableCell className={`text-right font-mono ${t.realizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {t.action === 'SELL' ? nl(t.realizedPnl) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager page={txPage} total={filteredTrades.length} pageSize={PAGE_SIZE} onPage={setTxPage} />
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
