import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Newspaper, ExternalLink, Clock, TrendingUp, TrendingDown, Minus, Brain, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { NewsSentimentTrend } from './NewsSentimentTrend';
import { useLanguage } from '@/lib/i18n';
import { isEdgeFnAvailable } from '@/lib/edgeFn';

interface NewsArticle {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string;
  datetime: number;
  category: string;
  related: string;
}

type Sentiment = 'bullish' | 'bearish' | 'neutral';

interface SentimentResult {
  id: number;
  sentiment: Sentiment;
  reason: string;
}

const BULLISH_KEYWORDS = [
  'surge', 'surges', 'rally', 'rallies', 'soar', 'soars', 'jump', 'jumps',
  'gain', 'gains', 'rise', 'rises', 'climb', 'climbs', 'bull', 'bullish',
  'upgrade', 'upgrades', 'upside', 'outperform', 'overweight', 'buy',
  'beat', 'beats', 'exceed', 'exceeds', 'strong', 'positive', 'growth',
  'record high', 'breakout', 'momentum', 'optimistic', 'optimism',
  'recovery', 'rebound', 'boost', 'boosts', 'opportunity', 'backing',
  'backs', 'value', 'deep value', 'discount',
];

const BEARISH_KEYWORDS = [
  'fall', 'falls', 'drop', 'drops', 'decline', 'declines', 'plunge', 'plunges',
  'crash', 'crashes', 'sink', 'sinks', 'tumble', 'tumbles', 'bear', 'bearish',
  'downgrade', 'downgrades', 'downside', 'underperform', 'underweight', 'sell',
  'miss', 'misses', 'weak', 'negative', 'loss', 'losses', 'risk', 'risks',
  'concern', 'concerns', 'warning', 'warns', 'trouble', 'fear', 'fears',
  'recession', 'slowdown', 'cut', 'cuts', 'lower', 'lowers', 'slash',
  'problems', 'threat', 'threats', 'rating downgrade',
];

function analyzeKeywordSentiment(headline: string, summary: string): Sentiment {
  const text = `${headline} ${summary}`.toLowerCase();
  let bullish = 0, bearish = 0;
  for (const kw of BULLISH_KEYWORDS) { if (text.includes(kw)) bullish++; }
  for (const kw of BEARISH_KEYWORDS) { if (text.includes(kw)) bearish++; }
  if (bullish === 0 && bearish === 0) return 'neutral';
  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'neutral';
}

const sentimentConfig: Record<Sentiment, { label: string; icon: typeof TrendingUp; className: string }> = {
  bullish: { label: 'Bullish', icon: TrendingUp, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  bearish: { label: 'Bearish', icon: TrendingDown, className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  neutral: { label: 'Neutral', icon: Minus, className: 'bg-muted text-muted-foreground border-border' },
};

async function fetchStockNews(symbol: string): Promise<NewsArticle[]> {
  if (!isEdgeFnAvailable()) {
    // Return empty — keyword sentiment still works from headlines in the UI
    return [];
  }
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-data?symbol=${symbol}&action=news`,
    {
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    }
  );
  if (!response.ok) throw new Error('Failed to fetch news');
  return response.json();
}

async function fetchAISentiment(articles: NewsArticle[]): Promise<SentimentResult[]> {
  const payload = articles.map(a => ({ id: a.id, headline: a.headline, summary: a.summary }));
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-news-sentiment`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ articles: payload }),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Status ${response.status}`);
  }
  const data = await response.json();
  return data.results || [];
}

interface StockNewsProps {
  symbol: string;
}

export function StockNews({ symbol }: StockNewsProps) {
  const { t } = useLanguage();
  const [aiSentimentMap, setAiSentimentMap] = useState<Record<number, SentimentResult>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalyzed, setAiAnalyzed] = useState(false);

  const { data: articles, isLoading } = useQuery({
    queryKey: ['stock-news', symbol],
    queryFn: () => fetchStockNews(symbol),
    staleTime: 10 * 60 * 1000,
  });

  const runAIAnalysis = async () => {
    if (!articles || articles.length === 0) return;
    setIsAnalyzing(true);
    try {
      const results = await fetchAISentiment(articles);
      const map: Record<number, SentimentResult> = {};
      results.forEach(r => { map[r.id] = r; });
      setAiSentimentMap(map);
      setAiAnalyzed(true);
      toast.success(`AI analyzed ${results.length} articles`);
    } catch (e) {
      console.error('AI sentiment error:', e);
      toast.error(e instanceof Error ? e.message : 'Sentiment analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Keyword-based summary (always shown)
  const keywordSummary = articles && articles.length > 0
    ? (() => {
        let b = 0, bear = 0, n = 0;
        articles.forEach(a => {
          const s = analyzeKeywordSentiment(a.headline, a.summary);
          if (s === 'bullish') b++;
          else if (s === 'bearish') bear++;
          else n++;
        });
        return { bullish: b, bearish: bear, neutral: n };
      })()
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-primary" />
            {t('relatedNews')}
          </CardTitle>
          <div className="flex items-center gap-2">
            {keywordSummary && (
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-emerald-400">🟢 {keywordSummary.bullish}</span>
                <span className="text-red-400">🔴 {keywordSummary.bearish}</span>
                <span className="text-muted-foreground">⚪ {keywordSummary.neutral}</span>
              </div>
            )}
            {articles && articles.length > 0 && (
              <button
                onClick={runAIAnalysis}
                disabled={isAnalyzing}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Brain className="h-3 w-3" />
                )}
                {isAnalyzing ? 'Analyzing...' : aiAnalyzed ? 'Re-analyze' : 'AI Sentiment'}
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[600px] overflow-y-auto">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))
        ) : !articles || articles.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No recent news available for {symbol}
          </p>
        ) : (
          <>
            <NewsSentimentTrend articles={articles} analyzeSentiment={analyzeKeywordSentiment} />
            {articles.map((article) => {
            const kwSentiment = analyzeKeywordSentiment(article.headline, article.summary);
            const kwConfig = sentimentConfig[kwSentiment];
            const KwIcon = kwConfig.icon;

            const aiResult = aiSentimentMap[article.id];
            const aiConfig = aiResult ? sentimentConfig[aiResult.sentiment] : null;
            const AiIcon = aiConfig?.icon;

            return (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors group"
              >
                <div className="flex gap-3">
                  {article.image && (
                    <img
                      src={article.image}
                      alt=""
                      className="w-16 h-16 rounded object-cover flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5">
                      <h4 className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors flex-1">
                        {article.headline}
                        <ExternalLink className="inline h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </h4>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 flex items-center gap-0.5 ${kwConfig.className}`}>
                          <KwIcon className="h-2.5 w-2.5" />
                          {kwConfig.label}
                        </Badge>
                        {aiConfig && AiIcon && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 flex items-center gap-0.5 border-primary/40 ${aiConfig.className}`}>
                            <Brain className="h-2.5 w-2.5" />
                            {aiConfig.label}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {aiResult?.reason && (
                      <p className="text-[10px] text-primary/70 mt-0.5 italic line-clamp-1">
                        AI: {aiResult.reason}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {article.summary}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {article.source}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDistanceToNow(new Date(article.datetime * 1000), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
