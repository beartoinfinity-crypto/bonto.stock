import { useMemo, useState } from 'react';
import { 
  Lightbulb, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Target,
  Shield,
  Zap,
  BarChart3,
  Activity,
  Gauge
} from 'lucide-react';
import { StockData } from '@/lib/stockData';
import { getStrategyRecommendations, StrategyRecommendation, MarketCondition } from '@/lib/strategyRecommendation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/lib/i18n';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface StrategyRecommendationProps {
  data: StockData[];
}

const regimeIcons = {
  strong_uptrend: <TrendingUp className="h-4 w-4 text-bullish" />,
  uptrend: <TrendingUp className="h-4 w-4 text-bullish" />,
  sideways: <Minus className="h-4 w-4 text-warning" />,
  downtrend: <TrendingDown className="h-4 w-4 text-bearish" />,
  strong_downtrend: <TrendingDown className="h-4 w-4 text-bearish" />,
};

const regimeLabels = {
  strong_uptrend: 'Strong Uptrend',
  uptrend: 'Uptrend',
  sideways: 'Sideways',
  downtrend: 'Downtrend',
  strong_downtrend: 'Strong Downtrend',
};

const volatilityColors = {
  low: 'text-bullish',
  medium: 'text-neutral',
  high: 'text-warning',
  extreme: 'text-bearish',
};

const suitabilityColors = {
  excellent: 'bg-bullish/20 text-bullish border-bullish/30',
  good: 'bg-primary/20 text-primary border-primary/30',
  moderate: 'bg-warning/20 text-warning border-warning/30',
  poor: 'bg-bearish/20 text-bearish border-bearish/30',
};

const riskColors = {
  low: 'text-bullish',
  medium: 'text-warning',
  high: 'text-bearish',
};

function MarketConditionCard({ condition }: { condition: MarketCondition }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-secondary/30 rounded-lg">
      <TooltipProvider>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            Trend
          </div>
          <div className="flex items-center gap-1.5">
            {regimeIcons[condition.regime]}
            <span className="font-medium text-sm">{regimeLabels[condition.regime]}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Score: {condition.regimeScore > 0 ? '+' : ''}{condition.regimeScore}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Volatility
          </div>
          <div className={cn("font-medium text-sm capitalize", volatilityColors[condition.volatility])}>
            {condition.volatility}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs text-muted-foreground cursor-help">
                {condition.volatilityPercentile}th percentile
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Volatility compared to last 252 trading days</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Gauge className="h-3 w-3" />
            RSI Momentum
          </div>
          <div className={cn(
            "font-medium text-sm capitalize",
            condition.momentum === 'overbought' ? 'text-bearish' :
            condition.momentum === 'oversold' ? 'text-bullish' :
            condition.momentum === 'bullish' ? 'text-bullish' :
            condition.momentum === 'bearish' ? 'text-bearish' :
            'text-muted-foreground'
          )}>
            {condition.momentum}
          </div>
          <div className="text-xs text-muted-foreground">
            RSI: {condition.rsiValue}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Target className="h-3 w-3" />
            Trend Strength
          </div>
          <div className="font-medium text-sm">
            {condition.trendStrength}%
          </div>
          <Progress value={condition.trendStrength} className="h-1.5" />
        </div>
      </TooltipProvider>
    </div>
  );
}

function StrategyCard({ 
  recommendation, 
  isTopPick,
  isExpanded,
  onToggle 
}: { 
  recommendation: StrategyRecommendation;
  isTopPick: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className={cn(
        "border rounded-lg transition-all",
        isTopPick ? "border-primary/50 bg-primary/5" : "border-border bg-card/50",
        isExpanded && "ring-1 ring-primary/20"
      )}>
        <CollapsibleTrigger asChild>
          <button className="w-full p-4 text-left hover:bg-secondary/30 transition-colors rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isTopPick && (
                  <div className="p-1.5 bg-primary/20 rounded-lg">
                    <Lightbulb className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{recommendation.strategy}</span>
                    {isTopPick && (
                      <Badge variant="default" className="text-xs">
                        Top Pick
                      </Badge>
                    )}
                    <Badge 
                      variant="outline" 
                      className={cn("text-xs", suitabilityColors[recommendation.suitability])}
                    >
                      {recommendation.suitability}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      Confidence: {recommendation.confidence}%
                    </span>
                    <span className={cn("flex items-center gap-1", riskColors[recommendation.riskLevel])}>
                      <Shield className="h-3 w-3" />
                      Risk: {recommendation.riskLevel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24">
                  <Progress 
                    value={recommendation.confidence} 
                    className={cn(
                      "h-2",
                      recommendation.confidence >= 70 ? "[&>div]:bg-bullish" :
                      recommendation.confidence >= 50 ? "[&>div]:bg-primary" :
                      "[&>div]:bg-warning"
                    )}
                  />
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            <div className="h-px bg-border" />
            
            <div>
              <h5 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4 text-primary" />
                Analysis
              </h5>
              <ul className="space-y-1">
                {recommendation.reasoning.map((reason, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h5 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Target className="h-4 w-4 text-bullish" />
                Action Items
              </h5>
              <ul className="space-y-1">
                {recommendation.actionItems.map((action, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-bullish mt-1 font-mono text-xs">{i + 1}.</span>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function StrategyRecommendationPanel({ data }: StrategyRecommendationProps) {
  const { t } = useLanguage();
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);

  const result = useMemo(() => {
    if (data.length < 100) return null;
    try {
      return getStrategyRecommendations(data);
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
      return null;
    }
  }, [data]);

  if (!result) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 card-glow">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-5 w-5" />
          <span>Insufficient data for strategy recommendations (need 100+ data points)</span>
        </div>
      </div>
    );
  }

  const { marketCondition, recommendations, topPick, summary } = result;

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            {t('strategyEngine')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('strategyEngineDesc')}</p>
        </div>
        <div className="px-3 py-1.5 bg-primary/20 rounded-lg text-right">
          <div className="text-xs text-muted-foreground">{t('topPick')}</div>
          <div className="font-semibold text-primary">{topPick.strategy}</div>
        </div>
      </div>

      {/* Market Conditions Overview */}
      <div className="mb-6">
        <h4 className="text-sm font-medium mb-3 text-muted-foreground">{t('marketConditions')}</h4>
        <MarketConditionCard condition={marketCondition} />
      </div>

      {/* Summary */}
      <div className="mb-6 p-3 bg-primary/10 border border-primary/20 rounded-lg">
        <p className="text-sm">{summary}</p>
      </div>

      {/* Strategy Recommendations */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">{t('allStrategies')}</h4>
        {recommendations.map((rec) => (
          <StrategyCard
            key={rec.strategy}
            recommendation={rec}
            isTopPick={rec.strategy === topPick.strategy}
            isExpanded={expandedStrategy === rec.strategy}
            onToggle={() => setExpandedStrategy(
              expandedStrategy === rec.strategy ? null : rec.strategy
            )}
          />
        ))}
      </div>

      <div className="mt-4 p-3 bg-secondary/30 rounded-lg flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          {t('disclaimer')}
        </p>
      </div>
    </div>
  );
}
