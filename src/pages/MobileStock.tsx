/**
 * MobileStock — mobile-first stock detail view (touch-optimized).
 *
 * Routes:  /m          → hub (search + popular list)
 *          /m/:symbol  → detail (sticky header, price, touch chart,
 *                        key stats, news, fixed action bar)
 *
 * Daily close-only bars — the feed has no intraday data, so timeframes are
 * 1M…5Y/All rather than the 1D/5D intraday ranges of a Level-2 product.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import {
  ArrowLeft, Star, TrendingUp, TrendingDown, Info, Newspaper,
  Wifi, WifiOff, AlertCircle, Smartphone, Search, Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { StockSearch } from '@/components/StockSearch';
import { StockNews } from '@/components/StockNews';
import { useStockData } from '@/hooks/useStockData';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { allowFullSite } from '@/lib/siteMode';
import { Stock, popularStocks } from '@/lib/stockData';
import { useLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const RECENT_KEY = 'stockpulse_recent_stocks'; // same store StockSearch uses
const MAX_RECENT = 8;

function recentStocks(): Stock[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistRecent(list: Stock[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch { /* quota */ }
}

function stockForSymbol(sym: string): Stock {
  const upper = sym.toUpperCase();
  const known = popularStocks.find(s => s.symbol === upper);
  if (known) return known;
  return {
    ...popularStocks[0],
    symbol: upper,
    name: upper,
    sector: 'Unknown',
    price: 0,
    change: 0,
    changePercent: 0,
    volume: 0,
    marketCap: '',
    pe: 0,
    week52High: 0,
    week52Low: 0,
  };
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const fmtVol = (v: number): string => {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(v);
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

type TimeFrame = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'All';
const TIME_FRAMES: { label: TimeFrame; days: number | null }[] = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '5Y', days: 1260 },
  { label: 'All', days: null },
];

interface ScrubPoint { time: string; price: number }

/* ------------------------------------------------------------------ */
/* Hub — /m                                                            */
/* ------------------------------------------------------------------ */

function MobileHub() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSelect = (stock: Stock) => navigate(`/m/${stock.symbol}`);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-sm px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/m" className="flex items-center gap-2.5 min-h-[44px]" aria-label="Mobile home">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
              <Smartphone className="h-[18px] w-[18px] text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">StockPulse Mobile</h1>
              <p className="text-[11px] text-muted-foreground">{t('appSubtitle')}</p>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { allowFullSite(); navigate('/'); }}
            className="gap-1.5 text-muted-foreground min-h-[44px] px-3"
            aria-label="Open full dashboard"
          >
            <Monitor className="h-4 w-4" />
            <span className="text-xs font-medium">Full site</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-4 space-y-5 pb-24">
        <StockSearch selectedStock={null} onSelectStock={handleSelect} />

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            <TrendingUp className="h-4 w-4 text-primary" />
            Popular
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            {popularStocks.map((s, i) => {
              const up = s.changePercent >= 0;
              return (
                <button
                  key={s.symbol}
                  onClick={() => handleSelect(s)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 min-h-[56px] text-left transition-colors active:bg-accent hover:bg-accent/60',
                    i > 0 && 'border-t border-border',
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{s.symbol}</div>
                    <div className="truncate text-xs text-muted-foreground">{s.name}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm">
                    <div>{usd(s.price)}</div>
                    <div className={cn('text-xs', up ? 'text-bullish' : 'text-bearish')}>
                      {up ? '+' : ''}{s.changePercent.toFixed(2)}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scrub tooltip — renders the floating price chip while dragging      */
/* ------------------------------------------------------------------ */

type ScrubTooltipProps = TooltipProps<number, string> & {
  onScrub: (point: ScrubPoint | null) => void;
};

function ScrubTooltip({ active, payload, onScrub }: ScrubTooltipProps) {
  const point: ScrubPoint | null =
    active && payload && payload.length
      ? { time: String(payload[0].payload?.time ?? ''), price: Number(payload[0].value) }
      : null;

  useEffect(() => {
    onScrub(point);
    // point is recreated each render; compare by value inside onScrub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, payload, onScrub]);

  if (!point) return null;
  return (
    <div className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-muted-foreground">{fmtDate(point.time)}</p>
      <p className="text-base font-bold font-mono">{usd(point.price)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail — /m/:symbol                                                 */
/* ------------------------------------------------------------------ */

function MobileDetail({ symbol }: { symbol: string }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const { triggerHaptic } = useHapticFeedback();

  const tfParam = searchParams.get('tf') as TimeFrame | null;
  const timeFrame: TimeFrame = TIME_FRAMES.some(f => f.label === tfParam) ? tfParam! : '1M';

  const initialStock = useMemo(() => stockForSymbol(symbol), [symbol]);
  const {
    selectedStock, historicalData, isInitialLoading,
    isRealData, error, setSelectedStock,
  } = useStockData(initialStock);

  // Keep the hook's selection in sync with the URL param (e.g. back/forward).
  const upper = symbol.toUpperCase();
  useEffect(() => {
    if (selectedStock.symbol !== upper) setSelectedStock(stockForSymbol(upper));
  }, [upper, selectedStock.symbol, setSelectedStock]);

  const [watching, setWatching] = useState(() => recentStocks().some(s => s.symbol === upper));
  useEffect(() => {
    setWatching(recentStocks().some(s => s.symbol === upper));
  }, [upper]);

  const toggleWatch = () => {
    let list = recentStocks();
    if (list.some(s => s.symbol === upper)) {
      list = list.filter(s => s.symbol !== upper);
      setWatching(false);
      triggerHaptic(15);
    } else {
      const entry = selectedStock.symbol === upper ? selectedStock : stockForSymbol(upper);
      list = [entry, ...list.filter(s => s.symbol !== upper)].slice(0, MAX_RECENT);
      setWatching(true);
      triggerHaptic([10, 40, 10]);
    }
    persistRecent(list);
  };

  const setTimeFrame = (tf: TimeFrame) => {
    setSearchParams({ tf }, { replace: true });
    triggerHaptic(6);
  };

  /* ── chart data ── */
  const chartData = useMemo(() => {
    const tf = TIME_FRAMES.find(f => f.label === timeFrame);
    const sliced = tf?.days ? historicalData.slice(-tf.days) : historicalData;
    return sliced.map(d => ({ time: d.date, price: d.close }));
  }, [historicalData, timeFrame]);

  const rangeUp = chartData.length >= 2
    ? chartData[chartData.length - 1].price >= chartData[0].price
    : (selectedStock.changePercent ?? 0) >= 0;
  const stroke = rangeUp ? 'hsl(160, 84%, 39%)' : 'hsl(0, 72%, 51%)';

  /* ── scrub state: big price mirrors the finger ── */
  const [scrub, setScrub] = useState<ScrubPoint | null>(null);
  const lastScrubTime = useRef<string | null>(null);
  const handleScrub = useCallback((point: ScrubPoint | null) => {
    const time = point?.time ?? null;
    if (time !== lastScrubTime.current) {
      lastScrubTime.current = time;
      if (time) triggerHaptic(8);
    }
    setScrub(prev => {
      if (prev === point) return prev;
      if (prev && point && prev.time === point.time && prev.price === point.price) return prev;
      if (!prev && !point) return prev;
      return point;
    });
  }, [triggerHaptic]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/m');
  };

  /* ── key stats ── */
  const lastBar = historicalData[historicalData.length - 1];
  const last252 = historicalData.slice(-252);
  const w52High = last252.length ? Math.max(...last252.map(d => d.high)) : selectedStock.week52High;
  const w52Low = last252.length ? Math.min(...last252.map(d => d.low)) : selectedStock.week52Low;
  const stats: { label: string; value: string }[] = [
    { label: 'Open', value: lastBar ? usd(lastBar.open) : '—' },
    { label: 'High', value: lastBar ? usd(lastBar.high) : '—' },
    { label: 'Low', value: lastBar ? usd(lastBar.low) : '—' },
    { label: 'Vol', value: lastBar ? fmtVol(lastBar.volume) : '—' },
    { label: 'Mkt Cap', value: selectedStock.marketCap || '—' },
    { label: 'P/E Ratio', value: selectedStock.pe ? selectedStock.pe.toFixed(2) : '—' },
    { label: '52W High', value: w52High ? usd(w52High) : '—' },
    { label: '52W Low', value: w52Low ? usd(w52Low) : '—' },
  ];

  const dayUp = (selectedStock.changePercent ?? 0) >= 0;
  const displayPrice = scrub?.price ?? selectedStock.price;
  const showSkeleton = isInitialLoading && !scrub;

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* 1. Sticky header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-sm px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={goBack}
            className="-ml-1 rounded-full p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Go back"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="text-xl font-bold tracking-tight">{selectedStock.symbol}</h1>
            <p className="mx-auto max-w-[200px] truncate text-xs text-muted-foreground">
              {selectedStock.name}
            </p>
          </div>
          <button
            onClick={toggleWatch}
            className="-mr-1 rounded-full p-2.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={watching ? 'Remove from watchlist' : 'Add to watchlist'}
            aria-pressed={watching}
          >
            <Star
              className={cn(
                'h-6 w-6 transition-colors',
                watching ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground',
              )}
            />
          </button>
        </div>
      </header>

      {/* 2. Price summary */}
      <section className="border-b border-border bg-card/40 px-5 py-6">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              {scrub ? fmtDate(scrub.time) : 'Live Price'}
            </span>
            {showSkeleton ? (
              <Skeleton className="mt-1 h-12 w-40" />
            ) : (
              <p className="truncate text-5xl font-extrabold font-mono tracking-tighter">
                {displayPrice ? usd(displayPrice) : '—'}
              </p>
            )}
          </div>
          {!showSkeleton && (
            <div
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold',
                dayUp
                  ? 'border-success/30 bg-success/10 text-bullish'
                  : 'border-destructive/30 bg-destructive/10 text-bearish',
              )}
            >
              {dayUp ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {selectedStock.change?.toFixed(2) ?? '0.00'} ({selectedStock.changePercent?.toFixed(2) ?? '0.00'}%)
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={isRealData ? 'default' : 'secondary'} className="gap-1.5 text-[11px]">
            {isRealData ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isRealData ? t('liveData') : t('simulated')}
          </Badge>
          {error && (
            <Badge variant="destructive" className="gap-1.5 text-[11px]">
              <AlertCircle className="h-3 w-3" />
              {error}
            </Badge>
          )}
        </div>
      </section>

      {/* 3. Timeframe selector + touch chart */}
      <section className="border-b border-border bg-card/20 py-4">
        <div className="mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TIME_FRAMES.map(tf => (
            <button
              key={tf.label}
              onClick={() => setTimeFrame(tf.label)}
              className={cn(
                'min-h-[44px] flex-none rounded-full px-5 py-2 text-sm font-medium transition whitespace-nowrap',
                timeFrame === tf.label
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'bg-secondary text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={timeFrame === tf.label}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* touch-pan-y: horizontal drag scrubs, vertical drag scrolls the page */}
        <div className="h-[280px] w-full touch-pan-y select-none px-1">
          {showSkeleton ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No price data available for {selectedStock.symbol}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="mobilePriceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={stroke} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" hide />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} hide />
                <Tooltip
                  cursor={{ stroke: 'hsl(173, 80%, 50%)', strokeWidth: 1, strokeDasharray: '6 6' }}
                  content={<ScrubTooltip onScrub={handleScrub} />}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={stroke}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#mobilePriceFill)"
                  activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="mt-1 px-5 text-center text-[11px] text-muted-foreground">
          Daily close — drag across the chart to scrub. Range {chartData.length ? `${fmtDate(chartData[0].time)} → ${fmtDate(chartData[chartData.length - 1].time)}` : '—'}
        </p>
      </section>

      {/* 4. Key statistics */}
      <section className="px-5 py-6">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-bold">
          <Info className="h-5 w-5 text-primary" />
          Key Statistics
        </h2>
        {showSkeleton ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {stats.map(stat => (
              <div key={stat.label} className="flex items-center justify-between border-b border-border pb-2 gap-2">
                <span className="text-sm font-medium text-muted-foreground">{stat.label}</span>
                <span className="truncate text-right text-[15px] font-semibold font-mono tracking-tight">
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. News feed */}
      <section className="px-5 pb-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <Newspaper className="h-5 w-5 text-primary" />
          News
        </h2>
        <StockNews symbol={selectedStock.symbol} />
      </section>

      {/* 6. Fixed action bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 p-4 shadow-[0_-8px_20px_rgba(0,0,0,0.3)] backdrop-blur-lg">
        <div className="mx-auto grid max-w-lg grid-cols-2 gap-3">
          <Button asChild variant="secondary" className="h-12 rounded-xl text-sm font-bold">
            <Link to="/m">
              <Search className="h-4 w-4" /> Change symbol
            </Link>
          </Button>
          <Button asChild className="h-12 rounded-xl text-sm font-bold shadow-lg">
            <Link to={`/?symbol=${selectedStock.symbol}`} onClick={allowFullSite}>
              Full analysis
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Route component                                                     */
/* ------------------------------------------------------------------ */

const MobileStock = () => {
  const { symbol } = useParams();
  return symbol ? <MobileDetail symbol={symbol} /> : <MobileHub />;
};

export default MobileStock;
