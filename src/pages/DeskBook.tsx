import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import { ResearchNotes, type ResearchNote } from '@/components/ResearchNotes';
import {
  BookOpen, Info, Loader2, Plus, RefreshCw, Trash2, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import * as storage from '@/lib/storage';
import { fetchStockQuote } from '@/lib/stockApi';
import {
  computeBook, removePosition, sortBookRows, upsertPosition, validateLot,
  type BookPosition, type BookSort, type QuoteLike,
} from '@/lib/deskBook';

const BOOK_KEY = 'stockpulse_book_positions';

const SORT_LABEL: Record<BookSort, string> = {
  value: 'Market value',
  symbol: 'Symbol',
  day: 'Day %',
  pnl: 'P&L %',
};

const BOOK_NOTES: ResearchNote[] = [
  { term: 'Bookkeeping, not signals', body: 'This is your private position book — it stores lots and prices them from daily quotes; it computes no buy/sell signals. Entries and exits you act on come from the analysis screens (/tactical, /risk, /flow).' },
  { term: 'Unrealized P&L vs cost', body: 'Market value − cost basis (invested capital). Adding shares to an existing symbol merges the lot and re-averages cost as a weighted average, so P&L stays continuous — realized (closed) trades are not tracked on this screen.' },
  { term: 'Day change', body: 'Derived from each quote’s day % applied to that position’s current value — an estimate that refreshes with the quotes, not a tick-by-tick P&L feed.' },
  { term: 'Weight column', body: 'Position value ÷ total market value. Watch concentration: a single name above roughly a quarter of the book turns the whole book into a single-issuer bet — the /risk screen quantifies this with sector HHI and beta.' },
  { term: 'Unpriced positions', body: 'Symbols whose quote failed show “—” and are excluded from market value, P&L and weights. Refresh (or fix the symbol) before reading totals — otherwise percentages are computed over the priced subset only.' },
];

function fmtMoney(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSigned(v: number): string {
  return `${v > 0 ? '+' : ''}${fmtMoney(v)}`;
}

function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export default function DeskBook() {
  const [positions, setPositions] = useState<BookPosition[]>(
    () => storage.getJson<BookPosition[]>(BOOK_KEY) ?? [],
  );
  const [quotes, setQuotes] = useState<Map<string, QuoteLike>>(new Map());
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<BookSort>('value');
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadQuotes = async (list: BookPosition[]): Promise<void> => {
    if (!list.length) { setQuotes(new Map()); return; }
    setLoading(true);
    const symbols = [...new Set(list.map(p => p.symbol))];
    const next = new Map<string, QuoteLike>();
    for (let i = 0; i < symbols.length; i += 6) {
      const batch = symbols.slice(i, i + 6);
      await Promise.all(batch.map(async sym => {
        try {
          const res = await fetchStockQuote(sym);
          next.set(sym, res.isRealData && res.data
            ? { ok: true, price: res.data.price, changePercent: res.data.changePercent }
            : { ok: false, price: null, changePercent: null });
        } catch {
          next.set(sym, { ok: false, price: null, changePercent: null });
        }
      }));
      setQuotes(new Map(next));
      if (i + batch.length < symbols.length) await new Promise(r => setTimeout(r, 120));
    }
    setLoading(false);
  };

  const loadRef = useRef(loadQuotes);
  loadRef.current = loadQuotes;
  useEffect(() => {
    void loadRef.current(positions);
    // mount-only: later refreshes are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { storage.setJson(BOOK_KEY, positions); }, [positions]);

  const handleAdd = () => {
    const sharesNum = Number(shares);
    const costNum = cost.trim() === '' ? 0 : Number(cost);
    const error = validateLot(symbol, sharesNum, costNum);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const next = upsertPosition(positions, { symbol, shares: sharesNum, costBasis: costNum });
    setPositions(next);
    setSymbol('');
    setShares('');
    setCost('');
    const sym = symbol.trim().toUpperCase();
    toast.success(
      positions.some(p => p.symbol === sym)
        ? `Merged into ${sym} — weighted-average cost updated`
        : `Added ${sym}`,
    );
    void loadQuotes(next);
  };

  const handleRemove = (id: string) => {
    const target = positions.find(p => p.id === id);
    setPositions(removePosition(positions, id));
    if (target) toast.info(`Removed ${target.symbol}`);
  };

  const { rows, totals } = computeBook(positions, quotes);
  const sorted = sortBookRows(rows, sort);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <BookOpen className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Desk · Book</h1>
              <p className="text-xs text-muted-foreground">
                Hand-kept positions, priced live from daily quotes — your book stays on this device
                (synced with your account).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={v => setSort(v as BookSort)}>
              <SelectTrigger className="w-40" aria-label="Sort positions">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABEL) as BookSort[]).map(s => (
                  <SelectItem key={s} value={s}>{SORT_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="gap-2" onClick={() => void loadQuotes(positions)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Market value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmtMoney(totals.marketValue)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {totals.positions} position{totals.positions === 1 ? '' : 's'}
                {totals.unpriced > 0 && ` · ${totals.unpriced} unpriced`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Unrealized P&amp;L</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${totals.unrealizedPnl > 0 ? 'text-success' : totals.unrealizedPnl < 0 ? 'text-destructive' : ''}`}>
                {fmtSigned(totals.unrealizedPnl)}
              </div>
              <p className={`text-xs mt-1 ${totals.unrealizedPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                {fmtPct(totals.unrealizedPnlPct)} vs cost
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Day change</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${totals.dayChangeValue > 0 ? 'text-success' : totals.dayChangeValue < 0 ? 'text-destructive' : ''}`}>
                {fmtSigned(totals.dayChangeValue)}
              </div>
              <p className={`text-xs mt-1 ${totals.dayChangeValue >= 0 ? 'text-success' : 'text-destructive'}`}>
                {fmtPct(totals.dayChangePct)} today
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Cost basis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmtMoney(totals.costValue)}</div>
              <p className="text-xs text-muted-foreground mt-1">invested capital</p>
            </CardContent>
          </Card>
        </div>

        {/* Add position */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add position</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="bk-symbol">Symbol</label>
                <Input
                  id="bk-symbol"
                  value={symbol}
                  onChange={e => { setSymbol(e.target.value.toUpperCase()); setFormError(null); }}
                  placeholder="AAPL"
                  className="w-32 uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="bk-shares">Shares</label>
                <Input
                  id="bk-shares"
                  type="number"
                  min={0}
                  step="any"
                  value={shares}
                  onChange={e => { setShares(e.target.value); setFormError(null); }}
                  placeholder="10"
                  className="w-28"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="bk-cost">Avg cost / share</label>
                <Input
                  id="bk-cost"
                  type="number"
                  min={0}
                  step="any"
                  value={cost}
                  onChange={e => { setCost(e.target.value); setFormError(null); }}
                  placeholder="100.00"
                  className="w-32"
                />
              </div>
              <Button className="gap-2" onClick={handleAdd}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
            <p className="text-xs text-muted-foreground">
              Adding the same symbol again merges lots (shares add, cost averages).
            </p>
          </CardContent>
        </Card>

        {/* Positions */}
        {sorted.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <Wallet className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Your book is empty. Add a position above to start tracking it.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Positions</span>
                <Badge variant="secondary">{sorted.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2 pr-3">Symbol</th>
                    <th className="py-2 pr-3 text-right">Shares</th>
                    <th className="py-2 pr-3 text-right">Avg cost</th>
                    <th className="py-2 pr-3 text-right">Last</th>
                    <th className="py-2 pr-3 text-right">Day</th>
                    <th className="py-2 pr-3 text-right">Value</th>
                    <th className="py-2 pr-3 text-right">P&amp;L</th>
                    <th className="py-2 pr-3 text-right">P&amp;L %</th>
                    <th className="py-2 pr-3 text-right">Weight</th>
                    <th className="py-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{r.symbol}</td>
                      <td className="py-2 pr-3 text-right font-mono">{r.shares.toLocaleString('en-US')}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmtMoney(r.costBasis)}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {r.price !== null ? fmtMoney(r.price) : '—'}
                      </td>
                      <td className={`py-2 pr-3 text-right font-mono ${
                        r.dayChangePct === null ? 'text-muted-foreground'
                          : r.dayChangePct >= 0 ? 'text-success' : 'text-destructive'
                      }`}>
                        {fmtPct(r.dayChangePct)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{fmtMoney(r.marketValue)}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${
                        r.unrealizedPnl > 0 ? 'text-success' : r.unrealizedPnl < 0 ? 'text-destructive' : ''
                      }`}>
                        {fmtSigned(r.unrealizedPnl)}
                      </td>
                      <td className={`py-2 pr-3 text-right font-mono ${
                        r.unrealizedPnlPct > 0 ? 'text-success' : r.unrealizedPnlPct < 0 ? 'text-destructive' : ''
                      }`}>
                        {fmtPct(r.unrealizedPnlPct)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                        {(r.weight * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(r.id)}
                          aria-label={`Remove ${r.symbol} position`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {totals.unpriced > 0 && !loading && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <Info className="h-4 w-4 text-yellow-600" />
            <AlertDescription>
              {totals.unpriced} position{totals.unpriced === 1 ? '' : 's'} could not be priced
              (symbol unsupported or market data unavailable) — excluded from market value.
            </AlertDescription>
          </Alert>
        )}

        <ResearchNotes notes={BOOK_NOTES} />
      </div>
      <BackToTop />
    </div>
  );
}
