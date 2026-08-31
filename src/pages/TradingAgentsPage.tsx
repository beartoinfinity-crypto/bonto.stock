import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useStockData } from '@/hooks/useStockData';
import { Header } from '@/components/Header';
import { popularStocks } from '@/lib/stockData';
import { runTradingAgents, TradingAgentsResult, AnalystReport, DebateEntry, RiskVerdict } from '@/lib/tradingAgents';
import {
  TrendingUp, TrendingDown, Minus, Search, SearchCode, Scale, Shield, Target,
  Briefcase, Brain, Users, Gavel, Crosshair, AlertTriangle, CheckCircle, XCircle,
  BarChart3, Waves, Wallet, Radio, Loader2,
} from 'lucide-react';

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

export default function TradingAgentsPage() {
  const { selectedStock, historicalData: histData, isLoading, setSelectedStock } = useStockData();
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<TradingAgentsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await runTradingAgents(symbol, engineInput, selectedStock);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run the TradingAgents pipeline.');
    } finally {
      setRunning(false);
    }
  };

  const submitSearch = () => {
    const s = search.trim().toUpperCase();
    if (!s) return;
    const found = popularStocks.find((p) => p.symbol === s);
    if (found) {
      setSelectedStock(found);
      setSearch('');
    } else {
      setError(`Unknown symbol "${s}". Pick one from the universe.`);
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
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="Search symbols (e.g. NVDA)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
              />
              <Button variant="outline" size="icon" onClick={submitSearch}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={handleRun} disabled={running || isLoading} className="gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCode className="h-4 w-4" />}
              {running ? 'Running pipeline…' : 'Run TradingAgents'}
            </Button>
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
              <p>Select a symbol and run the pipeline to produce a full multi-agent report for {symbol || 'your stock'}.</p>
            </CardContent>
          </Card>
        )}

        {running && (
          <Card>
            <CardContent className="p-10 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p>Gathering analyst reports, running the debate and risk committee…</p>
            </CardContent>
          </Card>
        )}

        {result && <Report result={result} />}
      </main>
    </div>
  );
}

function Report({ result }: { result: TradingAgentsResult }) {
  const final = result.final;
  const ratingStyle = RATING_STYLES[final.rating];

  return (
    <div className="space-y-5">
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
            <Metric label="Entry" value={result.traderPlan.entry.toFixed(2)} />
            <Metric label="Stop Loss" value={result.traderPlan.stopLoss.toFixed(2)} tone={result.traderPlan.action === 'SELL' ? 'up' : 'down'} />
            <Metric label="Take Profit" value={result.traderPlan.takeProfit.toFixed(2)} tone={result.traderPlan.action === 'SELL' ? 'down' : 'up'} />
          </div>
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
          </div>
          <p className="text-sm text-muted-foreground">{result.portfolio.note}</p>
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

        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full ${ratingStyle.bar} transition-all`}
            style={{ width: `${final.positionWeight}%` }}
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
