import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, XCircle, Clock, Database, Zap, Newspaper, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useScreenerData, ScreenerResult } from '@/hooks/useScreenerData';
import { SortField, SortDirection, RiskFilter, SignalFilter } from '@/lib/stockScreener';
import { SectorHeatmap } from '@/components/SectorHeatmap';
import { PoliticianTrades } from '@/components/PoliticianTrades';
import { AsymmetricValueScreener } from '@/components/AsymmetricValueScreener';
import { BackToTop } from '@/components/BackToTop';

import { cn } from '@/lib/utils';

const Screener = () => {
  const { results, isLoading, progress, totalStocks, refreshAll, lastUpdated, fromCache } = useScreenerData();
  
  const [sortField, setSortField] = useState<SortField>('confidence');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');

  const handleRefresh = () => {
    refreshAll(true); // Force refresh
  };

  // Get unique sectors
  const sectors = useMemo(() => {
    const sectorSet = new Set(results.map(r => r.stock.sector));
    return ['all', ...Array.from(sectorSet)];
  }, [results]);

  // Filter and sort results
  const filteredResults = useMemo(() => {
    let filtered = results.filter(r => !r.isLoading);

    // Apply risk filter
    if (riskFilter !== 'all') {
      filtered = filtered.filter(r => r.combinedSignal?.riskLevel === riskFilter);
    }

    // Apply signal quality filter
    if (signalFilter !== 'all') {
      filtered = filtered.filter(r => r.combinedSignal?.suitability === signalFilter);
    }

    // Apply sector filter
    if (sectorFilter !== 'all') {
      filtered = filtered.filter(r => r.stock.sector === sectorFilter);
    }

    // Sort results
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'symbol':
          comparison = a.stock.symbol.localeCompare(b.stock.symbol);
          break;
        case 'name':
          comparison = a.stock.name.localeCompare(b.stock.name);
          break;
        case 'sector':
          comparison = a.stock.sector.localeCompare(b.stock.sector);
          break;
        case 'confidence':
          comparison = (a.combinedSignal?.confidence ?? 0) - (b.combinedSignal?.confidence ?? 0);
          break;
        case 'risk':
          const riskOrder = { low: 1, medium: 2, high: 3 };
          const aRisk = a.combinedSignal?.riskLevel ? riskOrder[a.combinedSignal.riskLevel] : 4;
          const bRisk = b.combinedSignal?.riskLevel ? riskOrder[b.combinedSignal.riskLevel] : 4;
          comparison = aRisk - bRisk;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [results, sortField, sortDirection, riskFilter, signalFilter, sectorFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSuitabilityBadge = (suitability: string) => {
    switch (suitability) {
      case 'excellent':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Excellent</Badge>;
      case 'good':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Good</Badge>;
      case 'moderate':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Moderate</Badge>;
      case 'poor':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Poor</Badge>;
      default:
        return <Badge variant="secondary">N/A</Badge>;
    }
  };

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'low':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle className="h-3 w-3 mr-1" />Low</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><AlertCircle className="h-3 w-3 mr-1" />Medium</Badge>;
      case 'high':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="h-3 w-3 mr-1" />High</Badge>;
      default:
        return <Badge variant="secondary">N/A</Badge>;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-emerald-400';
    if (confidence >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const stats = useMemo(() => {
    const loaded = results.filter(r => !r.isLoading && r.combinedSignal);
    const excellent = loaded.filter(r => r.combinedSignal?.suitability === 'excellent').length;
    const good = loaded.filter(r => r.combinedSignal?.suitability === 'good').length;
    const lowRisk = loaded.filter(r => r.combinedSignal?.riskLevel === 'low').length;
    const avgConfidence = loaded.length > 0 
      ? loaded.reduce((acc, r) => acc + (r.combinedSignal?.confidence ?? 0), 0) / loaded.length
      : 0;

    return { excellent, good, lowRisk, avgConfidence, total: loaded.length };
  }, [results]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Stock Screener</h1>
                <p className="text-sm text-muted-foreground">Combined Signal Analysis for US Stocks</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground hidden sm:flex">
                  {fromCache ? (
                    <Database className="h-3.5 w-3.5" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  <div className="text-right">
                    <div className="font-medium">
                      {fromCache ? 'Pre-computed' : 'Live Analysis'}
                    </div>
                    <div>
                      {lastUpdated.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {' '}
                      {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )}
              <Button 
                onClick={handleRefresh} 
                disabled={isLoading}
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                Refresh All
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Sector Heatmap */}
        <SectorHeatmap />

        {/* Politician Trades */}
        <PoliticianTrades />

        {/* Loading Progress */}
        {isLoading && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <Clock className="h-5 w-5 text-muted-foreground animate-pulse" />
                <div className="flex-1">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Analyzing stocks...</span>
                    <span className="text-sm font-medium">{progress} / {totalStocks}</span>
                  </div>
                  <Progress value={totalStocks > 0 ? (progress / totalStocks) * 100 : 0} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.excellent}</p>
                  <p className="text-xs text-muted-foreground">Excellent Signals</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.good}</p>
                  <p className="text-xs text-muted-foreground">Good Signals</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <CheckCircle className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.lowRisk}</p>
                  <p className="text-xs text-muted-foreground">Low Risk</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Minus className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.avgConfidence.toFixed(0)}%</p>
                  <p className="text-xs text-muted-foreground">Avg Confidence</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Filters</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Signal Quality</label>
                <Select value={signalFilter} onValueChange={(v) => setSignalFilter(v as SignalFilter)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Signals</SelectItem>
                    <SelectItem value="excellent">Excellent</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Risk Level</label>
                <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as RiskFilter)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Risks</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Sector</label>
                <Select value={sectorFilter} onValueChange={setSectorFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sectors.map(sector => (
                      <SelectItem key={sector} value={sector}>
                        {sector === 'all' ? 'All Sectors' : sector}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardHeader>
            <CardTitle>Screening Results</CardTitle>
            <CardDescription>
              {filteredResults.length} stocks matching your criteria
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead 
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('symbol')}
                  >
                    <div className="flex items-center gap-1">
                      Symbol
                      {sortField === 'symbol' && <ArrowUpDown className="h-3 w-3" />}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      Name
                      {sortField === 'name' && <ArrowUpDown className="h-3 w-3" />}
                    </div>
                  </TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead 
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('sector')}
                  >
                    <div className="flex items-center gap-1">
                      Sector
                      {sortField === 'sector' && <ArrowUpDown className="h-3 w-3" />}
                    </div>
                  </TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Signal Quality</TableHead>
                  <TableHead 
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('confidence')}
                  >
                    <div className="flex items-center gap-1">
                      Confidence
                      {sortField === 'confidence' && <ArrowUpDown className="h-3 w-3" />}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('risk')}
                  >
                    <div className="flex items-center gap-1">
                      Risk Level
                      {sortField === 'risk' && <ArrowUpDown className="h-3 w-3" />}
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Newspaper className="h-3 w-3" />
                      News (10d)
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      Social
                    </div>
                  </TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && filteredResults.length === 0 ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredResults.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No stocks match your filter criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredResults.map((result) => {
                    // Derive a clear action label + full instructions
                    const signal = result.combinedSignal;
                    const actionItems = signal?.actionItems || [];
                    const reasoning = signal?.reasoning || [];

                    // Use explicit action field from Combined Signal
                    let actionLabel = '—';
                    let actionColor = 'text-muted-foreground';
                    if (signal) {
                      const action = signal.action || 'HOLD';
                      if (action === 'BUY') {
                        actionLabel = '🟢 BUY';
                        actionColor = 'text-emerald-400';
                      } else if (action === 'SELL') {
                        actionLabel = '🔴 SELL';
                        actionColor = 'text-red-400';
                      } else {
                        actionLabel = '🟡 HOLD';
                        actionColor = 'text-yellow-400';
                      }
                    }

                    const isPositive = (result.changePercent ?? 0) >= 0;

                    return (
                      <TableRow key={result.stock.symbol}>
                        <TableCell className="font-mono font-medium">{result.stock.symbol}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{result.stock.name}</TableCell>
                        <TableCell>
                          {result.price != null ? (
                            <div>
                              <div className="font-mono font-medium">${result.price.toFixed(2)}</div>
                              <div className={cn("text-xs", isPositive ? "text-emerald-400" : "text-red-400")}>
                                {isPositive ? '+' : ''}{result.change?.toFixed(2)} ({isPositive ? '+' : ''}{result.changePercent?.toFixed(2)}%)
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{result.stock.sector}</Badge>
                        </TableCell>
                        <TableCell className="min-w-[240px] max-w-[320px]">
                          {signal ? (
                            <div className="space-y-1">
                              <div className={cn("font-semibold text-sm", actionColor)}>{actionLabel}</div>
                              {actionItems.length > 0 && (
                                <ul className="text-xs text-muted-foreground space-y-0.5">
                                  {actionItems.slice(0, 3).map((item, idx) => (
                                    <li key={idx} className="leading-tight">• {item}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.error ? (
                            <Badge variant="destructive">Error</Badge>
                          ) : result.combinedSignal ? (
                            getSuitabilityBadge(result.combinedSignal.suitability)
                          ) : (
                            <Badge variant="secondary">N/A</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.combinedSignal ? (
                            <span className={cn("font-medium", getConfidenceColor(result.combinedSignal.confidence))}>
                              {result.combinedSignal.confidence}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.combinedSignal ? (
                            getRiskBadge(result.combinedSignal.riskLevel)
                          ) : (
                            <Badge variant="secondary">N/A</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.newsSentiment ? (
                            <div className="space-y-0.5">
                              <Badge className={cn(
                                "text-xs",
                                result.newsSentiment.overall === 'bullish' && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                                result.newsSentiment.overall === 'bearish' && "bg-red-500/15 text-red-400 border-red-500/30",
                                result.newsSentiment.overall === 'neutral' && "bg-muted text-muted-foreground border-border",
                              )}>
                                {result.newsSentiment.overall === 'bullish' && '🟢 Bull'}
                                {result.newsSentiment.overall === 'bearish' && '🔴 Bear'}
                                {result.newsSentiment.overall === 'neutral' && '⚪ Neutral'}
                              </Badge>
                              <div className="text-[10px] text-muted-foreground">
                                {result.newsSentiment.bullish}↑ {result.newsSentiment.bearish}↓ {result.newsSentiment.neutral}— ({result.newsSentiment.total})
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {result.socialSentiment ? (
                            <div className="space-y-0.5">
                              <Badge className={cn(
                                "text-xs border",
                                result.socialSentiment.sentiment === 'bullish' && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                                result.socialSentiment.sentiment === 'bearish' && "bg-red-500/15 text-red-400 border-red-500/30",
                                result.socialSentiment.sentiment === 'neutral' && "bg-muted text-muted-foreground border-border",
                              )}>
                                {result.socialSentiment.sentiment === 'bullish' && '🟢'}
                                {result.socialSentiment.sentiment === 'bearish' && '🔴'}
                                {result.socialSentiment.sentiment === 'neutral' && '⚪'}
                                {' '}{result.socialSentiment.sentiment.charAt(0).toUpperCase() + result.socialSentiment.sentiment.slice(1)}
                              </Badge>
                              <div className={cn(
                                "text-[10px]",
                                result.socialSentiment.confirmation === 'confirmed' ? "text-emerald-400" :
                                result.socialSentiment.confirmation === 'divergence' ? "text-yellow-400" :
                                "text-muted-foreground"
                              )}>
                                {result.socialSentiment.confirmation === 'confirmed' ? '✓ Confirmed' :
                                 result.socialSentiment.confirmation === 'divergence' ? '⚠ Divergence' : '— Neutral'}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link to={`/?symbol=${result.stock.symbol}`}>
                            <Button variant="ghost" size="sm">
                              Analyze
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Asymmetric Value Screener */}
        <div className="mt-6">
          <AsymmetricValueScreener />
        </div>

      </main>


      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="container mx-auto px-4 py-6">
          <p className="text-sm text-muted-foreground text-center">
            StockPulse Screener — Combined Signal analysis powered by multi-strategy consensus
          </p>
        </div>
      </footer>
      <BackToTop />
    </div>
  );
};

export default Screener;
