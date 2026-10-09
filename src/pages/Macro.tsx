import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Gauge, Loader2, RefreshCw } from 'lucide-react';
import {
  formatMacroDelta, formatMacroValue, MACRO_CATEGORIES, MACRO_SERIES,
  parseObservations, summarize, windowPoints,
  type MacroCategory, type MacroPoint, type MacroSeriesMeta,
} from '@/lib/macro';

type WindowKey = '1Y' | '3Y' | '5Y' | '10Y';
const WINDOWS: Record<WindowKey, number> = { '1Y': 365, '3Y': 1095, '5Y': 1825, '10Y': 3650 };

const startISO = (): string =>
  new Date(Date.now() - 3650 * 86400000).toISOString().slice(0, 10);

const todayISO = (): string => new Date().toISOString().slice(0, 10);

interface MacroState {
  loading: boolean;
  error: string | null;
  disabled: string | null; // FRED key missing → setup notice
  data: Record<string, MacroPoint[]>;
  failed: Record<string, string>;
}

const INITIAL: MacroState = { loading: true, error: null, disabled: null, data: {}, failed: {} };

export default function Macro() {
  const [state, setState] = useState<MacroState>(INITIAL);
  const [win, setWin] = useState<WindowKey>('5Y');
  const [category, setCategory] = useState<'All' | MacroCategory>('All');

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const ids = MACRO_SERIES.map(s => s.id).join(',');
      const res = await fetch(`/api/fred/observations?series=${ids}&start=${startISO()}`);
      if (res.status === 501) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({
          loading: false, error: null,
          disabled: body.error ?? 'FRED_API_KEY is not configured on the server',
          data: {}, failed: {},
        });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({
          ...INITIAL, loading: false,
          error: body.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as {
        series?: Record<string, unknown>;
        failed?: Record<string, string>;
      };
      const data: Record<string, MacroPoint[]> = {};
      for (const [id, raw] of Object.entries(body.series ?? {})) {
        data[id] = parseObservations(raw);
      }
      setState({
        loading: false, error: null, disabled: null,
        data, failed: body.failed ?? {},
      });
    } catch (err) {
      setState({
        ...INITIAL, loading: false,
        error: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, []);

  const runRef = useRef(load);
  runRef.current = load;
  useEffect(() => {
    void runRef.current();
    // mount-only initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownSeries = useMemo(
    () => MACRO_SERIES.filter(s => category === 'All' || s.category === category),
    [category],
  );
  const today = todayISO();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Gauge className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Macro Board</h1>
              <p className="text-xs text-muted-foreground">
                {MACRO_SERIES.length} Federal Reserve FRED series — rates, labor, prices, credit.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Window</label>
              <Select value={win} onValueChange={v => setWin(v as WindowKey)}>
                <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(WINDOWS) as WindowKey[]).map(w => (
                    <SelectItem key={w} value={w}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Category</label>
              <Select value={category} onValueChange={v => setCategory(v as 'All' | MacroCategory)}>
                <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All categories</SelectItem>
                  {MACRO_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="gap-2" onClick={() => void load()} disabled={state.loading}>
              {state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </div>

        {state.disabled && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="py-4 text-sm">
              <span className="font-medium text-warning">Macro data is disabled.</span>{' '}
              <span className="text-muted-foreground">
                {state.disabled}. Set the <code className="font-mono">FRED_API_KEY</code> env var on
                Vercel (free key from research.stlouisfed.org), redeploy, then refresh.
              </span>
            </CardContent>
          </Card>
        )}

        {state.error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive">{state.error}</CardContent>
          </Card>
        )}

        {state.loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading FRED series…
          </div>
        )}

        {!state.loading && !state.disabled && Object.keys(state.failed).length > 0 && (
          <p className="text-xs text-muted-foreground">
            Unavailable: {Object.keys(state.failed).join(', ')}
          </p>
        )}

        {!state.loading && !state.disabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shownSeries.map(meta => (
              <MacroCard
                key={meta.id}
                meta={meta}
                points={state.data[meta.id] ?? []}
                win={win}
                today={today}
              />
            ))}
          </div>
        )}
      </div>
      <BackToTop />
    </div>
  );
}

function MacroCard({ meta, points, win, today }: {
  meta: MacroSeriesMeta;
  points: MacroPoint[];
  win: WindowKey;
  today: string;
}) {
  const stat = useMemo(() => summarize(points), [points]);
  const chartPoints = useMemo(
    () => windowPoints(points, WINDOWS[win], today).map(p => ({ ...p, value: p.value })),
    [points, win, today],
  );
  const chartData = chartPoints.filter(p => p.value !== null);
  const empty = !points.some(p => p.value !== null);

  return (
    <Card className={empty ? 'opacity-60' : undefined}>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">{meta.name}</span>
          <Badge variant="outline" className="font-mono text-[10px]">{meta.id}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold font-mono">
            {formatMacroValue(meta, stat.latest)}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {stat.yoyChange !== null ? (
              <Badge variant="outline" className="font-mono">
                {formatMacroDelta(meta, stat.yoyChange)} YoY
              </Badge>
            ) : (
              'YoY —'
            )}
          </span>
        </div>
        <div className="h-24">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(0, 7)}
                  tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 9 }}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 9 }}
                  width={44}
                  tickCount={3}
                />
                <Tooltip
                  labelFormatter={(d: string) => String(d)}
                  formatter={(v: number) => [formatMacroValue(meta, v), meta.name]}
                  contentStyle={{ background: 'hsl(220, 14%, 12%)', border: '1px solid hsl(215, 20%, 30%)', borderRadius: 8, fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              {empty ? 'No data' : 'Loading chart…'}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-snug">{meta.blurb}</p>
        {stat.latestDate && (
          <p className="text-[10px] font-mono text-muted-foreground">as of {stat.latestDate}</p>
        )}
      </CardContent>
    </Card>
  );
}
