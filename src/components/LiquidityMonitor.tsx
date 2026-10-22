import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, Droplets, Lightbulb, ShieldAlert, Zap } from 'lucide-react';
import { StockData } from '@/lib/stockData';
import { analyzeMarketConditions } from '@/lib/strategyRecommendation';
import { calculateLiquidityConditions, LiquidityRating } from '@/lib/liquidityMonitor';
import { useLanguage, TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface LiquidityMonitorProps {
  data: StockData[];
}

const ratingConfig: Record<LiquidityRating, { text: string; dot: string; icon: React.ReactNode }> = {
  abundant: { text: 'text-green-500', dot: 'bg-green-500', icon: <CheckCircle className="h-5 w-5" /> },
  normal: { text: 'text-yellow-500', dot: 'bg-yellow-500', icon: <Droplets className="h-5 w-5" /> },
  tightening: { text: 'text-orange-500', dot: 'bg-orange-500', icon: <AlertTriangle className="h-5 w-5" /> },
  critical: { text: 'text-red-500', dot: 'bg-red-500', icon: <ShieldAlert className="h-5 w-5" /> },
};

const ratingI18n: Record<LiquidityRating, TranslationKey> = {
  abundant: 'abundant',
  normal: 'normal',
  tightening: 'tightening',
  critical: 'critical',
};

const severityIcon = (severity: 'normal' | 'warning' | 'critical') => {
  if (severity === 'critical') return <Zap className="h-4 w-4 shrink-0 text-red-500" />;
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />;
  return <CheckCircle className="h-4 w-4 shrink-0 text-green-500/70" />;
};

const severityTextColor = (severity: 'normal' | 'warning' | 'critical') => {
  if (severity === 'critical') return 'text-red-500';
  if (severity === 'warning') return 'text-orange-500';
  return 'text-foreground';
};

export function LiquidityMonitor({ data }: LiquidityMonitorProps) {
  const { t } = useLanguage();

  const result = useMemo(() => {
    if (data.length < 100) return null;
    try {
      const condition = analyzeMarketConditions(data);
      return calculateLiquidityConditions(data, condition);
    } catch { return null; }
  }, [data]);

  if (!result) return null;

  const cfg = ratingConfig[result.rating];
  const indicators = [...result.indicators].sort((a, b) => Number(b.isWarning) - Number(a.isWarning));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Droplets className="h-5 w-5 text-primary" />
          {t('liquidityConditions')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className={cn('flex items-center gap-2', cfg.text)}>
                {cfg.icon}
                <span className="text-2xl font-bold leading-none">{t(ratingI18n[result.rating])}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className={cn('font-semibold', cfg.text)}>{result.warningCount}</span> of 4 indicators flagged
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('liquidityScore')}</p>
              <p className={cn('text-2xl font-bold tabular-nums leading-none', cfg.text)}>
                {result.liquidityScore.toFixed(0)}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={cn('h-1.5 flex-1 rounded-full', i < result.warningCount ? cfg.dot : 'bg-border')}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Low stress</span>
              <span>High stress</span>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md bg-background/70 px-2.5 py-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
            <p className="text-sm font-medium leading-snug">{result.actionAdvice}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('liquidityIndicators')}</span>
            <span className="text-xs text-muted-foreground">{result.warningCount}/4 flagged</span>
          </div>

          {indicators.map((ind) => (
            <div
              key={ind.name}
              className={cn(
                'rounded-md border px-3 py-2',
                ind.isWarning
                  ? ind.severity === 'critical' ? 'border-red-500/40 bg-red-500/5' : 'border-orange-500/30 bg-orange-500/5'
                  : 'border-border bg-muted/20',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {severityIcon(ind.severity)}
                  <span className="truncate text-sm font-medium">{ind.name}</span>
                  {ind.isWarning && (
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        ind.severity === 'critical' ? 'bg-red-500/15 text-red-500' : 'bg-orange-500/15 text-orange-500',
                      )}
                    >
                      Flag
                    </span>
                  )}
                </div>
                <span className={cn('shrink-0 text-sm font-bold tabular-nums', severityTextColor(ind.severity))}>
                  {ind.displayValue}
                </span>
              </div>
              <p
                className={cn(
                  'mt-1 pl-6 text-xs leading-relaxed text-muted-foreground',
                  ind.isWarning ? 'line-clamp-2' : 'truncate',
                )}
                title={ind.isWarning ? ind.hint : ind.description}
              >
                {ind.isWarning ? ind.hint : ind.description}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground italic">
          * {t('liquidityDisclaimer')}
        </p>
      </CardContent>
    </Card>
  );
}
