import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useStockData } from '@/hooks/useStockData';
import { Header } from '@/components/Header';
import { popularStocks } from '@/lib/stockData';
import { analyzeStock, MasterAnalysis } from '@/lib/masterAnalysis';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle, Search, User, Briefcase, Target, Shield, Brain, BarChart3, Activity, Eye, Scale, Zap } from 'lucide-react';

const MASTER_ICONS: Record<string, React.ReactNode> = {
  'buffett-graham': <Briefcase className="h-5 w-5" />,
  'peter-lynch': <TrendingUp className="h-5 w-5" />,
  'greenblatt': <Scale className="h-5 w-5" />,
  'livermore': <Target className="h-5 w-5" />,
  'munger': <Brain className="h-5 w-5" />,
  'marks': <Shield className="h-5 w-5" />,
  'templeton': <Eye className="h-5 w-5" />,
  'minervini': <Zap className="h-5 w-5" />,
  'oneil': <BarChart3 className="h-5 w-5" />,
  'weinstein': <Activity className="h-5 w-5" />,
  'darvas': <CheckCircle className="h-5 w-5" />,
  'wyckoff': <Search className="h-5 w-5" />,
};

function withIcons(masters: MasterAnalysis[]): (MasterAnalysis & { icon: React.ReactNode })[] {
  return masters.map(m => ({ ...m, icon: MASTER_ICONS[m.id] ?? <User className="h-5 w-5" /> }));
}

function localAnalyzeStock(symbol: string, data: any): MasterAnalysis[] {
  return analyzeStock(symbol, {
    price: data?.price ?? 0,
    previousClose: data?.previousClose ?? 0,
    volume: data?.volume ?? 0,
    marketCap: data?.marketCap ?? 0,
    historical: data?.historical ?? [],
  });
}

function verdictColor(v: string) {
  switch (v) {
    case 'BUY': return 'bg-success/20 text-success border-success/30';
    case 'HOLD': return 'bg-warning/20 text-warning border-warning/30';
    case 'SELL': return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'AVOID': return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'WATCH': return 'bg-muted text-muted-foreground border-border';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function confidenceColor(c: number) {
  if (c >= 70) return 'text-success';
  if (c >= 50) return 'text-warning';
  return 'text-destructive';
}

export default function TradingMasters() {
  const [inputSymbol, setInputSymbol] = useState('AAPL');
  const { selectedStock, historicalData: histData, isLoading, setSelectedStock } = useStockData();
  const [sortBy, setSortBy] = useState<'verdict' | 'confidence'>('confidence');
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analyzedSymbol, setAnalyzedSymbol] = useState('');
  const progressTimer = useRef<ReturnType<typeof setInterval>>();

  const searchSymbol = selectedStock.symbol;

  // Animate progress while loading
  useEffect(() => {
    if (isLoading) {
      setProgress(0);
      let p = 0;
      progressTimer.current = setInterval(() => {
        p += Math.random() * 15 + 5;
        if (p >= 90) p = 90;
        setProgress(p);
      }, 200);
      return () => clearInterval(progressTimer.current);
    } else if (analyzing) {
      // Data loaded ??fill to 100%
      clearInterval(progressTimer.current);
      setProgress(100);
      const t = setTimeout(() => setAnalyzing(false), 400);
      return () => clearTimeout(t);
    }
  }, [isLoading, analyzing]);

  const data = useMemo(() => {
    return {
      price: selectedStock.price,
      previousClose: selectedStock.price - selectedStock.change,
      volume: selectedStock.volume,
      marketCap: selectedStock.marketCap,
      historical: histData,
    };
  }, [selectedStock, histData]);

  const analyses = useMemo(() => {
    return withIcons(analyzeStock(searchSymbol.toUpperCase(), data));
  }, [data, searchSymbol]);

  const sortedAnalyses = useMemo(() => {
    return [...analyses].sort((a, b) => {
      if (sortBy === 'confidence') return b.confidence - a.confidence;
      const order = { BUY: 0, HOLD: 1, WATCH: 2, SELL: 3, AVOID: 4 };
      return (order[a.verdict] ?? 5) - (order[b.verdict] ?? 5);
    });
  }, [analyses, sortBy]);

  const buyCount = analyses.filter(a => a.verdict === 'BUY').length;
  const holdCount = analyses.filter(a => a.verdict === 'HOLD').length;
  const sellCount = analyses.filter(a => a.verdict === 'SELL' || a.verdict === 'AVOID').length;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const upper = inputSymbol.toUpperCase();
    if (!upper || analyzing || isLoading) return;
    setAnalyzing(true);
    setProgress(0);
    setAnalyzedSymbol(upper);
    const found = popularStocks.find(s => s.symbol === upper);
    setSelectedStock(found ?? { symbol: upper, name: upper, sector: 'Unknown', price: 0, change: 0, changePercent: 0, volume: 0, marketCap: '0', pe: 0, week52High: 0, week52Low: 0 });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <User className="h-8 w-8 text-primary" />
            Trading Masters
          </h1>
          <p className="text-muted-foreground mt-2">
            Ask 12 legendary investors and traders to analyze any stock. Each master applies their unique methodology.
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-3 mb-6">
          <Input
            value={inputSymbol}
            onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
            placeholder="Enter stock symbol (e.g. AAPL, TSLA, NVDA)"
            className="max-w-xs font-mono text-lg"
          />
          <Button type="submit" disabled={analyzing || isLoading}>
            <Search className="h-4 w-4 mr-2" />
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </Button>
        </form>

        {/* Progress Bar */}
        {analyzing && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                12 masters analyzing <span className="font-mono font-bold text-foreground">{analyzedSymbol}</span>...
              </span>
              <span className="font-mono text-muted-foreground">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Summary */}
        {analyses.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card className="bg-success/10 border-success/20">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-success">{buyCount}</div>
                <div className="text-sm text-muted-foreground">BUY signals</div>
              </CardContent>
            </Card>
            <Card className="bg-warning/10 border-warning/20">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-warning">{holdCount}</div>
                <div className="text-sm text-muted-foreground">HOLD signals</div>
              </CardContent>
            </Card>
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold text-destructive">{sellCount}</div>
                <div className="text-sm text-muted-foreground">SELL / AVOID signals</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/50 border-border">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold">{searchSymbol}</div>
                <div className="text-sm text-muted-foreground">${data?.price?.toFixed(2) ?? '...'}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sort Controls */}
        {analyses.length > 0 && (
          <div className="flex gap-2 mb-4">
            <Button variant={sortBy === 'confidence' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('confidence')}>
              Sort by Confidence
            </Button>
            <Button variant={sortBy === 'verdict' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('verdict')}>
              Sort by Verdict
            </Button>
          </div>
        )}

        {/* Masters Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedAnalyses.map((master) => (
            <Card key={master.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      {master.icon}
                    </div>
                    <div>
                      <CardTitle className="text-base">{master.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{master.title}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`${verdictColor(master.verdict)} font-bold`}>
                      {master.verdict}
                    </Badge>
                    <span className={`text-sm font-mono font-bold ${confidenceColor(master.confidence)}`}>
                      {master.confidence}%
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground italic mt-2">"{master.philosophy}"</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2">
                  {master.metrics.map((m, i) => (
                    <div key={i} className="text-center p-2 rounded bg-muted/50">
                      <div className={`text-xs font-mono font-bold ${m.good ? 'text-success' : 'text-destructive'}`}>
                        {m.value}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* Strengths */}
                {master.strengths.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-success mb-1">Strengths</div>
                    {master.strengths.map((s, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex items-start gap-1 mb-0.5">
                        <CheckCircle className="h-3 w-3 text-success mt-0.5 shrink-0" />
                        {s}
                      </div>
                    ))}
                  </div>
                )}

                {/* Risks */}
                {master.risks.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-destructive mb-1">Risks</div>
                    {master.risks.map((r, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex items-start gap-1 mb-0.5">
                        <AlertTriangle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                        {r}
                      </div>
                    ))}
                  </div>
                )}

                {/* Advice */}
                <div className="p-3 rounded-lg bg-muted/30 border border-border">
                  <div className="text-xs font-semibold mb-1">Verdict</div>
                  <p className="text-sm text-muted-foreground">{master.specificAdvice}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="mt-8 p-4 rounded-lg bg-muted/30 border border-border text-center">
          <p className="text-xs text-muted-foreground">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            Education only. Not financial advice. Past performance does not guarantee future results.
            Each master's analysis is a simplified approximation of their methodology based on price and volume data.
          </p>
        </div>
      </div>
    </div>
  );
}
