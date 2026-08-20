import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Activity, Gauge, Crosshair, Scale, LogOut, Layers,
  ShieldAlert, CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus,
  History as HistoryIcon, RefreshCw, Database, Cpu,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StockSearch } from '@/components/StockSearch';
import { BackToTop } from '@/components/BackToTop';
import { useStockData } from '@/hooks/useStockData';
import { DEFAULT_PARAMS, EngineParams, runEngine, MarketState, calculatePositionSize, manageExit, buildIcebergPlan, atr } from '@/lib/tacticalEngine';
import { useTacticalHistory } from '@/hooks/useTacticalHistory';
import { cn } from '@/lib/utils';

const stateMeta: Record<MarketState, { label: string; cls: string; weapon: string }> = {
  STRONG_UPTREND: { label: 'STRONG UPTREND', cls: 'bg-success/20 text-bullish border-success/30', weapon: 'Weapon A — breakout pullback (long)' },
  STRONG_DOWNTREND: { label: 'STRONG DOWNTREND', cls: 'bg-destructive/20 text-bearish border-destructive/30', weapon: 'Weapon A — breakdown pullback (short)' },
  SIDEWAYS_TIGHT: { label: 'SIDEWAYS TIGHT', cls: 'bg-primary/20 text-primary border-primary/30', weapon: 'Weapon B — extreme mean reversion' },
  TRANSITIONING: { label: 'TRANSITIONING', cls: 'bg-warning/20 text-neutral border-warning/30', weapon: 'Weapon C — delayed momentum chase' },
};

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const Tactical = () => {
  const { selectedStock, historicalData, isLoading, setSelectedStock } = useStockData();
  const [params, setParams] = useState<EngineParams>(DEFAULT_PARAMS);

  const set = <K extends keyof EngineParams>(key: K, value: EngineParams[K]) =>
    setParams(prev => ({ ...prev, [key]: value }));

  const [lookback, setLookback] = useState(30);
  const result = useMemo(() => runEngine(historicalData, params), [historicalData, params]);
  const {
    replay, source: historySource, computedAt, lastBarDate,
    isLoading: historyLoading, isDefaultParams, refreshing, refresh: refreshHistory,
  } = useTacticalHistory(selectedStock.symbol, historicalData, params, lookback);

  const actionIcon = result?.entry.action === 'BUY' ? TrendingUp : result?.entry.action === 'SELL' ? TrendingDown : Minus;
  const ActionIcon = actionIcon;

  // Hypothetical values for when there's no active trade
  const hypothetical = useMemo(() => {
    if (!result || historicalData.length < 30) return null;
    const price = result.price;
    const currentAtr = atr(historicalData, params.atrLength) || 1;

    // Hypothetical sizing: assume a 1.5× ATR stop distance
    const hypoStop = price - currentAtr * 1.5;
    const hypoSizing = calculatePositionSize(price, hypoStop, historicalData, result.liquidity.totalBidVol, params);

    // Hypothetical exit: assume LONG position
    const hypoExit = manageExit('LONG', price, price, historicalData, params, hypoStop);

    // Hypothetical iceberg
    const hypoIceberg = hypoSizing.finalSize > 0
      ? buildIcebergPlan('BUY', price, hypoSizing.finalSize, params)
      : [];

    return { sizing: hypoSizing, exit: hypoExit, iceberg: hypoIceberg };
  }, [result, historicalData, params]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">StockPulse</span>
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-warning to-warning/50">
                <Crosshair className="h-5 w-5 text-background" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Tactical Engine</h1>
                <p className="text-xs text-muted-foreground">市場狀態機 · 進場三武器 · 動態停利</p>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="hidden font-mono text-xs md:flex">
            {selectedStock.symbol} · {money(result?.price ?? selectedStock.price)}
          </Badge>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-6">
        <div className="max-w-md">
          <StockSearch selectedStock={selectedStock} onSelectStock={setSelectedStock} />
        </div>

        {isLoading || !result ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {result.blocked && (
              <Alert className="border-destructive/40 bg-destructive/10">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Trading halted</AlertTitle>
                <AlertDescription>{result.blocked}</AlertDescription>
              </Alert>
            )}

            {/* Parameters */}
            <Card className="card-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Gauge className="h-5 w-5 text-primary" /> Global parameters</CardTitle>
                <CardDescription>Calibrate before the open — every module below recomputes live.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs">ADX threshold · {params.adxThreshold}</Label>
                  <Slider value={[params.adxThreshold]} min={15} max={40} step={1} onValueChange={([v]) => set('adxThreshold', v)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Bandwidth threshold · {params.bandwidthThreshold.toFixed(3)}</Label>
                  <Slider value={[params.bandwidthThreshold * 1000]} min={20} max={120} step={5} onValueChange={([v]) => set('bandwidthThreshold', v / 1000)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Trailing accelerator · {params.accelerator.toFixed(3)}</Label>
                  <Slider value={[params.accelerator * 1000]} min={5} max={80} step={1} onValueChange={([v]) => set('accelerator', v / 1000)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Max risk per trade · {(params.maxRiskPerTrade * 100).toFixed(1)}%</Label>
                  <Slider value={[params.maxRiskPerTrade * 1000]} min={5} max={50} step={1} onValueChange={([v]) => set('maxRiskPerTrade', v / 1000)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Time stop · {params.timeStopMinutes} min (held {params.minutesHeld} min)</Label>
                  <Slider value={[params.timeStopMinutes]} min={5} max={120} step={5} onValueChange={([v]) => set('timeStopMinutes', v)} />
                  <Slider value={[params.minutesHeld]} min={0} max={180} step={5} onValueChange={([v]) => set('minutesHeld', v)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Iceberg slices · {params.icebergSlices}</Label>
                  <Slider value={[params.icebergSlices]} min={1} max={10} step={1} onValueChange={([v]) => set('icebergSlices', v)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Account equity</Label>
                  <Input
                    type="number"
                    value={params.accountEquity}
                    onChange={e => set('accountEquity', Math.max(0, Number(e.target.value) || 0))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Initial equity (kill switch base)</Label>
                  <Input
                    type="number"
                    value={params.initialEquity}
                    onChange={e => set('initialEquity', Math.max(1, Number(e.target.value) || 1))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Liquidity floor (avg depth) · {params.minDepth}</Label>
                  <Slider value={[params.minDepth]} min={10} max={200} step={10} onValueChange={([v]) => set('minDepth', v)} />
                  <Button variant="outline" size="sm" onClick={() => setParams(DEFAULT_PARAMS)}>Reset defaults</Button>
                </div>
              </CardContent>
            </Card>

            {/* Module 1 + 2 */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="card-glow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Activity className="h-5 w-5 text-primary" /> Module 1 · Microstructure</CardTitle>
                  <CardDescription>Order-book depth and imbalance gate — highest priority.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>What it does:</strong> This module models the order book (bid/ask depth) from daily volume data. It checks whether there is enough liquidity to enter a trade without excessive slippage, and whether one side of the book is overwhelmingly dominant (imbalance &gt; 85%), which often signals a false breakout.
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>How to read it:</strong> The <em>imbalance ratio</em> ranges from −100% (all asks) to +100% (all bids). Positive = buyers dominating, negative = sellers dominating. If the ratio exceeds ±85%, the module blocks trading because extreme one-sided books often reverse sharply. The <em>avg depth</em> must exceed the liquidity floor — if not, the stock is too illiquid for this strategy.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Metric label="Imbalance ratio" value={`${(result.liquidity.imbalanceRatio * 100).toFixed(1)}%`} hint="block > ±85%" />
                    <Metric label="Avg depth (5 levels)" value={result.liquidity.avgDepth.toFixed(0)} hint={`floor ${params.minDepth}`} />
                    <Metric label="Total bid volume" value={result.liquidity.totalBidVol.toLocaleString()} />
                    <Metric label="Total ask volume" value={result.liquidity.totalAskVol.toLocaleString()} />
                  </div>
                  <Badge variant="outline" className={cn(result.liquidity.canTrade ? 'border-success/30 bg-success/15 text-bullish' : 'border-destructive/30 bg-destructive/15 text-bearish')}>
                    {result.liquidity.canTrade ? 'Tradable — liquidity and imbalance pass' : result.liquidity.reason}
                  </Badge>
                  {result.liquidity.canTrade && (
                    <p className="text-xs text-success/80">
                      ✓ Liquidity gate passed. The book has sufficient depth and no extreme imbalance. Proceed to Module 2 for regime classification.
                    </p>
                  )}
                  {!result.liquidity.canTrade && (
                    <p className="text-xs text-destructive/80">
                      ✗ Liquidity gate failed. {result.liquidity.reason === 'Liquidity_Too_Low' ? 'Average depth is below the floor — the stock is too thin to enter without significant slippage risk.' : 'The book is extremely one-sided — this usually precedes a sharp reversal. Stay flat.'}
                    </p>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bid</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead>Ask</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.book.bids.map((b, i) => {
                        const ask = result.book.asks[i];
                        return (
                          <TableRow key={i} className="font-mono text-xs">
                            <TableCell className="text-bullish">{b.price.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{b.volume}</TableCell>
                            {ask ? (
                              <>
                                <TableCell className="text-bearish">{ask.price.toFixed(2)}</TableCell>
                                <TableCell className="text-right">{ask.volume}</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-muted-foreground">—</TableCell>
                                <TableCell className="text-right text-muted-foreground">—</TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <p className="text-xs text-muted-foreground italic">
                    Note: Level-2 depth is not available from daily EOD data, so this book is modelled from volume vs. its 20-day average and the close's position inside the bar range. Treat it as a proxy, not exchange data.
                  </p>
                </CardContent>
              </Card>

              <Card className="card-glow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Gauge className="h-5 w-5 text-primary" /> Module 2 · Regime filter</CardTitle>
                  <CardDescription>ADX / DI plus Bollinger bandwidth decide today's weapon.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>What it does:</strong> Classifies the current market into one of four regimes using ADX (trend strength), +DI/−DI (trend direction), and Bollinger bandwidth (volatility compression). The regime determines which of the three entry "weapons" is active.
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>How to read it:</strong> ADX above the threshold = trending market. +DI &gt; −DI = uptrend, −DI &gt; +DI = downtrend. ADX below threshold − 5 AND bandwidth below its threshold = tight sideways range. Anything in between = transitioning (no clear regime). Each regime maps to a specific entry strategy — see Module 3.
                  </p>
                  <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
                    <p className="text-xs font-medium">Regime → Weapon mapping:</p>
                    <p className="text-xs text-muted-foreground">• <strong>STRONG UPTREND / DOWNTREND</strong> → Weapon A: Trade breakouts that pull back to the 0.618 Fibonacci level. Ride the trend.</p>
                    <p className="text-xs text-muted-foreground">• <strong>SIDEWAYS TIGHT</strong> → Weapon B: Mean-reversion at the 2.5σ Bollinger band extremes with RSI confirmation. Fade the range.</p>
                    <p className="text-xs text-muted-foreground">• <strong>TRANSITIONING</strong> → Weapon C: Chase a volatility burst (move &gt; 1.5× ATR) after it holds its highs. Late momentum entry.</p>
                  </div>
                  <Badge variant="outline" className={cn('text-sm', stateMeta[result.regime.state].cls)}>
                    {stateMeta[result.regime.state].label}
                  </Badge>
                  <p className="text-sm text-muted-foreground">{stateMeta[result.regime.state].weapon}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Metric label="ADX(14)" value={result.regime.adx.toFixed(1)} hint={`threshold ${params.adxThreshold}`} />
                    <Metric label="Bandwidth" value={result.regime.bandwidth.toFixed(3)} hint={`tight < ${params.bandwidthThreshold.toFixed(3)}`} />
                    <Metric label="+DI" value={result.regime.plusDI.toFixed(1)} hint={result.regime.plusDI > result.regime.minusDI ? '↑ bulls lead' : '↓ bears lead'} />
                    <Metric label="-DI" value={result.regime.minusDI.toFixed(1)} hint={result.regime.minusDI > result.regime.plusDI ? '↓ bears lead' : '↑ bulls lead'} />
                    <Metric label="BB upper / lower" value={`${result.regime.bands.upper.toFixed(2)} / ${result.regime.bands.lower.toFixed(2)}`} />
                    <Metric label={`ATR(${params.atrLength})`} value={result.atr.toFixed(2)} hint="avg true range" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Module 3 */}
            <Card className="card-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Crosshair className="h-5 w-5 text-primary" /> Module 3 · Entry signal engine</CardTitle>
                <CardDescription>{result.entry.note}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>What it does:</strong> Based on the regime from Module 2, this module checks whether all entry conditions for the active weapon are met. Each weapon has 2–3 independent checks (breakout + pullback + book confirmation for Weapon A, band extreme + RSI extreme + imbalance for Weapon B, ATR burst + follow-through for Weapon C). ALL checks must pass for a BUY or SELL signal.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>How to read it:</strong> If the action is <strong>HOLD</strong>, at least one check failed — the entry is not armed. Review the failed checks below to understand what's missing. If all checks pass, the module outputs entry price, stop loss (1.5× ATR for Weapon A, band extreme for B, 2× ATR for C), and take profit (2–4× ATR reward-to-risk).
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge
                    variant="outline"
                    className={cn('gap-1.5 text-sm',
                      result.entry.action === 'BUY' ? 'border-success/30 bg-success/15 text-bullish'
                        : result.entry.action === 'SELL' ? 'border-destructive/30 bg-destructive/15 text-bearish'
                        : 'border-warning/30 bg-warning/15 text-neutral')}
                  >
                    <ActionIcon className="h-4 w-4" />{result.entry.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Scenario {result.entry.scenario.replace(/_/g, ' ')}</span>
                </div>
                {result.entry.action === 'HOLD' && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <p className="text-xs text-warning">
                      <strong>No entry today.</strong> The engine requires all conditions to align before firing. This is by design — the strategy prioritises high-probability setups over frequent trading. Review the checks below to see which condition(s) are unmet.
                    </p>
                  </div>
                )}
                {result.entry.action !== 'HOLD' && (
                  <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                    <p className="text-xs text-success">
                      <strong>Entry armed — {result.entry.action} signal active.</strong> All checks passed. The suggested entry, stop, and target are shown below. Position sizing (Module 4) and exit management (Module 5) are now live.
                    </p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Entry" value={result.entry.entryPrice ? money(result.entry.entryPrice) : '—'} hint={result.entry.action === 'HOLD' ? 'no signal' : 'limit price'} />
                  <Metric label="Stop loss" value={result.entry.stopLoss ? money(result.entry.stopLoss) : '—'} hint={result.entry.stopLoss && result.entry.entryPrice ? `${((1 - result.entry.stopLoss / result.entry.entryPrice) * 100).toFixed(1)}% risk` : '—'} />
                  <Metric label="Take profit" value={result.entry.takeProfit ? money(result.entry.takeProfit) : '—'} hint={result.entry.takeProfit && result.entry.entryPrice ? `${((result.entry.takeProfit / result.entry.entryPrice - 1) * 100).toFixed(1)}% target` : '—'} />
                </div>
                <div className="space-y-2">
                  {result.entry.checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                      {c.passed
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                      <div>
                        <div className="font-medium">{c.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Modules 4 + 5 */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="card-glow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Scale className="h-5 w-5 text-primary" /> Module 4 · Position sizing</CardTitle>
                  <CardDescription>Fixed-fractional risk scaled by the volatility ratio, capped by book liquidity.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>What it does:</strong> Calculates how many shares to buy/sell based on your risk budget (equity × max risk %), the stop distance (risk per share), current volatility relative to its 100-day average, and available book liquidity. The final size is the lesser of the risk-based size and the liquidity cap (5% of bid volume).
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>How to read it:</strong> Risk budget = max dollars you can lose on this trade. Risk per share = entry minus stop. Base size = budget ÷ risk/share. Volatility scaling shrinks the position when ATR is elevated (more volatile = smaller size) and expands it when calm. Liquidity cap prevents you from being more than 5% of the order book.
                  </p>
                  {result.sizing ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label="Risk budget" value={money(result.sizing.riskDollars)} hint={`${(params.maxRiskPerTrade * 100).toFixed(1)}% of equity`} />
                      <Metric label="Risk per share" value={money(result.sizing.riskPerShare)} hint="entry − stop" />
                      <Metric label="Base size" value={result.sizing.baseSize.toFixed(0)} hint="budget ÷ risk/share" />
                      <Metric label="Volatility scaling" value={`${result.sizing.volatilityScaling.toFixed(2)}×`} hint="clamped 0.5–1.5" />
                      <Metric label="Liquidity cap (5% of bids)" value={result.sizing.liquidityCap.toLocaleString()} hint="max 5% of book" />
                      <Metric label="Final size" value={result.sizing.finalSize.toLocaleString()} hint={`capped by ${result.sizing.cappedBy} · notional ${money(result.sizing.notional)}`} />
                    </div>
                  ) : hypothetical ? (
                    <div className="space-y-3">
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Hypothetical — no active entry</Badge>
                      <div className="grid grid-cols-2 gap-3">
                        <Metric label="Risk budget" value={money(hypothetical.sizing.riskDollars)} hint={`${(params.maxRiskPerTrade * 100).toFixed(1)}% of equity`} />
                        <Metric label="Risk per share" value={money(hypothetical.sizing.riskPerShare)} hint="1.5× ATR stop" />
                        <Metric label="Base size" value={hypothetical.sizing.baseSize.toFixed(0)} />
                        <Metric label="Volatility scaling" value={`${hypothetical.sizing.volatilityScaling.toFixed(2)}×`} hint="clamped 0.5–1.5" />
                        <Metric label="Liquidity cap (5% of bids)" value={hypothetical.sizing.liquidityCap.toLocaleString()} />
                        <Metric label="Final size" value={hypothetical.sizing.finalSize.toLocaleString()} hint={`capped by ${hypothetical.sizing.cappedBy} · notional ${money(hypothetical.sizing.notional)}`} />
                      </div>
                      <p className="text-xs text-muted-foreground italic">Shows what sizing would be if an entry triggered now (assumes 1.5× ATR stop distance).</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Insufficient data to compute sizing.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="card-glow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><LogOut className="h-5 w-5 text-primary" /> Module 5 · Exit management</CardTitle>
                  <CardDescription>Time stop plus a parabolic-style adaptive trailing stop.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>What it does:</strong> Manages the position after entry using two exit mechanisms: (1) a <em>trailing stop</em> that follows the extreme price (highest high for LONG, lowest low for SHORT) and tightens as holding time grows via an accelerating factor; (2) a <em>time stop</em> that exits if the position is flat (±0.1%) after the time threshold. The hard stop is the original entry stop loss — it never moves.
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>How to read it:</strong> Trailing stop = the price level that triggers an exit if breached. The accelerator increases over time (base + time/60 × 0.01), meaning the trail gets tighter the longer you hold — protecting profits on extended moves. Time stop fires when price hasn't moved meaningfully after the threshold, preventing dead money.
                  </p>
                  {result.exit ? (
                    <div className="space-y-4">
                      <Badge variant="outline" className={cn(result.exit.action === 'EXIT' ? 'border-destructive/30 bg-destructive/15 text-bearish' : 'border-success/30 bg-success/15 text-bullish')}>
                        {result.exit.action} · {result.exit.reason}
                      </Badge>
                      <div className="grid grid-cols-2 gap-3">
                        <Metric label="Trailing stop" value={money(result.exit.trailingStopPrice)} hint={result.exit.action === 'EXIT' ? 'breached — exit now' : 'active — hold above'} />
                        <Metric label="Hard stop" value={money(result.exit.hardStop)} hint="original stop — never moves" />
                        <Metric label="Accelerator used" value={result.exit.acceleratorUsed.toFixed(3)} hint={`held ${result.exit.minutesHeld} min`} />
                        <Metric label="Extreme since entry" value={money(result.exit.extremePrice)} hint="best price reached" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Time stop fires when the position is flat (±0.1%) after {params.timeStopMinutes} minutes; the trailing stop tightens as holding time grows.
                      </p>
                    </div>
                  ) : hypothetical ? (
                    <div className="space-y-3">
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Hypothetical — no active position</Badge>
                      <div className="grid grid-cols-2 gap-3">
                        <Metric label="Trailing stop" value={money(hypothetical.exit.trailingStopPrice)} hint="if LONG entered now" />
                        <Metric label="Hard stop" value={money(hypothetical.exit.hardStop)} hint="1.5× ATR below entry" />
                        <Metric label="Accelerator used" value={hypothetical.exit.acceleratorUsed.toFixed(3)} hint={`held ${hypothetical.exit.minutesHeld} min`} />
                        <Metric label="Extreme since entry" value={money(hypothetical.exit.extremePrice)} hint="current price = initial extreme" />
                      </div>
                      <p className="text-xs text-muted-foreground italic">Projected exit levels assuming a LONG entry at current price.</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Insufficient data to compute exit plan.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Module 6 */}
            <Card className="card-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><Layers className="h-5 w-5 text-primary" /> Module 6 · Iceberg execution plan</CardTitle>
                <CardDescription>Order split into {params.icebergSlices} slices, 8 seconds apart, to limit slippage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>What it does:</strong> Splits the total order size into {params.icebergSlices} smaller limit orders (slices) sent 8 seconds apart. This hides your full intent from the order book and reduces market impact — a large visible order can move the price before it fills.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>How to read it:</strong> Each slice has a slightly different limit price (offset by 0.5 tick per slice) to improve fill probability. The first slice is at or near the entry price; later slices are offset slightly to catch intra-second moves. Total quantity across all slices = the final position size from Module 4.
                </p>
                {result.iceberg.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Slice</TableHead>
                        <TableHead>Limit price</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Send at</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.iceberg.map(s => (
                        <TableRow key={s.index} className="font-mono text-sm">
                          <TableCell>#{s.index}</TableCell>
                          <TableCell>{money(s.price)}</TableCell>
                          <TableCell className="text-right">{s.quantity.toLocaleString()}</TableCell>
                          <TableCell className="text-right">+{s.delaySeconds}s</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : hypothetical && hypothetical.iceberg.length > 0 ? (
                  <div className="space-y-3">
                    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Hypothetical — no active entry</Badge>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Slice</TableHead>
                          <TableHead>Limit price</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Send at</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hypothetical.iceberg.map(s => (
                          <TableRow key={s.index} className="font-mono text-sm">
                            <TableCell>#{s.index}</TableCell>
                            <TableCell>{money(s.price)}</TableCell>
                            <TableCell className="text-right">{s.quantity.toLocaleString()}</TableCell>
                            <TableCell className="text-right">+{s.delaySeconds}s</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing to route — no entry armed or size resolved to zero.</p>
                )}
              </CardContent>
            </Card>

            {/* Daily action history */}
            <Card className="card-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><HistoryIcon className="h-5 w-5 text-primary" /> 收市後行動紀錄 · Session action history</CardTitle>
                <CardDescription>
                  Engine replayed once per closed session over the last {lookback} trading days — every BUY / SELL decision, position event and realised result.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {[10, 30, 60, 120].map(n => (
                    <Button key={n} size="sm" variant={lookback === n ? 'default' : 'outline'} onClick={() => setLookback(n)}>
                      {n}d
                    </Button>
                  ))}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1.5 text-xs">
                      {historySource === 'cache'
                        ? <><Database className="h-3 w-3 text-primary" /> Cached · {computedAt ? new Date(computedAt).toLocaleString() : '—'}{lastBarDate ? ` · bar ${lastBarDate}` : ''}</>
                        : <><Cpu className="h-3 w-3 text-warning" /> {isDefaultParams ? 'Computed in browser' : 'Custom params — live compute'}</>}
                    </Badge>
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={refreshing} onClick={() => refreshHistory()}>
                      <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> Recompute
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  A backend job replays the engine for every tracked symbol on weekdays at 21:45 UTC (~15 min after the close) and stores the result, so revisits read the cache instead of recomputing. Changing the parameters above switches to a live in-browser replay.
                </p>

                <Alert className="border-warning/40 bg-warning/5">
                  <AlertTitle className="text-xs">Realism disclaimer</AlertTitle>
                  <AlertDescription className="text-xs text-muted-foreground space-y-1">
                    <p>This backtest uses <strong>daily close-only bars</strong> — it does not simulate intraday price swings, bid-ask spreads, or partial fills. The exit logic models intraday holding time (barsHeld × 390 minutes), but in reality stops and targets can be hit within a single day based on price action that daily data cannot capture.</p>
                    <p>Past replay performance is <strong>not indicative of future results</strong>. Real execution involves slippage, commissions, and market impact that are not modelled here. Use this as a reference for strategy logic, not as a guarantee of profitability.</p>
                  </AlertDescription>
                </Alert>

                {historyLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : !replay ? (
                  <p className="text-sm text-muted-foreground">Not enough history for a replay (needs 40+ sessions).</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      <Metric label="Sessions" value={String(replay.summary.sessions)} />
                      <Metric label="BUY signals" value={String(replay.summary.buySignals)} />
                      <Metric label="SELL signals" value={String(replay.summary.sellSignals)} />
                      <Metric label="Blocked" value={String(replay.summary.blockedSessions)} hint="kill switch / liquidity" />
                      <Metric label="Closed trades" value={String(replay.summary.closedTrades)} hint={`win rate ${replay.summary.winRate.toFixed(0)}%`} />
                      <Metric label="Net P/L" value={money(replay.summary.netPnl)} hint={replay.summary.openTrade ? `open ${money(replay.summary.openTrade.pnl)}` : 'no open position'} />
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Trades</h3>
                      {replay.trades.length === 0 && !replay.summary.openTrade ? (
                        <p className="text-sm text-muted-foreground">No position was armed in this window — every session ended in HOLD.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Side</TableHead>
                              <TableHead>Entry</TableHead>
                              <TableHead>Exit</TableHead>
                              <TableHead>Reason</TableHead>
                              <TableHead className="text-right">Size</TableHead>
                              <TableHead className="text-right">P/L</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...(replay.summary.openTrade ? [replay.summary.openTrade] : []), ...replay.trades].map((t, i) => (
                              <TableRow key={i} className="text-xs">
                                <TableCell className={cn('font-semibold', t.side === 'LONG' ? 'text-bullish' : 'text-bearish')}>{t.side}</TableCell>
                                <TableCell className="font-mono">{t.entryDate} · {t.entryPrice.toFixed(2)}</TableCell>
                                <TableCell className="font-mono">{t.reason === 'Open' ? `open · ${t.exitPrice.toFixed(2)}` : `${t.exitDate} · ${t.exitPrice.toFixed(2)}`}</TableCell>
                                <TableCell>{t.reason.replace(/_/g, ' ')} · {t.barsHeld}d</TableCell>
                                <TableCell className="text-right font-mono">{t.size.toLocaleString()}</TableCell>
                                <TableCell className={cn('text-right font-mono', t.pnl >= 0 ? 'text-bullish' : 'text-bearish')}>
                                  {money(t.pnl)} ({t.pnlPct.toFixed(2)}%)
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Session log (newest first)</h3>
                      <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">Close</TableHead>
                              <TableHead>Regime</TableHead>
                              <TableHead>Action</TableHead>
                              <TableHead>Event</TableHead>
                              <TableHead>Detail</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {replay.rows.map(r => (
                              <TableRow key={r.date} className="text-xs">
                                <TableCell className="font-mono">{r.date}</TableCell>
                                <TableCell className="text-right font-mono">{r.close.toFixed(2)}</TableCell>
                                <TableCell>{stateMeta[r.state].label}</TableCell>
                                <TableCell className={cn('font-semibold',
                                  r.action === 'BUY' ? 'text-bullish' : r.action === 'SELL' ? 'text-bearish' : 'text-muted-foreground')}>
                                  {r.action}
                                </TableCell>
                                <TableCell>{r.event}</TableCell>
                                <TableCell className="text-muted-foreground">{r.blocked ?? r.eventDetail ?? '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Kill switch */}
            <Card className="card-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><ShieldAlert className="h-5 w-5 text-warning" /> Kill switch</CardTitle>
                <CardDescription>Force stop when equity draws down 5% from the session base.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>What it does:</strong> A circuit breaker that halts all trading if account equity drops 5% below the initial (starting) equity. This prevents catastrophic losses from compounding. When triggered, no new entries are allowed until equity is restored above the threshold.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Equity" value={money(params.accountEquity)} hint="current account value" />
                  <Metric label="Drawdown" value={`${result.kill.drawdownPct.toFixed(2)}%`} hint="limit 5.00%" />
                  <Metric label="Status" value={result.kill.triggered ? 'HALTED' : 'ARMED'} hint={result.kill.triggered ? 'all orders blocked' : 'trading permitted'} />
                </div>
                {result.kill.triggered && (
                  <p className="text-xs text-destructive">
                    ⚠ Kill switch triggered. Equity is ${(params.initialEquity - params.accountEquity).toFixed(0)} below the starting balance. Reduce position sizes or stop trading until equity recovers.
                  </p>
                )}
              </CardContent>
            </Card>


            <p className="text-xs text-muted-foreground italic">
              Analytical model for study only, computed from end-of-day bars — it places no orders and is not financial advice. Backtest results shown in the Session action history are simulated and do not account for intraday price action, slippage, commissions, or execution delays. Always do your own research before trading.
            </p>
          </>
        )}
      </main>

      <BackToTop />
    </div>
  );
};

export default Tactical;
