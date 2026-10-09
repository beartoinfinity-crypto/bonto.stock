import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import {
  ArrowDown, ArrowUp, Fuel, Loader2, RefreshCw, Search, TrendingDown, TrendingUp,
} from 'lucide-react';
import { fetchStockQuote } from '@/lib/stockApi';
import {
  COMMODITIES, exposureFor, filterCommodities, groupedCommodities, type Commodity,
} from '@/lib/commodities';

interface QuoteState {
  ok: boolean;
  price: number | null;
  changePercent: number | null;
}

type SortMode = 'listed' | 'movers';

const SORT_LABEL: Record<SortMode, string> = {
  listed: 'As listed',
  movers: 'Biggest movers',
};

function fmtPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

function fmtChange(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export default function Commodities() {
  const [quotes, setQuotes] = useState<Map<string, QuoteState>>(new Map());
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('listed');
  const [selected, setSelected] = useState<string>('CL=F');

  const loadQuotes = async (): Promise<void> => {
    setLoading(true);
    setLoaded(0);
    const symbols = COMMODITIES.map(c => c.symbol);
    const next = new Map<string, QuoteState>();
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
      setLoaded(Math.min(i + batch.length, symbols.length));
      if (i + batch.length < symbols.length) {
        await new Promise(r => setTimeout(r, 120));
      }
    }
    setLoading(false);
  };

  const runRef = useRef(loadQuotes);
  runRef.current = loadQuotes;
  useEffect(() => {
    void runRef.current();
    // mount-only refresh is explicit (Refresh button)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = filterCommodities(query);
  const sections = groupedCommodities(filtered).map(section => ({
    ...section,
    items: sort === 'movers'
      ? [...section.items].sort((a, b) =>
          Math.abs(quotes.get(b.symbol)?.changePercent ?? -1) -
          Math.abs(quotes.get(a.symbol)?.changePercent ?? -1))
      : section.items,
  }));

  const selectedCommodity: Commodity | undefined =
    COMMODITIES.find(c => c.symbol === selected);
  const exposure = selectedCommodity ? exposureFor(selectedCommodity.symbol) : null;
  const selectedQuote = quotes.get(selected);
  const failedCount = COMMODITIES.filter(c => !quotes.get(c.symbol)?.ok).length;
  const loadedCount = quotes.size;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Fuel className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Commodities</h1>
              <p className="text-xs text-muted-foreground">
                {COMMODITIES.length} futures contracts in {sections.length || 6} groups —
                click any row for its industry exposure map.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {loading && (
              <div className="hidden sm:flex items-center gap-2 w-40">
                <Progress value={(loadedCount / COMMODITIES.length) * 100} className="h-1.5" />
                <span className="text-xs text-muted-foreground font-mono">{loadedCount}/{COMMODITIES.length}</span>
              </div>
            )}
            <Button size="sm" className="gap-2" onClick={() => void loadQuotes()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Exposure detail */}
        {selectedCommodity && exposure && (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  {selectedCommodity.name}
                  <Badge variant="outline" className="font-mono">{selectedCommodity.symbol}</Badge>
                  <span className="text-xs font-normal text-muted-foreground">{selectedCommodity.unit}</span>
                </span>
                <span className="flex items-center gap-2 text-xs font-normal">
                  {selectedQuote?.ok ? (
                    <>
                      <span className="text-lg font-bold font-mono">
                        {fmtPrice(selectedQuote.price ?? 0)}
                      </span>
                      <span className={selectedQuote.changePercent !== null && selectedQuote.changePercent >= 0
                        ? 'text-success font-mono' : 'text-destructive font-mono'}>
                        {fmtChange(selectedQuote.changePercent)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {loading ? 'Loading quote…' : 'Quote unavailable'}
                    </span>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                If {selectedCommodity.name} rises —
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-success/40 bg-success/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-success mb-2">
                    <ArrowUp className="h-4 w-4" /> Helps
                  </div>
                  <ul className="space-y-1 text-sm">
                    {exposure.helps.map(x => (
                      <li key={x} className="flex items-center gap-2">
                        <TrendingUp className="h-3.5 w-3.5 text-success shrink-0" /> {x}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-2">
                    <ArrowDown className="h-4 w-4" /> Squeezes
                  </div>
                  <ul className="space-y-1 text-sm">
                    {exposure.squeezes.map(x => (
                      <li key={x} className="flex items-center gap-2">
                        <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" /> {x}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter by name or symbol…"
                className="pl-8"
                aria-label="Filter commodities"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Sort</label>
              <Select value={sort} onValueChange={v => setSort(v as SortMode)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="listed">{SORT_LABEL.listed}</SelectItem>
                  <SelectItem value="movers">{SORT_LABEL.movers}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!loading && failedCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {failedCount} quote{failedCount === 1 ? '' : 's'} unavailable (market closed or symbol unsupported)
              </span>
            )}
          </CardContent>
        </Card>

        {/* Groups */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {sections.map(section => (
            <Card key={section.group}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{section.group}</span>
                  <Badge variant="secondary">{section.items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1.5 pr-3">Symbol</th>
                      <th className="py-1.5 pr-3">Name</th>
                      <th className="py-1.5 pr-3 text-right">Price</th>
                      <th className="py-1.5 text-right">Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map(c => {
                      const q = quotes.get(c.symbol);
                      const active = c.symbol === selected;
                      return (
                        <tr
                          key={c.symbol}
                          onClick={() => setSelected(c.symbol)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c.symbol); } }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Show exposure for ${c.name}`}
                          className={`border-t border-border cursor-pointer ${active ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                        >
                          <td className="py-1.5 pr-3 font-mono text-xs">{c.symbol}</td>
                          <td className="py-1.5 pr-3">{c.name}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">
                            {q?.ok && q.price !== null ? fmtPrice(q.price) : '—'}
                          </td>
                          <td className={`py-1.5 text-right font-mono ${
                            q?.ok && q.changePercent !== null
                              ? (q.changePercent >= 0 ? 'text-success' : 'text-destructive')
                              : 'text-muted-foreground'
                          }`}>
                            {q?.ok ? fmtChange(q.changePercent) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {section.items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-xs text-muted-foreground text-center">
                          No matches
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>

        {sections.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">
            Nothing matches “{query}”.
          </p>
        )}
      </div>
      <BackToTop />
    </div>
  );
}
