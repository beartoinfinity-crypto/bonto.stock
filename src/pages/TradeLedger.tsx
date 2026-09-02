import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Header } from '@/components/Header';
import { useTradeLedger } from '@/hooks/useTradeLedger';
import {
  PERSONAS, STARTING_CASH, accountEquity, positionValue, personaPnl, PersonaId, Trade, Position, DailyDecisionLog,
} from '@/lib/tradeSimulator';
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

function personDecisions(logs: DailyDecisionLog[], personaId: PersonaId) {
  return logs
    .filter(l => l.personaId === personaId)
    .flatMap(l => l.decisions.map(d => ({ ...d, date: l.date })))
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : b.strength - a.strength));
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

  const allTrades: Trade[] = ledger?.trades?.length ? [...ledger.trades].reverse() : [];
  const activeAcct = ledger?.accounts[active];

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

              {/* Decisions for this person (accumulated daily log incl. HOLDs) */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" /> Decisions — {p.name}</CardTitle>
                  <CardDescription>Every symbol evaluated each day, with action, price and reason. Accumulates across days.</CardDescription>
                </CardHeader>
                <CardContent>
                  {p.id === active && personDecisions(ledger?.decisions ?? [], active).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No decisions recorded yet — hit "Run today".</p>
                  ) : null}
                  {p.id === active ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Buy</TableHead>
                          <TableHead>Sell</TableHead>
                          <TableHead className="text-right">Strength</TableHead>
                          <TableHead className="text-right">Stop</TableHead>
                          <TableHead className="text-right">Target</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {personDecisions(ledger?.decisions ?? [], active).slice(0, 200).map((d, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs">{d.date}</TableCell>
                            <TableCell className="font-mono">{d.symbol}</TableCell>
                            <TableCell className={actionColor(d.action)}>{d.action}</TableCell>
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
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {/* All transactions merged */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> All Transactions</CardTitle>
            <CardDescription>{allTrades.length} fills across {PERSONAS.length} personas.</CardDescription>
          </CardHeader>
          <CardContent>
            {allTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nothing yet — hit "Run today" to generate trades.</p>
            ) : (
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
                  {allTrades.slice(0, 100).map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.date}</TableCell>
                      <TableCell className="text-sm">{PERSONAS.find(x => x.id === t.personaId)?.name ?? t.personaId}</TableCell>
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
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
