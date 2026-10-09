import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Header } from '@/components/Header';
import { BackToTop } from '@/components/BackToTop';
import { ResearchNotes, type ResearchNote } from '@/components/ResearchNotes';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, Loader2, RefreshCw, Search, Zap } from 'lucide-react';
import {
  chainRows, expectedMove, listExpiries, maxPainStrike, nearestExpiry, oiWalls,
  parseTape, putCallRatios, ratioVerdict, unusualActivity,
  type OptionQuote, type OptionsTape,
} from '@/lib/optionsFlow';

const SYMBOL_KEY = 'stockpulse_flow_symbol';

const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-US', { maximumFractionDigits: digits });

const fmtStrike = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toFixed(1);

const fmtPct = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

const fmtRatio = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? '—' : v.toFixed(2);

const todayISO = (): string => new Date().toISOString().slice(0, 10);

interface LoadState {
  loading: boolean;
  error: string | null;
}

const FLOW_NOTES: ResearchNote[] = [
  { term: 'Put/call ratio (volume & OI)', body: 'Put volume ÷ call volume for the selected expiry. The badge tags ≥ 1.10 “bearish”, ≤ 0.80 “bullish”, in between “neutral” — a contrarian read: heavy put buying usually marks fear/hedging that can precede bounces, while call froth often marks complacency. The OI variant is standing positioning — slower and steadier than today’s tape. A single sweep swings the intraday ratio, so judge both together.' },
  { term: 'Open-interest walls', body: 'The highest-OI call and put strikes. Price tends to be drawn toward the area between the walls into expiry (dealers hedge around big OI), and a decisive break of a wall often accelerates — those strikes are where stops and hedges cluster.' },
  { term: 'Max pain', body: 'The strike where option holders are paid the least at expiry — the classic pin candidate. A tendency, not a promise: strong trends run straight through it, and it only carries meaning close to expiry.' },
  { term: 'Expected move (ATM straddle)', body: '±0.85 × the ATM straddle mid ≈ one standard deviation — roughly a 68% chance the expiry lands inside that dollar band. It is the market’s own estimate of how far price may travel; about a third of expiries resolve outside it. Same information as IV30, expressed in dollars.' },
  { term: 'Unusual activity', body: 'Volume ≥ 2× open interest: contracts changing hands faster than they are being opened — fresh positioning (a new thesis or hedge) rather than rotation between strikes. “∞” means volume with zero prior OI (all-new interest). Biggest prints first; unusual says something is happening, not which way it resolves.' },
  { term: 'Chain table', body: 'The ATM row is highlighted (nearest strike to spot with both sides quoted). “Near the money” caps the chain around spot — the far tails are noise for most reads; toggle to all rows for full depth. IV is annualized: 40% ≈ ±2.5% expected daily wiggle (÷√252).' },
];

export default function OptionsFlow() {
  const [symbolInput, setSymbolInput] = useState<string>(
    () => localStorage.getItem(SYMBOL_KEY) || 'AAPL',
  );
  const [tape, setTape] = useState<OptionsTape | null>(null);
  const [state, setState] = useState<LoadState>({ loading: false, error: null });
  const [expiry, setExpiry] = useState<string | null>(null);
  const [showAllChain, setShowAllChain] = useState(false);

  const load = useCallback(async (rawSymbol: string) => {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) return;
    setState({ loading: true, error: null });
    try {
      const res = await fetch(`/api/cboe/options?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) detail = body.error;
        } catch { /* non-JSON error body */ }
        setState({ loading: false, error: detail });
        return;
      }
      const parsed = parseTape(await res.json());
      if (!parsed || parsed.contracts.length === 0) {
        setState({ loading: false, error: 'No contracts in the returned tape.' });
        return;
      }
      localStorage.setItem(SYMBOL_KEY, symbol);
      setTape(parsed);
      setExpiry(nearestExpiry(parsed, todayISO()));
      setShowAllChain(false);
      setState({ loading: false, error: null });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, []);

  const runRef = useRef(load);
  runRef.current = load;
  useEffect(() => {
    void runRef.current(localStorage.getItem(SYMBOL_KEY) || 'AAPL');
    // mount-only initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expiries = useMemo(() => (tape ? listExpiries(tape) : []), [tape]);
  const activeExpiry = expiry ?? expiries[0] ?? null;

  const analysis = useMemo(() => {
    if (!tape || !activeExpiry) return null;
    const contracts = chainRows(
      // analysis for the whole expiry (ratios/walls/max pain need every row)
      tape.contracts.filter(c => c.expiry === activeExpiry),
    );
    const flat = tape.contracts.filter(c => c.expiry === activeExpiry);
    return {
      rows: contracts,
      ratios: putCallRatios(flat),
      walls: oiWalls(flat),
      maxPain: maxPainStrike(flat),
      move: expectedMove(tape.price, flat),
      unusual: unusualActivity(flat),
    };
  }, [tape, activeExpiry]);

  // Chart/table windows: strikes closest to spot (calls + puts at each strike)
  const spot = tape?.price ?? null;
  const windowed = useMemo(() => {
    if (!analysis) return { chart: [], chain: [] };
    const withOi = analysis.rows.filter(r =>
      (r.call?.oi ?? 0) > 0 || (r.put?.oi ?? 0) > 0);
    const byDist = [...withOi].sort((a, b) =>
      spot === null ? a.strike - b.strike : Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    const chart = byDist.slice(0, 31)
      .map(r => ({
        strike: r.strike,
        calls: r.call?.oi ?? 0,
        puts: r.put?.oi ?? 0,
        atm: spot !== null && r.strike === nearestStrike(analysis.rows, spot),
      }))
      .sort((a, b) => a.strike - b.strike);
    const near = showAllChain ? analysis.rows : [...analysis.rows]
      .sort((a, b) =>
        spot === null ? a.strike - b.strike : Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, 41)
      .sort((a, b) => a.strike - b.strike);
    return { chart, chain: near };
  }, [analysis, spot, showAllChain]);

  const verdict = ratioVerdict(analysis?.ratios.byVolume ?? null);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Activity className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Options Flow</h1>
              <p className="text-xs text-muted-foreground">
                Real delayed option tape — put/call, OI walls, max pain, expected move.
                {tape && (
                  <>
                    {' '}<span className="font-mono">{tape.symbol}</span>
                    {tape.price !== null && (
                      <> · {fmtNum(tape.price)} ({fmtPct(tape.priceChangePercent)})</>
                    )}
                    {tape.iv30 !== null && <> · IV30 {tape.iv30.toFixed(1)}%</>}
                    {tape.timestamp && <> · as of {tape.timestamp}</>}
                  </>
                )}
              </p>
            </div>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={e => { e.preventDefault(); void load(symbolInput); }}
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={symbolInput}
                onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="pl-8 w-28 font-mono uppercase"
                aria-label="Symbol"
              />
            </div>
            <Button size="sm" type="submit" disabled={state.loading}>
              {state.loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              Load
            </Button>
          </form>
        </div>

        {state.error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive">
              {state.error}
            </CardContent>
          </Card>
        )}

        {state.loading && !tape && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Fetching delayed option tape…
          </div>
        )}

        {tape && analysis && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">
                    Put / Call (volume)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono">
                      {fmtRatio(analysis.ratios.byVolume)}
                    </span>
                    {verdict && (
                      <Badge
                        variant="outline"
                        className={
                          verdict === 'bearish' ? 'text-destructive border-destructive/40'
                            : verdict === 'bullish' ? 'text-success border-success/40'
                              : 'text-muted-foreground'
                        }
                      >
                        {verdict}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    P {fmtNum(analysis.ratios.putVolume, 0)} · C {fmtNum(analysis.ratios.callVolume, 0)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">
                    Put / Call (OI)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">
                    {fmtRatio(analysis.ratios.byOi)}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    P {fmtNum(analysis.ratios.putOi, 0)} · C {fmtNum(analysis.ratios.callOi, 0)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">
                    Max pain · {activeExpiry ?? '—'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">
                    {analysis.maxPain === null ? '—' : fmtStrike(analysis.maxPain)}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    {spot !== null && analysis.maxPain !== null
                      ? `${fmtPct(((analysis.maxPain - spot) / spot) * 100)} vs spot`
                      : 'price magnet at expiry'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-normal text-muted-foreground">
                    Expected move (ATM straddle)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">
                    {analysis.move
                      ? `±${fmtNum(analysis.move.amount)}`
                      : '—'}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    {analysis.move
                      ? `${analysis.move.pct.toFixed(2)}% · straddle ${fmtNum(analysis.move.straddleMid)} @ ${fmtStrike(analysis.move.strike)}`
                      : 'no two-sided ATM quote'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* OI walls chart + unusual activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Open interest by strike
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {analysis.walls.call && `call wall ${fmtStrike(analysis.walls.call.strike)}`}
                      {analysis.walls.call && analysis.walls.put && ' · '}
                      {analysis.walls.put && `put wall ${fmtStrike(analysis.walls.put.strike)}`}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={windowed.chart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 30%)" opacity={0.4} />
                      <XAxis
                        dataKey="strike"
                        tickFormatter={(v: number) => fmtStrike(v)}
                        tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tickFormatter={(v: number) => fmtNum(v, 0)}
                        tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }}
                        width={54}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [fmtNum(value, 0), name]}
                        labelFormatter={(label: number) => `Strike ${fmtStrike(label)}`}
                        contentStyle={{ background: 'hsl(220, 14%, 12%)', border: '1px solid hsl(215, 20%, 30%)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="calls" name="Call OI" fill="hsl(160, 84%, 39%)" />
                      <Bar dataKey="puts" name="Put OI" fill="hsl(0, 72%, 51%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-warning" /> Unusual activity
                    <span className="text-xs font-normal text-muted-foreground">
                      volume ≥ 2× open interest
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1.5 pr-2">Side</th>
                        <th className="py-1.5 pr-2">Expiry</th>
                        <th className="py-1.5 pr-2 text-right">Strike</th>
                        <th className="py-1.5 pr-2 text-right">Vol</th>
                        <th className="py-1.5 pr-2 text-right">OI</th>
                        <th className="py-1.5 pr-2 text-right">Vol/OI</th>
                        <th className="py-1.5 text-right">Bid/Ask</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.unusual.map(({ quote, turnover }) => (
                        <tr key={`${quote.expiry}-${quote.strike}-${quote.type}`} className="border-t border-border">
                          <td className="py-1.5 pr-2">
                            <Badge
                              variant="outline"
                              className={
                                quote.type === 'C'
                                  ? 'text-success border-success/40'
                                  : 'text-destructive border-destructive/40'
                              }
                            >
                              {quote.type === 'C' ? 'CALL' : 'PUT'}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-xs">{quote.expiry}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{fmtStrike(quote.strike)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(quote.volume, 0)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(quote.oi, 0)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono text-warning">
                            {turnover === Infinity ? '∞' : `${turnover.toFixed(1)}×`}
                          </td>
                          <td className="py-1.5 text-right font-mono text-xs">
                            {fmtNum(quote.bid)} / {fmtNum(quote.ask)}
                          </td>
                        </tr>
                      ))}
                      {analysis.unusual.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-3 text-xs text-muted-foreground text-center">
                            No contracts at 2× OI today
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>

            {/* Full chain */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>Option chain</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                      Expiry
                      <Select
                        value={activeExpiry ?? undefined}
                        onValueChange={v => { setExpiry(v); setShowAllChain(false); }}
                      >
                        <SelectTrigger className="w-32 h-8 text-xs font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {expiries.map(e => (
                            <SelectItem key={e} value={e} className="font-mono text-xs">{e}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setShowAllChain(v => !v)}
                    >
                      {showAllChain ? 'Near the money only' : `Show all (${analysis.rows.length})`}
                    </Button>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left border-b border-border">
                      <th className="py-1.5 pr-2 text-center text-success" colSpan={5}>
                        Calls
                      </th>
                      <th className="py-1 px-1 text-center">Strike</th>
                      <th className="py-1.5 pl-2 text-center text-destructive" colSpan={5}>
                        Puts
                      </th>
                    </tr>
                    <tr className="text-right">
                      <th className="py-1.5 pr-1">Bid</th>
                      <th className="py-1.5 pr-1">Ask</th>
                      <th className="py-1.5 pr-1">Vol</th>
                      <th className="py-1.5 pr-1">OI</th>
                      <th className="py-1.5 pr-1">IV</th>
                      <th className="py-1 px-1 text-center"> </th>
                      <th className="py-1.5 pl-1">Bid</th>
                      <th className="py-1.5 pl-1">Ask</th>
                      <th className="py-1.5 pl-1">Vol</th>
                      <th className="py-1.5 pl-1">OI</th>
                      <th className="py-1.5 pl-1">IV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windowed.chain.map(row => (
                      <ChainRowCells
                        key={row.strike}
                        row={row}
                        isAtm={spot !== null && row.strike === nearestStrike(analysis.rows, spot)}
                      />
                    ))}
                    {windowed.chain.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-3 text-center text-muted-foreground">
                          No contracts for {activeExpiry}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        <ResearchNotes notes={FLOW_NOTES} />

        <p className="text-xs text-muted-foreground">
          Data: CBOE delayed quotes (≈15 minutes), served through the StockPulse API.
          Rule-based analytics for education only — not investment advice.
        </p>
      </div>
      <BackToTop />
    </div>
  );
}

function nearestStrike(rows: { strike: number }[], spot: number): number {
  let best = rows[0]?.strike ?? 0;
  let bestDist = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.strike - spot);
    if (d < bestDist) { bestDist = d; best = r.strike; }
  }
  return best;
}

const ivCell = (v: number | null): string =>
  v !== null && v > 0 ? `${(v * 100).toFixed(0)}%` : '—';

const ChainRowCells = ({ row, isAtm }: {
  row: { strike: number; call: OptionQuote | null; put: OptionQuote | null };
  isAtm: boolean;
}) => {
  const c = row.call;
  const p = row.put;
  const cell = (q: OptionQuote | null, field: 'bid' | 'ask' | 'volume' | 'oi'): string => {
    if (!q) return '—';
    if (field === 'bid' || field === 'ask') return fmtNum(q[field]);
    return fmtNum(q[field], 0);
  };
  return (
    <tr className={`border-b border-border/50 ${isAtm ? 'bg-primary/5' : ''}`}>
      <td className="py-1 pr-1 text-right font-mono">{cell(c, 'bid')}</td>
      <td className="py-1 pr-1 text-right font-mono">{cell(c, 'ask')}</td>
      <td className="py-1 pr-1 text-right font-mono">{cell(c, 'volume')}</td>
      <td className="py-1 pr-1 text-right font-mono">{cell(c, 'oi')}</td>
      <td className="py-1 pr-1 text-right font-mono text-muted-foreground">{ivCell(c?.iv ?? null)}</td>
      <td className={`py-1 px-1 text-center font-mono font-semibold ${isAtm ? 'text-primary' : ''}`}>
        {fmtStrike(row.strike)}
        {isAtm && <span className="block text-[9px] font-normal text-muted-foreground">ATM</span>}
      </td>
      <td className="py-1 pl-1 text-right font-mono">{cell(p, 'bid')}</td>
      <td className="py-1 pl-1 text-right font-mono">{cell(p, 'ask')}</td>
      <td className="py-1 pl-1 text-right font-mono">{cell(p, 'volume')}</td>
      <td className="py-1 pl-1 text-right font-mono">{cell(p, 'oi')}</td>
      <td className="py-1 pl-1 text-right font-mono text-muted-foreground">{ivCell(p?.iv ?? null)}</td>
    </tr>
  );
};
