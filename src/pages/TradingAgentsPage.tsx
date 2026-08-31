import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useStockData } from '@/hooks/useStockData';
import { Header } from '@/components/Header';
import { popularStocks, Stock, StockData, generateHistoricalData } from '@/lib/stockData';
import { fetchStockQuote, fetchHistoricalData } from '@/lib/stockApi';
import { toast } from 'sonner';
import { runTradingAgents, TradingAgentsResult, AnalystReport, DebateEntry, RiskVerdict, StageInfo } from '@/lib/tradingAgents';
import {
  TrendingUp, TrendingDown, Minus, SearchCode, Scale, Shield, Target,
  Briefcase, Brain, Users, Gavel, Crosshair, AlertTriangle, CheckCircle, XCircle,
  BarChart3, Waves, Wallet, Radio, Loader2,
} from 'lucide-react';

// Placeholder Stock for a user-typed symbol not in the curated universe
// (e.g. BE, DRAM). useStockData's live fetch overwrites the real metadata.
function makeCustomStock(symbol: string): Stock {
  return {
    symbol,
    name: symbol.toUpperCase(),
    sector: 'Custom',
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

const BIAS_ICON: Record<string, React.ReactNode> = {
  bullish: <TrendingUp className="h-4 w-4" />,
  bearish: <TrendingDown className="h-4 w-4" />,
  neutral: <Minus className="h-4 w-4" />,
};

const ANALYST_ICON: Record<string, React.ReactNode> = {
  technical: <BarChart3 className="h-5 w-5" />,
  fundamentals: <Briefcase className="h-5 w-5" />,
  sentiment: <Radio className="h-5 w-5" />,
  market: <Waves className="h-5 w-5" />,
};

const RATING_STYLES: Record<string, { cls: string; bar: string; label: string }> = {
  Buy: { cls: 'text-emerald-400', bar: 'bg-emerald-500', label: 'Strong bullish conviction — initiate or add.' },
  Overweight: { cls: 'text-green-400', bar: 'bg-green-500', label: 'Bullish — build position above benchmark weight.' },
  Hold: { cls: 'text-yellow-400', bar: 'bg-yellow-500', label: 'Neutral — maintain current exposure, no new money.' },
  Underweight: { cls: 'text-orange-400', bar: 'bg-orange-500', label: 'Bearish — reduce exposure below benchmark weight.' },
  Sell: { cls: 'text-red-400', bar: 'bg-red-500', label: 'Strong bearish conviction — exit or short.' },
};

function biasBadgeVariant(bias: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (bias === 'bullish') return 'default';
  if (bias === 'bearish') return 'destructive';
  return 'secondary';
}

// Order + labels for the pipeline stepper. Icons mirror the report cards.
const PIPELINE_STAGES: { id: StageInfo['id']; label: string; desc: string }[] = [
  { id: 'analysts', label: 'Analyst Team', desc: 'Research reports' },
  { id: 'research', label: 'Research Mgr', desc: 'Investment preview' },
  { id: 'debate', label: 'Debate', desc: 'Bull vs bear + judge' },
  { id: 'trader', label: 'Trader Agent', desc: 'Entry / stop / target' },
  { id: 'risk', label: 'Risk Mgmt', desc: 'Risk committee' },
  { id: 'portfolio', label: 'Portfolio Mgr', desc: 'Approval & sizing' },
  { id: 'final', label: 'Final Rating', desc: '5-tier decision' },
];

type StageStatus = Record<StageInfo['id'], 'pending' | 'running' | 'done'>;

const ALL_DONE: StageStatus = {
  analysts: 'done', research: 'done', debate: 'done',
  trader: 'done', risk: 'done', portfolio: 'done', final: 'done',
};

export default function TradingAgentsPage() {
  const { selectedStock, historicalData: histData, isLoading, setSelectedStock } = useStockData();
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<TradingAgentsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus | null>(null);
  // Resolved data for a user-typed symbol outside the curated universe.
  // Kept separate from the hook so we never fall back to a wrong mock stock.
  const [custom, setCustom] = useState<{ stock: Stock; historical: StockData[] } | null>(null);

  const symbol = selectedStock.symbol;

  const engineInput = useMemo(
    () => ({
      price: selectedStock.price,
      previousClose: selectedStock.price - selectedStock.change,
      volume: selectedStock.volume,
      marketCap: selectedStock.marketCap,
      historical: histData,
    }),
    [selectedStock, histData],
  );

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    // Reset the stepper to all-pending, then drive it via onStage.
    const pending: StageStatus = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, 'pending'])) as StageStatus;
    setStageStatus(pending);

    const update = (stage: StageInfo) => {
      setStageStatus((prev) => {
        const next = { ...(prev ?? pending) };
        if (stage.status === 'done') {
          next[stage.id] = 'done';
          // any still-pending stages before this one are effectively done
        } else {
          next[stage.id] = 'running';
        }
        return next;
      });
    };

    try {
      // For a custom symbol we use the self-consistent resolved stock+history.
      const input = custom
        ? {
            price: custom.stock.price,
            previousClose: custom.stock.price - custom.stock.change,
            volume: custom.stock.volume,
            marketCap: custom.stock.marketCap,
            historical: custom.historical,
          }
        : engineInput;
      const stock = custom ? custom.stock : selectedStock;
      const res = await runTradingAgents(symbol, input, stock, update);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run the TradingAgents pipeline.');
    } finally {
      setRunning(false);
    }
  };

  // Resolve a symbol outside the curated universe: use live data when real,
  // otherwise synthesize a consistent stock+history keyed to THIS symbol.
  const resolveCustom = async (s: string): Promise<{ stock: Stock; historical: StockData[] }> => {
    const [quoteRes, histRes] = await Promise.all([
      fetchStockQuote(s, true).catch(() => ({ data: null as Stock | null, isRealData: false })),
      fetchHistoricalData(s, true).catch(() => ({ data: null as StockData[] | null, isRealData: false })),
    ]);

    const historical = (histRes.data && histRes.data.length ? histRes.data : generateHistoricalData(quoteRes.data?.price || 25, 0.02)) as StockData[];

    if (quoteRes.isRealData && quoteRes.data && quoteRes.data.price > 0) {
      return { stock: quoteRes.data, historical };
    }

    // Live quote unavailable — derive a stub from the most recent close.
    const lastClose = historical.length ? historical[historical.length - 1].close : 25;
    const stub = makeCustomStock(s);
    stub.price = lastClose;
    stub.previousClose = historical.length > 1 ? historical[historical.length - 2].close : lastClose;
    stub.change = stub.price - stub.previousClose;
    stub.changePercent = stub.previousClose ? (stub.change / stub.previousClose) * 100 : 0;
    return { stock: stub, historical };
  };

  const submitSearch = async () => {
    const s = search.trim().toUpperCase();
    if (!s) return;
    const found = popularStocks.find((p) => p.symbol === s);
    if (found) {
      setCustom(null);
      setSelectedStock(found);
      setSearch('');
      // same-symbol re-run / switch -> kick off analysis for this symbol
      void handleRun();
      return;
    }
    // Non-curated symbol (e.g. BE, DRAM): resolve a self-consistent stock, then run.
    setRunning(true);
    setError(null);
    try {
      const resolved = await resolveCustom(s);
      setCustom(resolved);
      setSelectedStock(resolved.stock);
      setSearch('');
      if (!resolved.stock.name || resolved.stock.sector === 'Custom') {
        toast.info(`Live data unavailable for "${s}"; using derived data.`, { duration: 5000 });
      }
      void handleRun();
    } catch {
      setError(`Could not resolve symbol "${s}".`);
      setRunning(false);
    }
  };

  const final = result?.final;
  const ratingStyle = final ? RATING_STYLES[final.rating] : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-6xl mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SearchCode className="h-6 w-6 text-primary" />
            Trading Agents
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            A rule-based reimplementation of the multi-agent trading workflow — analyst team, research manager,
            bull/bear debate, trader, risk committee and portfolio manager. No AI APIs: every stage is driven by
            deterministic analyzers.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch">
              <div className="flex-1 flex gap-2">
                <Input
                  placeholder="Enter ticker, e.g. NVDA, AAPL or a custom symbol"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
                  disabled={running}
                />
                <Button variant="outline" onClick={submitSearch} disabled={running} className="shrink-0">
                  Search
                </Button>
              </div>
              <Button onClick={handleRun} disabled={running || isLoading} className="gap-2 shrink-0">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCode className="h-4 w-4" />}
                {running ? 'Analyzing…' : 'Analyze'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Now analyzing</span>
              <Badge variant="outline" className="font-mono">{symbol || '—'}</Badge>
              {!running && !result && (
                <span className="hidden sm:inline">— type a ticker and hit <b>Analyze</b> to run the full pipeline in one step</span>
              )}
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </CardContent>
          </Card>
        )}

        {!result && !running && (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              <SearchCode className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
              <p>Select or type a symbol and press <b>Analyze</b> to produce a full multi-agent report for {symbol || 'your stock'}.</p>
            </CardContent>
          </Card>
        )}

        {running && (
          <StageStepper status={stageStatus} running />
        )}

        {result && <Report result={result} status={stageStatus ?? ALL_DONE} />}
      </main>
    </div>
  );
}

function Report({ result, status }: { result: TradingAgentsResult; status: StageStatus }) {
  const final = result.final;
  const ratingStyle = RATING_STYLES[final.rating];

  return (
    <div className="space-y-5">
      <StageStepper status={status} running={false} />
      <FinalHero result={result} ratingStyle={ratingStyle} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-5 w-5 text-primary" /> 1. Analyst Team — Research Reports
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {result.analysts.map((a) => <AnalystCard key={a.id} analyst={a} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-primary" /> 2. Research Manager — Investment Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{result.researchPreview.summary}</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant={biasBadgeVariant(result.researchPreview.overallBias)} className="gap-1">
              {BIAS_ICON[result.researchPreview.overallBias]} Overall: {result.researchPreview.overallBias}
            </Badge>
            <Badge variant="outline">Consensus confidence {result.researchPreview.consensusConfidence}%</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{result.researchPreview.spreadNotes}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-5 w-5 text-primary" /> 3. Researcher Debate — Bull vs Bear + Judge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.debate.map((d, i) => <DebateRow key={i} entry={d} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="h-5 w-5 text-primary" /> 4. Trader Agent — Trading Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={biasBadgeVariant(result.traderPlan.action === 'BUY' ? 'bullish' : result.traderPlan.action === 'SELL' ? 'bearish' : 'neutral')} className="text-sm">
              {result.traderPlan.action}
            </Badge>
            <Badge variant="outline">Confidence {result.traderPlan.confidence}%</Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label={result.traderPlan.action === 'SELL' ? 'Entry (Short)' : 'Entry'} value={result.traderPlan.entry.toFixed(2)} />
            <Metric label={result.traderPlan.action === 'SELL' ? 'Stop Loss (above entry)' : 'Stop Loss'} value={result.traderPlan.stopLoss.toFixed(2)} tone={result.traderPlan.action === 'SELL' ? 'up' : 'down'} />
            <Metric label={result.traderPlan.action === 'SELL' ? 'Take Profit (below entry)' : 'Take Profit'} value={result.traderPlan.takeProfit.toFixed(2)} tone={result.traderPlan.action === 'SELL' ? 'down' : 'up'} />
          </div>
          {result.traderPlan.action === 'SELL' && (
            <p className="text-xs text-muted-foreground">
              Short sale: you sell at the entry and profit if price falls. Stop loss sits <span className="text-red-400">above</span> entry to cap a rising-price loss; take profit sits <span className="text-emerald-400">below</span> entry where you cover and lock in gains.
            </p>
          )}
          <p className="text-sm text-muted-foreground">{result.traderPlan.rationale}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-primary" /> 5. Risk Management — Debate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.riskDebate.map((r, i) => <RiskRow key={i} verdict={r} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5 text-primary" /> 6. Portfolio Manager — Decision
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            {result.portfolio.approved
              ? <CheckCircle className="h-5 w-5 text-emerald-500" />
              : <XCircle className="h-5 w-5 text-red-500" />}
            <span className={`font-semibold ${result.portfolio.approved ? 'text-emerald-500' : 'text-red-500'}`}>
              {result.portfolio.approved ? 'Approved' : 'Rejected'}
            </span>
            <Badge variant="outline">{result.portfolio.positionWeight}% position size</Badge>
            <Badge variant={biasBadgeVariant(result.portfolio.signal === 'BUY' ? 'bullish' : result.portfolio.signal === 'SELL' ? 'bearish' : 'neutral')}>
              Signal: {result.portfolio.signal}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{result.portfolio.note}</p>
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground mb-1">PM Opinion</div>
            <p className="text-sm">{result.portfolio.opinion}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FinalHero({ result, ratingStyle }: { result: TradingAgentsResult; ratingStyle: { cls: string; bar: string; label: string } }) {
  const final = result.final;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold">{result.symbol}</h2>
              <span className="text-muted-foreground">{result.stockName}</span>
              <span className="text-xs text-muted-foreground">{result.sector}</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              ${result.price.toFixed(2)} · {result.changePercent >= 0 ? '+' : ''}{result.changePercent.toFixed(2)}%
            </div>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-extrabold ${ratingStyle.cls}`}>{final.rating}</div>
            <div className="text-xs text-muted-foreground mt-1">{ratingStyle.label}</div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Rating strength</span>
          <span className="font-mono">Conviction {final.conviction}%</span>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full ${ratingStyle.bar} transition-all`}
            style={{ width: `${final.conviction}%` }}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Action" value={final.action} />
          <Metric label="Confidence" value={`${final.confidence}%`} />
          <Metric label="Position Size" value={`${final.positionWeight}%`} />
          <Metric label="Price" value={`$${result.price.toFixed(2)}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const cls = tone === 'up' ? 'text-emerald-500' : tone === 'down' ? 'text-red-500' : '';
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function StageStepper({ status, running }: { status: StageStatus; running: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Radio className="h-4 w-4 text-primary" /> Pipeline Progress
          {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE_STAGES.map((s, i) => {
            const st = status?.[s.id] ?? (running ? 'pending' : 'done');
            const isDone = st === 'done';
            const isRunningNow = st === 'running';
            return (
              <li
                key={s.id}
                className={`flex items-start gap-2 rounded-lg border p-2.5 ${
                  isRunningNow
                    ? 'border-primary/50 bg-primary/5'
                    : isDone
                      ? 'border-border bg-muted/30'
                      : 'border-border opacity-60'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  ) : isRunningNow ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground/50">{i + 1}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${isRunningNow ? 'text-primary' : ''}`}>{s.label}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.desc}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function AnalystCard({ analyst }: { analyst: AnalystReport }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        {ANALYST_ICON[analyst.id]}
        <div className="flex-1">
          <div className="font-semibold text-sm">{analyst.name}</div>
          <div className="text-xs text-muted-foreground">{analyst.role}</div>
        </div>
        <Badge variant={biasBadgeVariant(analyst.bias)} className="gap-1">
          {BIAS_ICON[analyst.bias]} {analyst.bias}
        </Badge>
      </div>
      <div className="mt-2 tooltip text-sm">{analyst.summary}</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground shrink-0">Score</span>
        <Progress value={Math.abs(analyst.score)} className="h-1.5" />
        <span className={`font-mono shrink-0 ${analyst.score >= 0 ? 'text-emerald-500' : analyst.score < 0 ? 'text-red-500' : ''}`}>
          {analyst.score >= 0 ? '+' : ''}{analyst.score}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Confidence {analyst.confidence}%</span>
        <span className="text-xs text-muted-foreground">{analyst.keyMetric}</span>
      </div>
      {analyst.evidence.length > 0 && (
        <ul className="mt-3 space-y-1">
          {analyst.evidence.map((e, i) => (
            <li key={i} className="text-xs text-muted-foreground list-disc ml-4">{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DebateRow({ entry }: { entry: DebateEntry }) {
  const isBull = entry.speaker === 'bull';
  const isBear = entry.speaker === 'bear';
  const isJudge = entry.speaker === 'judge';
  const border = isJudge ? 'border-primary/40' : isBull ? 'border-emerald-500/30' : isBear ? 'border-red-500/30' : 'border-border';
  return (
    <div className={`rounded-lg border ${border} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isJudge ? <Gavel className="h-4 w-4 text-primary" /> : isBull ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
          <span className="font-semibold text-sm">{entry.label}</span>
        </div>
        <Badge variant={isJudge ? 'outline' : biasBadgeVariant(entry.stance)} className={isJudge ? '' : 'gap-1'}>
          {!isJudge && BIAS_ICON[entry.stance]} <span className="text-xs">Pts {entry.points}</span>
        </Badge>
      </div>
      <p className="mt-2 text-sm">{entry.message}</p>
    </div>
  );
}

function RiskRow({ verdict }: { verdict: RiskVerdict }) {
  const tone = verdict.riskLevel === 'high' ? 'text-red-500' : verdict.riskLevel === 'medium' ? 'text-yellow-500' : 'text-emerald-500';
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{verdict.persona}</span>
        </div>
        <div className="flex items-center gap-2">
          {verdict.allowed
            ? <CheckCircle className="h-4 w-4 text-emerald-500" />
            : <XCircle className="h-4 w-4 text-red-500" />}
          <Badge variant="outline" className={tone}>{verdict.riskLevel} risk</Badge>
          {verdict.allowed && <Badge variant="outline">{verdict.maxWeight}% cap</Badge>}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{verdict.reason}</p>
    </div>
  );
}
