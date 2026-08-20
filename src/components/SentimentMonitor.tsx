import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Gauge, ShieldAlert, TrendingUp, Lightbulb } from 'lucide-react';
import { StockData } from '@/lib/stockData';
import { analyzeMarketConditions } from '@/lib/strategyRecommendation';
import { calculateMarketSentiment, SentimentRating } from '@/lib/sentimentMonitor';
import { useLanguage } from '@/lib/i18n';

interface SentimentMonitorProps {
  data: StockData[];
}

const ratingConfig: Record<SentimentRating, { color: string; bg: string; icon: React.ReactNode }> = {
  extreme_greed: { color: 'text-red-500', bg: 'bg-red-500/10 text-red-500 border-red-500/20', icon: <ShieldAlert className="h-4 w-4" /> },
  greed: { color: 'text-orange-500', bg: 'bg-orange-500/10 text-orange-500 border-orange-500/20', icon: <AlertTriangle className="h-4 w-4" /> },
  neutral: { color: 'text-yellow-500', bg: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', icon: <TrendingUp className="h-4 w-4" /> },
  fear: { color: 'text-green-500', bg: 'bg-green-500/10 text-green-500 border-green-500/20', icon: <CheckCircle className="h-4 w-4" /> },
};

const ratingI18n: Record<SentimentRating, string> = {
  extreme_greed: 'extremeGreed',
  greed: 'greed',
  neutral: 'neutral',
  fear: 'fear',
};

export function SentimentMonitor({ data }: SentimentMonitorProps) {
  const { t } = useLanguage();

  const result = useMemo(() => {
    if (data.length < 100) return null;
    try {
      const condition = analyzeMarketConditions(data);
      return calculateMarketSentiment(data, condition);
    } catch { return null; }
  }, [data]);

  if (!result) return null;

  const cfg = ratingConfig[result.rating];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            {t('marketSentiment')}
          </CardTitle>
          <Badge variant="outline" className={cfg.bg}>
            {cfg.icon}
            <span className="ml-1">{t(ratingI18n[result.rating] as any)}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('fear')}</span>
            <span>{t('neutral')}</span>
            <span>{t('extremeGreed')}</span>
          </div>
          <div className="relative">
            <Progress value={result.greedScore} className="h-3" />
            <div className="absolute top-0 h-3 w-0.5 bg-foreground/50" style={{ left: '50%' }} />
          </div>
          <p className="text-center text-sm font-medium">
            {t('sentimentScore')}: <span className={cfg.color}>{result.greedScore.toFixed(0)}</span>/100
          </p>
        </div>

        <div className="space-y-2">
          {result.indicators.map((ind) => (
            <div key={ind.name} className="rounded-md border border-border px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {ind.isWarning ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" /> : <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{ind.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{ind.description}</p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className={`text-sm font-bold ${ind.isWarning ? 'text-red-500' : 'text-foreground'}`}>{ind.displayValue}</p>
                </div>
              </div>
              <div className="flex items-start gap-1.5 pl-6">
                <Lightbulb className="h-3 w-3 shrink-0 mt-0.5 text-yellow-500/70" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">{ind.hint}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{t('indicators')}: {result.warningCount}/5</span>
          </div>
          <p className="text-sm text-muted-foreground">{result.positionAdvice}</p>
        </div>

        <div className="bg-primary/5 rounded-lg border border-primary/10 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium">Signal Synthesis</span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{result.synthesis}</p>
        </div>

        <p className="text-xs text-muted-foreground italic">
          * {t('disclaimer')}
        </p>
      </CardContent>
    </Card>
  );
}
