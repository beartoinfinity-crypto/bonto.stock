import { useState, useEffect, useCallback } from 'react';
import { edgeFn, isEdgeFnAvailable } from '@/lib/edgeFn';
import { fetchHistoricalData, fetchStockQuote } from '@/lib/stockApi';
import { getStrategyRecommendations, StrategyRecommendation } from '@/lib/strategyRecommendation';
import { screenerStocks, ScreenerStock } from '@/lib/stockScreener';
import { generateHistoricalData } from '@/lib/stockData';
import * as storage from '@/lib/storage';

export interface NewsSentimentSummary {
  bullish: number;
  bearish: number;
  neutral: number;
  total: number;
  overall: 'bullish' | 'bearish' | 'neutral';
}

export interface SocialSentimentSummary {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confirmation: 'confirmed' | 'divergence' | 'neutral';
  confidence: number;
  themes: string[];
  summary: string;
  source?: 'ai' | 'fallback';
}

export interface ScreenerResult {
  stock: ScreenerStock;
  combinedSignal: StrategyRecommendation | null;
  isLoading: boolean;
  error: string | null;
  isSimulated: boolean;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  newsSentiment: NewsSentimentSummary | null;
  socialSentiment: SocialSentimentSummary | null;
}

export interface UseScreenerDataResult {
  results: ScreenerResult[];
  isLoading: boolean;
  progress: number;
  totalStocks: number;
  refreshAll: (force?: boolean) => void;
  lastUpdated: Date | null;
  fromCache: boolean;
}

// ─── Keyword-based news sentiment ──────────────────────────────────

const BULLISH_KEYWORDS = [
  'surge', 'surges', 'rally', 'rallies', 'soar', 'soars', 'jump', 'jumps',
  'gain', 'gains', 'rise', 'rises', 'climb', 'climbs', 'bull', 'bullish',
  'upgrade', 'upgrades', 'upside', 'outperform', 'overweight', 'buy',
  'beat', 'beats', 'exceed', 'exceeds', 'strong', 'positive', 'growth',
  'record high', 'breakout', 'momentum', 'optimistic', 'optimism',
  'recovery', 'rebound', 'boost', 'boosts', 'opportunity',
];

const BEARISH_KEYWORDS = [
  'fall', 'falls', 'drop', 'drops', 'decline', 'declines', 'plunge', 'plunges',
  'crash', 'crashes', 'sink', 'sinks', 'tumble', 'tumbles', 'bear', 'bearish',
  'downgrade', 'downgrades', 'downside', 'underperform', 'underweight', 'sell',
  'miss', 'misses', 'weak', 'negative', 'loss', 'losses', 'risk', 'risks',
  'concern', 'concerns', 'warning', 'warns', 'trouble', 'fear', 'fears',
  'recession', 'slowdown', 'cut', 'cuts', 'lower', 'lowers', 'slash',
];

const SOCIAL_REQUEST_GAP_MS = 1200;
let socialQueue: Promise<void> = Promise.resolve();
let socialLastRunAt = 0;

function classifyArticle(headline: string, summary: string): 'bullish' | 'bearish' | 'neutral' {
  const text = `${headline} ${summary}`.toLowerCase();
  let bull = 0, bear = 0;
  for (const kw of BULLISH_KEYWORDS) { if (text.includes(kw)) bull++; }
  for (const kw of BEARISH_KEYWORDS) { if (text.includes(kw)) bear++; }
  if (bull === 0 && bear === 0) return 'neutral';
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}

async function fetchNewsSentiment(symbol: string): Promise<NewsSentimentSummary | null> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-data?symbol=${symbol}&action=news`,
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );
    if (!response.ok) return null;
    const articles: Array<{ headline: string; summary: string; datetime: number }> = await response.json();
    if (!Array.isArray(articles) || articles.length === 0) return null;

    // Filter to past 10 days
    const tenDaysAgo = Date.now() / 1000 - 10 * 24 * 60 * 60;
    const recent = articles.filter(a => a.datetime >= tenDaysAgo);
    if (recent.length === 0) return null;

    let bullish = 0, bearish = 0, neutral = 0;
    for (const a of recent) {
      const s = classifyArticle(a.headline, a.summary || '');
      if (s === 'bullish') bullish++;
      else if (s === 'bearish') bearish++;
      else neutral++;
    }
    const total = bullish + bearish + neutral;
    const overall: 'bullish' | 'bearish' | 'neutral' =
      bullish > bearish && bullish > neutral ? 'bullish' :
      bearish > bullish && bearish > neutral ? 'bearish' : 'neutral';

    return { bullish, bearish, neutral, total, overall };
  } catch {
    return null;
  }
}

async function runQueuedSocialSentiment(symbol: string, action: string): Promise<SocialSentimentSummary | null> {
  if (!isEdgeFnAvailable()) return null;
  const previous = socialQueue;
  let releaseQueue!: () => void;
  socialQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;

  try {
    const elapsed = Date.now() - socialLastRunAt;
    if (elapsed < SOCIAL_REQUEST_GAP_MS) {
      await new Promise((resolve) => setTimeout(resolve, SOCIAL_REQUEST_GAP_MS - elapsed));
    }

    const { data, error } = await edgeFn('social-sentiment', {
      symbol, action,
    });

    socialLastRunAt = Date.now();

    if (error || !data?.success || !data?.data) return null;

    return {
      sentiment: data.data.sentiment,
      confirmation: data.data.confirmation,
      confidence: Number(data.data.confidence ?? 0),
      themes: data.data.themes || [],
      summary: data.data.summary || '',
      source: data.data.source,
    };
  } catch {
    socialLastRunAt = Date.now();
    return null;
  } finally {
    releaseQueue();
  }
}

async function fetchSocialSentiment(symbol: string, action: string): Promise<SocialSentimentSummary | null> {
  try {
    return await runQueuedSocialSentiment(symbol, action);
  } catch {
    return null;
  }
}

// ─── Local persistence helpers ─────────────────────────────────────

const SCREENER_CACHE_KEY = 'stockpulse_screener_results';

interface StoredScreenerData {
  entries: Record<string, DBSignalData>;
  computedAt: string;
}

interface DBSignalData {
  signal: StrategyRecommendation;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  newsSentiment?: NewsSentimentSummary | null;
  socialSentiment?: SocialSentimentSummary | null;
}

function loadFromCache(): { results: ScreenerResult[]; computedAt: Date } | null {
  try {
    const raw = storage.getItem(SCREENER_CACHE_KEY);
    if (!raw) return null;
    const stored: StoredScreenerData = JSON.parse(raw);
    if (!stored.entries || Object.keys(stored.entries).length === 0) return null;

    const results: ScreenerResult[] = [];
    for (const stock of screenerStocks) {
      const row = stored.entries[stock.symbol];
      if (row) {
        const signal = row.signal || (row as unknown as StrategyRecommendation);
        results.push({
          stock,
          combinedSignal: signal,
          isLoading: false,
          error: null,
          isSimulated: false,
          price: row.price ?? null,
          change: row.change ?? null,
          changePercent: row.changePercent ?? null,
          newsSentiment: row.newsSentiment ?? null,
          socialSentiment: row.socialSentiment ?? null,
        });
      }
    }

    if (results.length === 0) return null;
    return { results, computedAt: new Date(stored.computedAt) };
  } catch {
    return null;
  }
}

function saveToCache(results: ScreenerResult[]): void {
  try {
    const entries: Record<string, DBSignalData> = {};
    for (const r of results) {
      if (r.combinedSignal && !r.isLoading) {
        entries[r.stock.symbol] = {
          signal: r.combinedSignal,
          price: r.price,
          change: r.change,
          changePercent: r.changePercent,
          newsSentiment: r.newsSentiment,
          socialSentiment: r.socialSentiment,
        };
      }
    }
    if (Object.keys(entries).length === 0) return;
    const data: StoredScreenerData = { entries, computedAt: new Date().toISOString() };
    storage.setItem(SCREENER_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save screener results to cache:', e);
  }
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useScreenerData(): UseScreenerDataResult {
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const analyzeStock = useCallback(async (stock: ScreenerStock): Promise<ScreenerResult> => {
    try {
      // Fetch quote, historical, and news in parallel
      const [quoteResult, histResult, newsSentiment] = await Promise.all([
        fetchStockQuote(stock.symbol),
        fetchHistoricalData(stock.symbol),
        fetchNewsSentiment(stock.symbol),
      ]);

      const price = quoteResult.data?.price ?? null;
      const change = quoteResult.data?.change ?? null;
      const changePercent = quoteResult.data?.changePercent ?? null;

      let dataToAnalyze = histResult.data;
      let isSimulated = !histResult.isRealData;

      if (histResult.error || !histResult.data || histResult.data.length < 100) {
        const basePrice = price || (100 + Math.random() * 400);
        dataToAnalyze = generateHistoricalData(basePrice);
        isSimulated = true;
      }

      const recommendations = getStrategyRecommendations(dataToAnalyze);
      const combinedSignal = recommendations.recommendations.find(
        r => r.strategy === 'Combined Signal'
      ) || null;

      // Fetch social sentiment (with timeout to avoid blocking)
      const action = combinedSignal?.action || 'HOLD';
      const socialSentiment = await Promise.race([
        fetchSocialSentiment(stock.symbol, action),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 15000)),
      ]);

      return { stock, combinedSignal, isLoading: false, error: null, isSimulated, price, change, changePercent, newsSentiment, socialSentiment };
    } catch {
      const basePrice = 100 + Math.random() * 400;
      const simulatedData = generateHistoricalData(basePrice);
      const recommendations = getStrategyRecommendations(simulatedData);
      const combinedSignal = recommendations.recommendations.find(
        r => r.strategy === 'Combined Signal'
      ) || null;

      return { stock, combinedSignal, isLoading: false, error: null, isSimulated: true, price: null, change: null, changePercent: null, newsSentiment: null, socialSentiment: null };
    }
  }, []);

  const loadAllStocks = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadFromCache();
      if (cached && cached.results.length > 0) {
        setResults(cached.results);
        setLastUpdated(cached.computedAt);
        setFromCache(true);
        setIsLoading(false);
        setProgress(screenerStocks.length);
        return;
      }
    }

    setIsLoading(true);
    setFromCache(false);
    setProgress(0);

    const initialResults: ScreenerResult[] = screenerStocks.map(stock => ({
      stock, combinedSignal: null, isLoading: true, error: null, isSimulated: false,
      price: null, change: null, changePercent: null, newsSentiment: null, socialSentiment: null,
    }));
    setResults(initialResults);

    const batchSize = 2;
    const updatedResults: ScreenerResult[] = [...initialResults];

    for (let i = 0; i < screenerStocks.length; i += batchSize) {
      const batch = screenerStocks.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(stock => analyzeStock(stock)));

      batchResults.forEach((result, idx) => {
        updatedResults[i + idx] = result;
      });

      setResults([...updatedResults]);
      setProgress(Math.min(i + batchSize, screenerStocks.length));

      if (i + batchSize < screenerStocks.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    saveToCache(updatedResults);
    setLastUpdated(new Date());
    setIsLoading(false);
  }, [analyzeStock]);

  useEffect(() => {
    loadAllStocks();
  }, [loadAllStocks]);

  return {
    results,
    isLoading,
    progress,
    totalStocks: screenerStocks.length,
    refreshAll: loadAllStocks,
    lastUpdated,
    fromCache,
  };
}
