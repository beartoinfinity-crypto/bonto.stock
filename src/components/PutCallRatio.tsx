import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { StockData } from '@/lib/stockData';
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n';

interface PutCallRatioProps {
  data: StockData[];
  symbol: string;
}

interface PutCallData {
  ratio: number;
  putVolume: number;
  callVolume: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  historicalAvg: number;
  trend: 'rising' | 'falling' | 'stable';
}

// Generate realistic put/call ratio based on price action and volatility
function calculatePutCallRatio(data: StockData[]): PutCallData {
  if (data.length < 20) {
    return {
      ratio: 1.0,
      putVolume: 0,
      callVolume: 0,
      sentiment: 'neutral',
      historicalAvg: 1.0,
      trend: 'stable',
    };
  }

  const recent = data.slice(-20);
  const older = data.slice(-40, -20);
  
  // Calculate recent price trend
  const recentClose = recent[recent.length - 1].close;
  const startClose = recent[0].close;
  const priceChange = (recentClose - startClose) / startClose;
  
  // Calculate volatility (using high-low range)
  const avgVolatility = recent.reduce((sum, d) => sum + (d.high - d.low) / d.close, 0) / recent.length;
  
  // Calculate volume trend
  const avgVolume = recent.reduce((sum, d) => sum + d.volume, 0) / recent.length;
  
  // Base ratio around 0.7-1.3 (typical market range)
  // Higher volatility and negative price action = higher put/call ratio
  let baseRatio = 0.85;
  
  // Adjust based on price trend (negative = more puts)
  baseRatio += -priceChange * 2;
  
  // Adjust based on volatility (higher volatility = more puts for hedging)
  baseRatio += avgVolatility * 3;
  
  // Add some randomness for realism
  const noise = (Math.sin(data.length * 0.1) * 0.15);
  baseRatio += noise;
  
  // Clamp to realistic range
  const ratio = Math.max(0.4, Math.min(1.8, baseRatio));
  
  // Calculate volumes (simulated based on actual volume data)
  const totalOptionsVolume = avgVolume * 0.15; // ~15% of stock volume goes to options
  const callVolume = Math.round(totalOptionsVolume / (1 + ratio));
  const putVolume = Math.round(callVolume * ratio);
  
  // Determine sentiment
  let sentiment: 'bullish' | 'bearish' | 'neutral';
  if (ratio < 0.7) {
    sentiment = 'bullish';
  } else if (ratio > 1.0) {
    sentiment = 'bearish';
  } else {
    sentiment = 'neutral';
  }
  
  // Calculate historical average and trend
  let historicalAvg = 0.85;
  let trend: 'rising' | 'falling' | 'stable' = 'stable';
  
  if (older.length >= 10) {
    const olderClose = older[older.length - 1].close;
    const olderStart = older[0].close;
    const olderChange = (olderClose - olderStart) / olderStart;
    const olderRatio = Math.max(0.4, Math.min(1.8, 0.85 + -olderChange * 2));
    historicalAvg = olderRatio;
    
    if (ratio > historicalAvg + 0.1) {
      trend = 'rising';
    } else if (ratio < historicalAvg - 0.1) {
      trend = 'falling';
    }
  }
  
  return {
    ratio: Math.round(ratio * 100) / 100,
    putVolume,
    callVolume,
    sentiment,
    historicalAvg: Math.round(historicalAvg * 100) / 100,
    trend,
  };
}

// Format large numbers
function formatVolume(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

export function PutCallRatio({ data, symbol }: PutCallRatioProps) {
  const { t } = useLanguage();
  const pcData = useMemo(() => calculatePutCallRatio(data), [data]);
  
  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-green-500';
      case 'bearish': return 'text-red-500';
      default: return 'text-yellow-500';
    }
  };
  
  const getSentimentBg = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'bearish': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    }
  };
  
  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'rising': return <TrendingUp className="h-4 w-4 text-red-500" />;
      case 'falling': return <TrendingDown className="h-4 w-4 text-green-500" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };
  
  // Calculate progress for visual bar (0.4 to 1.8 range mapped to 0-100)
  const progressValue = ((pcData.ratio - 0.4) / 1.4) * 100;
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            {t('putCallRatio')}
          </CardTitle>
          <Badge variant="outline" className={getSentimentBg(pcData.sentiment)}>
            {pcData.sentiment === 'bullish' ? t('bullishSentiment') : pcData.sentiment === 'bearish' ? t('bearishSentiment') : t('neutralSentiment')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Ratio Display */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-3xl font-bold">{pcData.ratio.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">Current Ratio</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 justify-end">
              {getTrendIcon(pcData.trend)}
              <span className="text-sm font-medium capitalize">{pcData.trend}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('historicalAvg')}: {pcData.historicalAvg.toFixed(2)}
            </p>
          </div>
        </div>
        
        {/* Visual Ratio Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Bullish (0.4)</span>
            <span>Neutral (0.85)</span>
            <span>Bearish (1.8)</span>
          </div>
          <div className="relative">
            <Progress value={progressValue} className="h-3" />
            {/* Neutral marker */}
            <div 
              className="absolute top-0 h-3 w-0.5 bg-foreground/50"
              style={{ left: `${((0.85 - 0.4) / 1.4) * 100}%` }}
            />
          </div>
        </div>
        
        {/* Volume Breakdown */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-sm text-muted-foreground">{t('putVolume')}</span>
            </div>
            <p className="text-lg font-semibold">{formatVolume(pcData.putVolume)}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">{t('callVolume')}</span>
            </div>
            <p className="text-lg font-semibold">{formatVolume(pcData.callVolume)}</p>
          </div>
        </div>
        
        {/* Interpretation */}
        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          <p className="font-medium mb-1">Interpretation</p>
          <p className="text-muted-foreground">
            {pcData.ratio < 0.7 && (
              <>Low put/call ratio suggests <span className="text-green-500 font-medium">bullish sentiment</span>. Traders are buying more calls expecting price increases.</>
            )}
            {pcData.ratio >= 0.7 && pcData.ratio <= 1.0 && (
              <>Put/call ratio is in <span className="text-yellow-500 font-medium">neutral territory</span>. Market sentiment is balanced with no strong directional bias.</>
            )}
            {pcData.ratio > 1.0 && (
              <>High put/call ratio indicates <span className="text-red-500 font-medium">bearish sentiment</span>. More puts being bought suggests downside protection or bearish bets.</>
            )}
          </p>
        </div>
        
        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground italic">
          * Simulated data based on price action analysis. Real options data requires premium API access.
        </p>
      </CardContent>
    </Card>
  );
}
