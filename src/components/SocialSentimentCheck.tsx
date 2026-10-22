import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  fetchSentiment,
  toneOf,
  type SourceResult,
  type GroupScore,
  type KeyQuote,
  type Divergence,
  type SentimentTone,
} from '@/lib/sentimentAnalysis';
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
  Newspaper,
  Flame,
  Users,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SocialSentimentCheckProps {
  symbol: string;
  companyName?: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  changePercent?: number;
}

const TONE_STYLE: Record<SentimentTone, string> = {
  bullish: 'text-green-400 bg-green-500/10 border-green-500/30',
  bearish: 'text-red-400 bg-red-500/10 border-red-500/30',
  neutral: 'text-muted-foreground bg-muted/50 border-border',
};

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

function divergenceMessage(divergence: Divergence) {
  if (divergence === 'retail-more-bullish') {
    return {
      title: 'Crowd ahead of the news',
      detail: 'retail is more bullish than financial headlines',
      className: 'text-green-400/90',
    };
  }
  if (divergence === 'retail-more-bearish') {
    return {
      title: 'Crowd more cautious than the news',
      detail: 'retail is more bearish than financial headlines',
      className: 'text-red-400/90',
    };
  }
  if (divergence === 'aligned') {
    return {
      title: 'Crowd and news aligned',
      detail: 'retail and financial headlines point the same way',
      className: 'text-muted-foreground',
    };
  }
  return null;
}

function priceContext(sentiment: SentimentTone, changePercent?: number): string | null {
  if (typeof changePercent !== 'number' || !Number.isFinite(changePercent)) return null;
  const move = `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
  if (sentiment === 'bullish' && changePercent < -0.5) return `Crowd is buying a ${move} dip today.`;
  if (sentiment === 'bearish' && changePercent > 0.5) return `Crowd is fading a ${move} bounce today.`;
  if (sentiment === 'neutral') return `Price is ${move} today; no directional crowd conviction.`;
  return `Crowd mood lines up with today's ${move} move.`;
}

export function SocialSentimentCheck({ symbol, companyName, action, changePercent }: SocialSentimentCheckProps) {
  const { t } = useLanguage();
  const [showSources, setShowSources] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['social-sentiment', symbol, companyName],
    queryFn: () => fetchSentiment(symbol, companyName),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const sentimentIcon = data?.sentiment === 'bullish'
    ? <TrendingUp className="h-4 w-4" />
    : data?.sentiment === 'bearish'
      ? <TrendingDown className="h-4 w-4" />
      : <Minus className="h-4 w-4" />;

  const sentimentColor = TONE_STYLE[data?.sentiment ?? 'neutral'];

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

  const divergenceNote = data ? divergenceMessage(data.divergence) : null;
  const priceNote = data ? priceContext(data.sentiment, changePercent) : null;
  const directionalSources = data ? data.sources.filter(s => s.kind !== 'attention') : [];
  const agreeingSources = data
    ? directionalSources.filter(s => toneOf(s.score) === data.sentiment).length
    : 0;

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

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Confidence</span>
                <span>{data.confidence}% · {agreeingSources}/{directionalSources.length} sources agree</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full transition-all", confidenceColor)}
                  style={{ width: `${data.confidence}%` }}
                />
              </div>
            </div>

            <p className="text-sm leading-relaxed">{data.briefSummary}</p>

            {(data.retail || data.news) && (
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Crowd vs financial news
                </p>
                {data.retail && <GroupBar label="Retail / social" group={data.retail} />}
                {data.news && <GroupBar label="Financial news" group={data.news} />}
                {divergenceNote && (
                  <p className={cn("text-[11px]", divergenceNote.className)}>
                    <span className="font-medium">{divergenceNote.title}</span> — {divergenceNote.detail}.
                  </p>
                )}
              </div>
            )}

            {data.attention && (
              <div className="flex items-start gap-2 text-xs">
                <Flame
                  className={cn(
                    "h-3.5 w-3.5 mt-0.5",
                    data.attention.trend === 'rising'
                      ? 'text-orange-400'
                      : data.attention.trend === 'fading'
                        ? 'text-blue-400'
                        : 'text-muted-foreground',
                  )}
                />
                <span>
                  <span className="font-medium">{data.attention.label}</span>{' '}
                  <span className="text-muted-foreground">{data.attention.detail}</span>
                </span>
              </div>
            )}

            {priceNote && (
              <p className="text-xs text-muted-foreground">Price context: {priceNote}</p>
            )}

            {data.keyQuotes.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <MessageCircle className="h-3.5 w-3.5 text-primary" />
                  What people are saying
                </p>
                {data.keyQuotes.map((quote, i) => (
                  <QuoteRow key={i} quote={quote} />
                ))}
              </div>
            )}

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
                {data.unavailableSources.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                    No data: {data.unavailableSources.join(', ')}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last checked: {new Date(data.checkedAt).toLocaleTimeString()}
            </div>

            <p className="text-[10px] text-muted-foreground/60 italic">
              Quotes are real public posts and headlines, scored by keyword and StockTwits self-labels. Not financial advice.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GroupBar({ label, group }: { label: string; group: GroupScore }) {
  const tone = toneOf(group.score);
  const score = Math.max(-100, Math.min(100, group.score * 100));
  const color = tone === 'bullish'
    ? 'bg-green-500'
    : tone === 'bearish'
      ? 'bg-red-500'
      : 'bg-muted-foreground/50';

  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">
          {label} <span className="opacity-60">({group.items} items · {group.sources} src)</span>
        </span>
        <span className={cn('font-mono', tone === 'bullish' ? 'text-green-400' : tone === 'bearish' ? 'text-red-400' : 'text-muted-foreground')}>
          {score > 0 ? '+' : ''}{score.toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full rounded-full', color)}
          style={{ width: `${score === 0 ? 0 : Math.max(3, Math.abs(score))}%` }}
        />
      </div>
    </div>
  );
}

function QuoteRow({ quote }: { quote: KeyQuote }) {
  const toneStyle = TONE_STYLE[quote.tone];
  const posted = timeAgo(quote.publishedAt);

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{quote.source}</span>
        {posted && <span>· {posted}</span>}
        {quote.label && (
          <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', toneStyle)}>{quote.label}</span>
        )}
        <span className={cn('ml-auto text-[10px] font-medium uppercase tracking-wide', toneStyle.split(' ')[0])}>
          {quote.tone}
        </span>
        {quote.url && <ExternalLink className="h-3 w-3" />}
      </div>
      <p className="mt-1 text-sm leading-snug">{quote.text}</p>
    </>
  );

  const className = 'block rounded-lg border border-border/50 bg-muted/20 px-3 py-2 transition-colors';

  return quote.url ? (
    <a href={quote.url} target="_blank" rel="noopener noreferrer" className={cn(className, 'hover:bg-muted/40')}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function SourceCard({ source }: { source: SourceResult }) {
  const icon = source.kind === 'social'
    ? <MessageCircle className="h-3 w-3" />
    : source.kind === 'news'
      ? <Newspaper className="h-3 w-3" />
      : <Flame className="h-3 w-3" />;

  const tone = toneOf(source.score);
  const scoreColor = tone === 'bullish'
    ? 'text-green-400'
    : tone === 'bearish'
      ? 'text-red-400'
      : 'text-muted-foreground';

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-xs font-medium">{source.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">({source.count} items)</span>
        </div>
        <span className={cn("shrink-0 text-xs font-mono", scoreColor)}>
          {source.score > 0 ? '+' : ''}{(source.score * 100).toFixed(0)}%
        </span>
      </div>
      {source.detail && (
        <p className="mt-1 text-[11px] text-muted-foreground">{source.detail}</p>
      )}
      {source.items && source.items.length > 0 && (
        <div className="mt-1.5 space-y-1 border-t border-border/40 pt-1.5">
          {source.items.slice(0, 3).map((item, i) => (
            item.url ? (
              <a
                key={i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                title={item.text}
                className="block truncate text-[11px] text-muted-foreground hover:text-foreground"
              >
                {item.text}
              </a>
            ) : (
              <p key={i} title={item.text} className="truncate text-[11px] text-muted-foreground">
                {item.text}
              </p>
            )
          ))}
        </div>
      )}
    </div>
  );
}
