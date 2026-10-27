import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Minus, Activity, CheckCircle2 } from 'lucide-react';
import { StockData } from '@/lib/stockData';
import { useMemo } from 'react';
import { useLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface PutCallRatioProps {
  data: StockData[];
  symbol: string;
}

interface PutCallData {
  ratio: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  historicalAvg: number;
  trend: 'rising' | 'falling' | 'stable';
}

// The published put/call ratio is not available on the free data feed. This is
// a PRICE-ACTION ESTIMATE of option-sentiment: a proxy model backed by recent
// price trend and volatility, scaled to a conventional put/call range. It does
// NOT measure actual options flow. The estimate is labeled as such in the UI
// and is shown only as a directional read, not as real options data.
function estimatePutCallRatio(data: StockData[]): PutCallData {
  if (data.length < 20) {
    return { ratio: 0.85, sentiment: 'neutral', historicalAvg: 0.85, trend: 'stable' };
  }

  const recent = data.slice(-20);
  const older = data.slice(-40, -20);

  const recentClose = recent[recent.length - 1].close;
  const startClose = recent[0].close;
  const priceChange = (recentClose - startClose) / startClose;

  const avgVolatility = recent.reduce((sum, d) => sum + (d.high - d.low) / d.close, 0) / recent.length;

  // Conventional put/call values live in ~0.6-1.3. Bias the estimate toward
  // puts when price is falling or volatility is wide (hedging demand), toward
  // calls when price is rising.
  let baseRatio = 0.85 - priceChange * 2 + avgVolatility * 3;
  const ratio = Math.max(0.4, Math.min(1.8, baseRatio));

  let sentiment: 'bullish' | 'bearish' | 'neutral';
  if (ratio < 0.7) sentiment = 'bullish';
  else if (ratio > 1.0) sentiment = 'bearish';
  else sentiment = 'neutral';

  let historicalAvg = 0.85;
  let trend: 'rising' | 'falling' | 'stable' = 'stable';
  if (older.length >= 10) {
    const olderChange = (older[older.length - 1].close - older[0].close) / older[0].close;
    historicalAvg = Math.max(0.4, Math.min(1.8, 0.85 - olderChange * 2));

    if (ratio > historicalAvg + 0.1) trend = 'rising';
    else if (ratio < historicalAvg - 0.1) trend = 'falling';
  }

  return { ratio: Math.round(ratio * 100) / 100, sentiment, historicalAvg: Math.round(historicalAvg * 100) / 100, trend };
}

const sentimentBadge: Record<PutCallData['sentiment'], { label: string; className: string }> = {
  bullish: { label: 'Call-leaning', className: 'bg-green-500/10 text-green-400 border-green-500/30' },
  bearish: { label: 'Put-leaning', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  neutral: { label: 'Balanced', className: 'bg-muted/50 text-muted-foreground border-border' },
};

const trendIcon: Record<PutCallData['trend'], { icon: typeof TrendingUp; className: string; label: string }> = {
  rising: { icon: TrendingUp, className: 'text-red-400', label: 'Rising (more puts)' },
  falling: { icon: TrendingDown, className: 'text-green-400', label: 'Falling (more calls)' },
  stable: { icon: Minus, className: 'text-muted-foreground', label: 'Stable' },
};

export function PutCallRatio({ data, symbol }: PutCallRatioProps) {
  const { t } = useLanguage();
  const pcData = useMemo(() => estimatePutCallRatio(data), [data]);

  const progressValue = Math.max(0, Math.min(100, ((pcData.ratio - 0.4) / 1.4) * 100));
  const TrendIcon = trendIcon[pcData.trend].icon;

  return (
    <Card className="card-glow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Put/Call Ratio (est.)
          </CardTitle>
          <Badge variant="outline" className={sentimentBadge[pcData.sentiment].className}>
            {sentimentBadge[pcData.sentiment].label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main ratio */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-3xl font-bold">{pcData.ratio.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">Estimated official-ratio proxy</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 justify-end">
              <TrendIcon className={cn('h-4 w-4', trendIcon[pcData.trend].className)} />
              <span className="text-sm font-medium">{trendIcon[pcData.trend].label}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('historicalAvg')}: {pcData.historicalAvg.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Ratio bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>More calls (0.4)</span>
            <span>Balanced (0.85)</span>
            <span>More puts (1.8)</span>
          </div>
          <div className="relative">
            <Progress value={progressValue} className="h-3" />
            <div className="absolute top-0 h-3 w-0.5 bg-foreground/50" style={{ left: `${((0.85 - 0.4) / 1.4) * 100}%` }} />
          </div>
        </div>

        {/* Read */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <p className="font-medium mb-1">What this estimate suggests</p>
          <p className="text-muted-foreground leading-relaxed">
            {pcData.ratio < 0.7 && (
              <>The proxy tilts toward <span className="text-green-500 font-medium">call demand</span>. In a real put/call reading that has historically been a mild bullish lean — here it mostly reflects the recent <span className="font-medium">price uptrend</span> the model is derived from.</>
            )}
            {pcData.ratio >= 0.7 && pcData.ratio <= 1.0 && (
              <>The proxy is <span className="text-yellow-500 font-medium">balanced</span>. Neither upside nor downside hedging dominates the model's read — consistent with a flat directional bias.</>
            )}
            {pcData.ratio > 1.0 && (
              <>The proxy tilts toward <span className="text-red-500 font-medium">put demand</span>. In a real put/call reading that has historically been a cautious lean — here it mostly reflects the recent <span className="font-medium">price weakness and/or wider volatility</span> the model is derived from.</>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Trend is {pcData.trend} vs the prior-period proxy ({pcData.historicalAvg.toFixed(2)}).
          </p>
        </div>

        {/* Footnote */}
        <div className="flex items-start gap-2 rounded-md bg-secondary/30 px-2.5 py-2">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground italic">
            Estimate for {symbol} derived from price action and volatility — real options flow needs a paid feed. Directional context only, not investment advice.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}