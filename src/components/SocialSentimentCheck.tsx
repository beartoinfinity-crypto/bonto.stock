import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSentiment, type SourceResult } from '@/lib/sentimentAnalysis';
import { useLanguage } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Newspaper,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SocialSentimentCheckProps {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
}

export function SocialSentimentCheck({ symbol, action }: SocialSentimentCheckProps) {
  const { t } = useLanguage();
  const [showSources, setShowSources] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['social-sentiment', symbol],
    queryFn: () => fetchSentiment(symbol),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const sentimentIcon = data?.sentiment === 'bullish'
    ? <TrendingUp className="h-4 w-4" />
    : data?.sentiment === 'bearish'
      ? <TrendingDown className="h-4 w-4" />
      : <Minus className="h-4 w-4" />;

  const sentimentColor = data?.sentiment === 'bullish'
    ? 'text-green-400 bg-green-500/10 border-green-500/30'
    : data?.sentiment === 'bearish'
      ? 'text-red-400 bg-red-500/10 border-red-500/30'
      : 'text-muted-foreground bg-muted/50 border-border';

  // Determine if sentiment confirms or diverges from the recommended action
  const confirmation = data
    ? (data.sentiment === 'bullish' && action === 'BUY') || (data.sentiment === 'bearish' && action === 'SELL')
      ? 'confirmed'
      : (data.sentiment === 'bullish' && action === 'SELL') || (data.sentiment === 'bearish' && action === 'BUY')
        ? 'divergence'
        : 'neutral'
    : 'neutral';

  const confirmIcon = confirmation === 'confirmed'
    ? <TrendingUp className="h-3.5 w-3.5" />
    : confirmation === 'divergence'
      ? <TrendingDown className="h-3.5 w-3.5" />
      : <Minus className="h-3.5 w-3.5" />;

  const confirmBadge = confirmation === 'confirmed'
    ? { label: `${action} confirmed by sentiment`, className: 'bg-green-500/10 text-green-400 border-green-500/30' }
    : confirmation === 'divergence'
      ? { label: `Sentiment diverges from ${action}`, className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' }
      : { label: 'Sentiment neutral', className: 'bg-muted/50 text-muted-foreground border-border' };

  const confidenceColor = (data?.confidence ?? 0) >= 70
    ? 'bg-green-500'
    : (data?.confidence ?? 0) >= 40
      ? 'bg-yellow-500'
      : 'bg-red-500';

  return (
    <Card className="card-glow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            {t('socialSentimentTitle')}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <div className="text-sm text-destructive flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Failed to fetch sentiment data. Please try again.
          </div>
        ) : data ? (
          <>
            {/* Sentiment + Confirmation badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn("flex items-center gap-1.5 border", sentimentColor)}>
                {sentimentIcon}
                {data.sentiment === 'bullish' ? 'Bullish' : data.sentiment === 'bearish' ? 'Bearish' : 'Neutral'}
              </Badge>
              <Badge className={cn("flex items-center gap-1.5 border text-xs", confirmBadge.className)}>
                {confirmIcon}
                {confirmBadge.label}
              </Badge>
            </div>

            {/* Confidence bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Confidence</span>
                <span>{data.confidence}%</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full transition-all", confidenceColor)}
                  style={{ width: `${data.confidence}%` }}
                />
              </div>
            </div>

            {/* Brief Summary */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-3">
              {data.briefSummary.split('\n\n').map((para, i) => (
                <p key={i} className="text-sm leading-relaxed">{para}</p>
              ))}
            </div>

            {/* Per-source breakdown */}
            {data.sources.length > 0 && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowSources(!showSources)}
                >
                  {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Sources ({data.sources.length})
                </button>
                {showSources && (
                  <div className="mt-2 space-y-2">
                    {data.sources.map((src, i) => (
                      <SourceCard key={i} source={src} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Checked at */}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last checked: {new Date(data.checkedAt).toLocaleTimeString()}
            </div>

            <p className="text-[10px] text-muted-foreground/60 italic">
              Sentiment is derived from keyword analysis of public social media and news feeds. Not financial advice.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SourceCard({ source }: { source: SourceResult }) {
  const icon = source.name.includes('Reddit') || source.name.includes('ApeWisdom')
    ? <MessageCircle className="h-3 w-3" />
    : source.name === 'Google News' || source.name === 'MarketWatch' || source.name === 'CNBC'
      ? <Newspaper className="h-3 w-3" />
      : source.name === 'StockTwits' || source.name === 'SocialTickers'
        ? <TrendingUp className="h-3 w-3" />
        : source.name === 'Finnhub' || source.name === 'Google Trends'
          ? <TrendingUp className="h-3 w-3" />
          : <Globe className="h-3 w-3" />;

  const scoreColor = source.score > 0.08
    ? 'text-green-400'
    : source.score < -0.08
      ? 'text-red-400'
      : 'text-muted-foreground';

  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium">{source.name}</span>
        <span className="text-xs text-muted-foreground">({source.count} items)</span>
      </div>
      <span className={cn("text-xs font-mono", scoreColor)}>
        {source.score > 0 ? '+' : ''}{(source.score * 100).toFixed(0)}%
      </span>
    </div>
  );
}
