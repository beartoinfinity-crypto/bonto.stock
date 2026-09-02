import { useEffect, useState } from 'react';
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
  PERSONAS, STARTING_CASH, accountEquity, positionValue, personaPnl, PersonaId, Trade, Position,
} from '@/lib/tradeSimulator';
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
  Wallet, RefreshCw, RotateCcw, TrendingUp, TrendingDown, Minus, Users, History, Briefcase, ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';

const LEADER_ICON = { value: '🦁', wealth: '💎', contrarian: '🐻', momentum: '⚡', tactical: '🎯', agent: '🤖' };

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
  const { ledger, running, ranToday, lastRunDate, run, reset, load } = useTradeLedger();
  const [active, setActive] = useState<PersonaId>('value');
  const [autoRunDone, setAutoRunDone] = useState(false);

  // Auto-run once per page visit if the ledger hasn't run today yet.
  useEffect(() => {
    if (autoRunDone) return;
    if (ranToday) { setAutoRunDone(true); return; }
    setAutoRunDone(true);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRun = async () => {
    try {
      await run();
      toast.success(`Simulation updated for ${lastRunDate ?? 'today'}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Simulation failed');
    }
  };

  const handleReset = async () => {
    reset();
    toast.success('Ledger reset');
  };

  const prices = ledger?.prices ?? {};
  const leaderboard = PERSONAS.map(p => {
    const acct = ledger?.accounts[p.id];
    const cash = acct?.cash ?? 0;
    const marketValue = acct ? positionValue(acct, prices) : 0;
    const equity = acct ? accountEquity(acct, prices) : STARTING_CASH;
    const pnl = acct ? personaPnl(acct, prices) : 0;
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
              {PERSONAS.length} personas trade the shared universe daily; every transaction is recorded.
              {ranToday && lastRunDate && <span> Last run: {lastRunDate}.</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={running}>
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
            <Button size="sm" onClick={handleRun} disabled={running}>
              {running ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Wallet className="h-4 w-4 mr-2" />}
              {running ? 'Simulating…' : ranToday ? 'Run today (re-run)' : 'Run today'}
            </Button>
          </div>
        </div>

        {/* Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leaderboard</CardTitle>
            <CardDescription>Mark-to-market equity vs ${STARTING_CASH.toLocaleString()} starting cash.</CardDescription>
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
                            const mkt = prices[pos.symbol.toUpperCase()] ?? pos.avgCost;
                            const pl = (mkt - pos.avgCost) * pos.qty;
                            return (
                              <TableRow key={idx}>
                                <TableCell className="font-mono font-medium">{pos.symbol}</TableCell>
                                <TableCell className="text-right font-mono">{pos.qty}</TableCell>
                                <TableCell className="text-right font-mono">{nl(pos.avgCost)}</TableCell>
                                <TableCell className="text-right font-mono">{nl(mkt)}</TableCell>
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
              {decisionRows.length.toLocaleString()} signals logged across {decisionDates.length} day(s) and {PERSONAS.length} personas — every symbol each day, including HOLDs. Filter by person, action, symbol, date or reason to verify any day.
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
              <p className="text-sm text-muted-foreground py-4">No decisions match the filters — hit "Run today" or clear filters.</p>
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
              <p className="text-sm text-muted-foreground py-4">No trades match the filters — hit "Run today" or clear filters.</p>
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
