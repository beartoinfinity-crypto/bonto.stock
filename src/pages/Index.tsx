import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/lib/i18n';
import { Header } from '@/components/Header';
import { StockSearch } from '@/components/StockSearch';
import { StockMetrics } from '@/components/StockMetrics';
import { PriceChart } from '@/components/PriceChart';
import { ChartAnalyst } from '@/components/ChartAnalyst';
import { TechnicalIndicators } from '@/components/TechnicalIndicators';
import { MultiTimeframeRSI } from '@/components/MultiTimeframeRSI';
import { SignalPanel } from '@/components/SignalPanel';
import { ForecastSimulator } from '@/components/ForecastSimulator';
import { OptionsWheel } from '@/components/OptionsWheel';

import { PutCallRatio } from '@/components/PutCallRatio';
import { TodayActionPlan } from '@/components/TodayActionPlan';
import { SentimentMonitor } from '@/components/SentimentMonitor';
import { LiquidityMonitor } from '@/components/LiquidityMonitor';
import { SocialSentimentCheck } from '@/components/SocialSentimentCheck';
import { BackToTop } from '@/components/BackToTop';
import { useStockData } from '@/hooks/useStockData';
import { useAlerts } from '@/hooks/useAlerts';
import { analyzeMarketConditions } from '@/lib/strategyRecommendation';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Wifi, WifiOff, Info, X } from 'lucide-react';
import { popularStocks } from '@/lib/stockData';

const Index = () => {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const symbolParam = searchParams.get('symbol');
  const [showUnknownAlert, setShowUnknownAlert] = useState(true);
  
  // Strip exchange prefix (e.g. "NASDAQ:AAPL" -> "AAPL") from query
  const cleanSymbol = symbolParam ? symbolParam.split(':').pop()!.toUpperCase() : null;
  const isUnknownSymbol = cleanSymbol ? !popularStocks.find(s => s.symbol.toUpperCase() === cleanSymbol) : false;
  const initialStock = cleanSymbol
    ? popularStocks.find(s => s.symbol.toUpperCase() === cleanSymbol) || { ...popularStocks[0], symbol: cleanSymbol, name: cleanSymbol }
    : popularStocks[0];

  const {
    selectedStock,
    historicalData,
    signals,
    isLoading,
    isRealData,
    error,
    lastUpdated,
    setSelectedStock,
    refetch,
  } = useStockData(initialStock);

  const {
    alerts,
    config: alertConfig,
    unreadCount,
    dismissAlert,
    clearAllAlerts,
    toggleRule,
    updateConfig,
    checkMarketConditions,
    checkStrategySignals,
  } = useAlerts();

  // Check for alerts when data changes
  useEffect(() => {
    if (historicalData.length >= 100 && selectedStock.symbol) {
      try {
        const conditions = analyzeMarketConditions(historicalData);
        checkMarketConditions(conditions, selectedStock.symbol);
      } catch (e) {
        // Not enough data for analysis
      }
    }
  }, [historicalData, selectedStock.symbol, checkMarketConditions]);

  useEffect(() => {
    if (signals.length > 0 && selectedStock.symbol) {
      checkStrategySignals(signals, selectedStock.symbol);
    }
  }, [signals, selectedStock.symbol, checkStrategySignals]);

  const socialAction = useMemo(() => {
    if (historicalData.length < 100) return 'HOLD';
    const cond = analyzeMarketConditions(historicalData);
    const regime = cond.regime;
    if (regime === 'uptrend' || regime === 'strong_uptrend') return 'BUY';
    if (regime === 'downtrend' || regime === 'strong_downtrend') return 'SELL';
    return 'HOLD';
  }, [historicalData]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        alerts={alerts}
        alertConfig={alertConfig}
        unreadCount={unreadCount}
        lastUpdated={lastUpdated}
        onDismissAlert={dismissAlert}
        onClearAllAlerts={clearAllAlerts}
        onToggleAlertRule={toggleRule}
        onUpdateAlertConfig={updateConfig}
      />

      <main className="container mx-auto px-4 py-6">
        {/* Search Bar */}
        <div className="mb-6 flex items-center gap-4">
          <div className="max-w-md flex-1">
            <StockSearch
              selectedStock={selectedStock}
              onSelectStock={setSelectedStock}
            />
          </div>
          <Badge 
            variant={isRealData ? "default" : "secondary"} 
            className="flex items-center gap-1.5"
          >
            {isRealData ? (
              <>
                <Wifi className="h-3 w-3" />
                {t('liveData')}
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                {t('simulated')}
              </>
            )}
          </Badge>
          {error && (
            <Badge variant="destructive" className="flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              {error}
            </Badge>
          )}
        </div>

        {/* Unknown Symbol Fallback Alert */}
        {isUnknownSymbol && showUnknownAlert && (
          <Alert className="mb-6 relative border-amber-500/30 bg-amber-500/10 text-amber-200">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertTitle className="text-amber-100">{t('unknownSymbolTitle')}</AlertTitle>
            <AlertDescription className="text-amber-200/90">
              {t('unknownSymbolMsg').replace('{symbol}', cleanSymbol || '')}
            </AlertDescription>
            <button
              onClick={() => setShowUnknownAlert(false)}
              className="absolute right-3 top-3 text-amber-300/70 hover:text-amber-100 transition-colors"
              aria-label={t('unknownSymbolDismiss')}
            >
              <X className="h-4 w-4" />
            </button>
          </Alert>
        )}

        {isLoading ? (
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-8 space-y-6">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
            <div className="col-span-12 lg:col-span-4 space-y-6">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left Column - Main Charts */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              {/* Stock Metrics */}
              <div className="animate-fade-in">
                <StockMetrics stock={selectedStock} historicalData={historicalData} />
              </div>

              {/* Price Chart */}
              <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
                <PriceChart data={historicalData} symbol={selectedStock.symbol} lastUpdated={lastUpdated} onRefresh={refetch} />
              </div>

              {/* Analyst Commentary */}
              <div className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
                <ChartAnalyst data={historicalData} symbol={selectedStock.symbol} />
              </div>

              {/* Technical Indicators */}
              <div className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
                <TechnicalIndicators data={historicalData} />
              </div>

              {/* Multi-Timeframe RSI */}
              <div className="animate-fade-in" style={{ animationDelay: '0.25s' }}>
                <MultiTimeframeRSI data={historicalData} />
              </div>

              {/* Forecast Simulator */}
              <div className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
                <ForecastSimulator data={historicalData} symbol={selectedStock.symbol} />
              </div>

              {/* Options Wheel Analysis */}
              <div className="animate-fade-in" style={{ animationDelay: '0.32s' }}>
                <OptionsWheel data={historicalData} symbol={selectedStock.symbol} />
              </div>
            </div>

            {/* Right Column - Signals & Strategy */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              {/* Today's Action Plan */}
              <div className="animate-fade-in" style={{ animationDelay: '0.12s' }}>
                <TodayActionPlan data={historicalData} signals={signals} symbol={selectedStock.symbol} currentPrice={selectedStock.price} />
              </div>

              {/* Social Sentiment Cross-Check */}
              <div className="animate-fade-in" style={{ animationDelay: '0.13s' }}>
                <SocialSentimentCheck
                  symbol={selectedStock.symbol}
                  action={socialAction}
                />
              </div>

              {/* Sentiment Monitor */}
              <div className="animate-fade-in" style={{ animationDelay: '0.14s' }}>
                <SentimentMonitor data={historicalData} />
              </div>

              {/* Liquidity Monitor */}
              <div className="animate-fade-in" style={{ animationDelay: '0.16s' }}>
                <LiquidityMonitor data={historicalData} />
              </div>

              {/* Signal Panel */}
              <div className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
                <SignalPanel signals={signals} />
              </div>

              {/* Put/Call Ratio */}
              <div className="animate-fade-in" style={{ animationDelay: '0.18s' }}>
                <PutCallRatio data={historicalData} symbol={selectedStock.symbol} />
              </div>
            </div>
          </div>
        )}



        {/* Footer */}
        <footer className="mt-12 py-6 border-t border-border">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>{t('footerCopyright')}</p>
            <p>
              {isRealData ? t('footerDataReal') : t('footerDataSim')}
            </p>
          </div>
        </footer>
      </main>
      <BackToTop />
    </div>
  );
};

export default Index;
