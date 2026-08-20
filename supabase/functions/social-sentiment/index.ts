import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Sentiment = 'bullish' | 'bearish' | 'neutral';
type Confirmation = 'confirmed' | 'divergence' | 'neutral';

type NewsArticle = {
  datetime?: number | string;
  date?: string;
  headline?: string;
  title?: string;
  summary?: string;
  description?: string;
};

interface SentimentResult {
  sentiment: Sentiment;
  confirmation: Confirmation;
  confidence: number;
  themes: string[];
  summary: string;
  checkedAt: string;
  source?: 'ai' | 'fallback';
  cached?: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours


const BULLISH_KEYWORDS = [
  'surge', 'surges', 'rally', 'rallies', 'soar', 'soars', 'jump', 'jumps',
  'gain', 'gains', 'rise', 'rises', 'climb', 'climbs', 'bull', 'bullish',
  'upgrade', 'upgrades', 'upside', 'outperform', 'overweight', 'buy',
  'beat', 'beats', 'exceed', 'exceeds', 'strong', 'positive', 'growth',
  'record high', 'breakout', 'momentum', 'optimistic', 'optimism',
  'recovery', 'rebound', 'boost', 'boosts', 'opportunity', 'confidence',
];

const BEARISH_KEYWORDS = [
  'fall', 'falls', 'drop', 'drops', 'decline', 'declines', 'plunge', 'plunges',
  'crash', 'crashes', 'sink', 'sinks', 'tumble', 'tumbles', 'bear', 'bearish',
  'downgrade', 'downgrades', 'downside', 'underperform', 'underweight', 'sell',
  'miss', 'misses', 'weak', 'negative', 'loss', 'losses', 'risk', 'risks',
  'concern', 'concerns', 'warning', 'warns', 'trouble', 'fear', 'fears',
  'recession', 'slowdown', 'cut', 'cuts', 'lower', 'lowers', 'slash', 'headwinds',
];

const THEME_RULES: Array<{ label: string; keywords: string[] }> = [
  { label: 'Earnings & Results', keywords: ['earnings', 'revenue', 'profit', 'margin', 'guidance'] },
  { label: 'Analyst Ratings', keywords: ['analyst', 'upgrade', 'downgrade', 'price target', 'outperform', 'underperform'] },
  { label: 'Leadership & Insider Activity', keywords: ['ceo', 'cfo', 'insider', 'director', 'bought shares', 'share purchase'] },
  { label: 'AI & Product Strategy', keywords: ['ai', 'artificial intelligence', 'copilot', 'chip', 'platform', 'product'] },
  { label: 'Demand & Consumer Trends', keywords: ['demand', 'consumer', 'sales', 'traffic', 'brand', 'turnaround'] },
  { label: 'Regulatory & Legal', keywords: ['lawsuit', 'regulatory', 'investigation', 'settlement', 'antitrust'] },
  { label: 'Macro & Market Conditions', keywords: ['rates', 'inflation', 'economy', 'market', 'dow jones', 'nasdaq'] },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function respond(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function clampConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  const scaled = numeric <= 1 ? numeric * 100 : numeric;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}

function classifySentiment(text: string): Sentiment {
  const normalized = text.toLowerCase();
  let bullish = 0;
  let bearish = 0;

  for (const keyword of BULLISH_KEYWORDS) {
    if (normalized.includes(keyword)) bullish += 1;
  }
  for (const keyword of BEARISH_KEYWORDS) {
    if (normalized.includes(keyword)) bearish += 1;
  }

  if (bullish === 0 && bearish === 0) return 'neutral';
  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'neutral';
}

function getConfirmation(sentiment: Sentiment, action: string): Confirmation {
  if (sentiment === 'neutral' || action === 'HOLD') return 'neutral';
  if ((action === 'BUY' && sentiment === 'bullish') || (action === 'SELL' && sentiment === 'bearish')) {
    return 'confirmed';
  }
  return 'divergence';
}

function extractThemes(articles: NewsArticle[]): string[] {
  const combinedText = articles
    .map((article) => `${article.headline || article.title || ''} ${article.summary || article.description || ''}`.toLowerCase())
    .join(' ');

  return THEME_RULES
    .filter((rule) => rule.keywords.some((keyword) => combinedText.includes(keyword)))
    .slice(0, 5)
    .map((rule) => rule.label);
}

function buildFallbackResult(
  articles: NewsArticle[],
  symbol: string,
  action: string,
  reason: 'rate_limited' | 'credits_exhausted' | 'gateway_error' | 'parse_error' | 'unexpected_error'
): SentimentResult {
  const checkedAt = new Date().toISOString();
  const articleText = articles
    .slice(0, 15)
    .map((article) => `${article.headline || article.title || ''} ${article.summary || article.description || ''}`.trim())
    .join(' ');

  const sentiment = articleText ? classifySentiment(articleText) : 'neutral';
  const confirmation = getConfirmation(sentiment, action);
  const themes = extractThemes(articles);

  const articleCount = Math.min(articles.length, 10);
  const confidenceBase = articleText ? 42 + articleCount * 4 : 35;
  const confidence = Math.min(78, confidenceBase);

  const reasonLabel =
    reason === 'rate_limited'
      ? 'AI is temporarily rate-limited'
      : reason === 'credits_exhausted'
        ? 'AI credits are temporarily unavailable'
        : 'AI analysis is temporarily unavailable';

  const summary = articleText
    ? `${reasonLabel}, so this uses a headline-based fallback. Recent coverage for ${symbol} reads as ${sentiment}, and that is ${confirmation === 'confirmed' ? 'aligned with' : confirmation === 'divergence' ? 'diverging from' : 'not strongly aligned with'} the current ${action} signal.`
    : `${reasonLabel}, and there were not enough recent headlines to infer a strong discussion bias for ${symbol}.`;

  return {
    sentiment,
    confirmation,
    confidence,
    themes,
    summary,
    checkedAt,
    source: 'fallback',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let symbol = '';
  let action = 'HOLD';
  let force = false;
  let articles: NewsArticle[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const rawSymbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const rawAction = typeof body?.action === 'string' ? body.action.trim().toUpperCase() : 'HOLD';
    force = body?.force === true;

    // Strict validation to prevent prompt injection via control chars or oversized inputs
    if (!rawSymbol || !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(rawSymbol)) {
      return respond({ success: false, error: 'invalid symbol' });
    }
    const ALLOWED_ACTIONS = new Set(['BUY', 'SELL', 'HOLD']);
    symbol = rawSymbol;
    action = ALLOWED_ACTIONS.has(rawAction) ? rawAction : 'HOLD';


    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    // Cache client uses service role to read/write the cache table
    const cacheClient = SUPABASE_URL && SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null;

    // ── 1) Check cache (skip if force=true) ──────────────────────
    if (!force && cacheClient) {
      try {
        const { data: cached } = await cacheClient
          .from('social_sentiment_cache')
          .select('*')
          .eq('symbol', symbol)
          .eq('action', action)
          .maybeSingle();

        if (cached?.computed_at) {
          const ageMs = Date.now() - new Date(cached.computed_at).getTime();
          if (ageMs < CACHE_TTL_MS) {
            return respond({
              success: true,
              data: {
                sentiment: cached.sentiment as Sentiment,
                confirmation: cached.confirmation as Confirmation,
                confidence: Number(cached.confidence) || 0,
                themes: Array.isArray(cached.themes) ? cached.themes : [],
                summary: cached.summary || '',
                checkedAt: cached.computed_at,
                source: (cached.source as 'ai' | 'fallback') || 'ai',
                cached: true,
              },
              diagnostics: { cached: true, ageMs },
            });
          }
        }
      } catch (error) {
        console.warn('Cache lookup failed:', error);
      }
    }

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const newsResp = await fetch(
          `${SUPABASE_URL}/functions/v1/stock-data?action=news&symbol=${encodeURIComponent(symbol)}`,
          {
            headers: {
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (newsResp.ok) {
          const newsData = await newsResp.json();
          articles = (newsData.data || newsData || []).slice(0, 15);
        }
      } catch (error) {
        console.warn('Failed to fetch news context:', error);
      }
    }

    const newsContext = articles.length > 0
      ? articles
          .map((article) => `- [${article.datetime || article.date || ''}] ${article.headline || article.title || ''}: ${article.summary || article.description || ''}`)
          .join('\n')
      : 'No recent news articles available.';

    if (!LOVABLE_API_KEY) {
      return respond({
        success: true,
        data: buildFallbackResult(articles, symbol, action, 'unexpected_error'),
        diagnostics: { degraded: true, reason: 'missing_api_key' },
      });
    }

    const aiPayload = {
      model: 'google/gemini-3-flash-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a financial social sentiment analyst. Analyze recent news and public discussion tone for a stock. Determine the overall social/public sentiment, whether it confirms or contradicts the given technical signal, and extract key discussion themes. Be objective and concise.',
        },
        {
          role: 'user',
          content: `Stock: ${symbol}\nCurrent technical signal: ${action || 'HOLD'}\n\nRecent news and social mentions:\n${newsContext}\n\nAnalyze the social media sentiment and public discussion tone for ${symbol}. Classify overall sentiment, identify key themes, and determine if public buzz confirms or contradicts the technical ${action || 'HOLD'} signal.`,
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'report_sentiment',
            description: 'Report the social sentiment analysis results',
            parameters: {
              type: 'object',
              properties: {
                sentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
                confirmation: { type: 'string', enum: ['confirmed', 'divergence', 'neutral'] },
                confidence: { type: 'number' },
                themes: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' },
              },
              required: ['sentiment', 'confirmation', 'confidence', 'themes', 'summary'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'report_sentiment' } },
    };

    let aiResp: Response | null = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(aiPayload),
      });

      if (aiResp.status !== 429) break;
      if (attempt < maxAttempts) {
        const backoffMs = 1200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
        console.warn(`social-sentiment rate limited for ${symbol}, retrying in ${backoffMs}ms`);
        await wait(backoffMs);
      }
    }

    if (!aiResp) {
      return respond({
        success: true,
        data: buildFallbackResult(articles, symbol, action, 'gateway_error'),
        diagnostics: { degraded: true, reason: 'missing_response' },
      });
    }

    if (!aiResp.ok) {
      const status = aiResp.status;
      const reason = status === 429
        ? 'rate_limited'
        : status === 402
          ? 'credits_exhausted'
          : 'gateway_error';

      const errorText = await aiResp.text();
      console.error('AI gateway error:', status, errorText);

      return respond({
        success: true,
        data: buildFallbackResult(articles, symbol, action, reason),
        diagnostics: {
          degraded: true,
          reason,
          gatewayStatus: status,
        },
      });
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error('No tool call in response:', JSON.stringify(aiData));
      return respond({
        success: true,
        data: buildFallbackResult(articles, symbol, action, 'parse_error'),
        diagnostics: { degraded: true, reason: 'missing_tool_call' },
      });
    }

    let parsedResult: Record<string, unknown>;
    try {
      parsedResult = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      console.error('Failed to parse tool call arguments:', error);
      return respond({
        success: true,
        data: buildFallbackResult(articles, symbol, action, 'parse_error'),
        diagnostics: { degraded: true, reason: 'invalid_tool_json' },
      });
    }

    const aiResult: SentimentResult = {
      sentiment: (parsedResult.sentiment as Sentiment) || 'neutral',
      confirmation: (parsedResult.confirmation as Confirmation) || 'neutral',
      confidence: clampConfidence(parsedResult.confidence),
      themes: Array.isArray(parsedResult.themes) ? (parsedResult.themes as string[]).slice(0, 5) : [],
      summary: typeof parsedResult.summary === 'string' ? parsedResult.summary : '',
      checkedAt: new Date().toISOString(),
      source: 'ai',
    };

    // ── Persist to cache (best-effort) ───────────────────────────
    if (cacheClient) {
      try {
        await cacheClient
          .from('social_sentiment_cache')
          .upsert({
            symbol,
            action,
            sentiment: aiResult.sentiment,
            confirmation: aiResult.confirmation,
            confidence: aiResult.confidence,
            themes: aiResult.themes,
            summary: aiResult.summary,
            source: aiResult.source,
            computed_at: aiResult.checkedAt,
          }, { onConflict: 'symbol,action' });
      } catch (error) {
        console.warn('Failed to persist sentiment cache:', error);
      }
    }

    return respond({ success: true, data: aiResult });
  } catch (error) {
    console.error('social-sentiment error:', error);
    return respond({
      success: symbol.length > 0,
      ...(symbol.length > 0
        ? {
            data: buildFallbackResult(articles, symbol, action, 'unexpected_error'),
            diagnostics: { degraded: true, reason: 'unexpected_error' },
          }
        : {
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
    });
  }
});
