// Multi-source local sentiment analysis - no Supabase/AI needed
// Sources: Google News, StockTwits, Yahoo Finance, ApeWisdom, SocialTickers,
//          Finnhub, Reddit (WSB+stocks+investing), MarketWatch RSS, CNBC RSS,
//          Google Trends, Adanos (Reddit/X/news/Polymarket aggregate)

const SERVER_PROXY = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url: string, timeoutMs = 5000): Promise<Response> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(SERVER_PROXY(url), { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* server proxy unavailable */ }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* CORS blocked */ }

  for (const proxy of CORS_PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(proxy(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch { continue; }
  }

  throw new Error('All fetch methods failed');
}

// --- Types -----------------------------------------------------------

export type SourceKind = 'social' | 'news' | 'attention';
export type SentimentTone = 'bullish' | 'bearish' | 'neutral';
export type AttentionTrend = 'rising' | 'fading' | 'steady' | 'unknown';
export type Divergence = 'retail-more-bullish' | 'retail-more-bearish' | 'aligned' | 'unknown';

export interface SentimentItem {
  text: string;
  url?: string;
  publishedAt?: string;
  score: number;
  label?: 'Bullish' | 'Bearish';
}

export interface AttentionInfo {
  label: string;
  detail: string;
  trend: AttentionTrend;
}

export interface SourceResult {
  name: string;
  kind: SourceKind;
  score: number;
  count: number;
  headlines: string[];
  items?: SentimentItem[];
  detail?: string;
  attention?: AttentionInfo;
}

export interface GroupScore {
  score: number;
  items: number;
  sources: number;
}

export interface KeyQuote extends SentimentItem {
  source: string;
  tone: SentimentTone;
}

export interface AggregatedSentiment {
  sentiment: SentimentTone;
  confidence: number;
  sources: SourceResult[];
  totalItems: number;
  themes: string[];
  keyQuotes: KeyQuote[];
  retail: GroupScore | null;
  news: GroupScore | null;
  divergence: Divergence;
  agreement: number;
  attention: AttentionInfo | null;
  unavailableSources: string[];
  briefSummary: string;
  summary: string;
  checkedAt: string;
}

export function toneOf(score: number): SentimentTone {
  if (score > 0.08) return 'bullish';
  if (score < -0.08) return 'bearish';
  return 'neutral';
}

function emptySource(name: string, kind: SourceKind): SourceResult {
  return { name, kind, score: 0, count: 0, headlines: [] };
}

function averageScore(items: SentimentItem[]): number {
  return items.length ? items.reduce((a, i) => a + i.score, 0) / items.length : 0;
}

function formatPct(score: number): string {
  return `${score > 0 ? '+' : ''}${(score * 100).toFixed(0)}%`;
}

const COMPANY_SUFFIXES = new Set([
  'inc', 'corp', 'corporation', 'company', 'co', 'plc', 'ltd', 'limited', 'holdings',
  'holding', 'group', 'the', 'class', 'common', 'stock', 'trust', 'technologies',
  'technology', 'systems', 'international', 'industries', 'enterprises', 'brands', 'and',
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isRelevantToSymbol(text: string, symbol: string, companyName?: string): boolean {
  const lower = text.toLowerCase();
  const sym = symbol.toLowerCase();

  if (sym.length >= 2) {
    const tickerRe = new RegExp(`(^|[^a-z0-9])${escapeRegExp(sym)}([^a-z0-9]|$)`, 'i');
    if (tickerRe.test(text)) return true;
  }

  if (!companyName) return false;
  const tokens = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !COMPANY_SUFFIXES.has(t));

  return tokens.some(t => lower.includes(t));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
}

interface RssEntry {
  title: string;
  link?: string;
  publishedAt?: string;
}

function parseRssEntries(xml: string, limit: number): RssEntry[] {
  const entries: RssEntry[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && entries.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<title>(.*?)<\/title>/);
    if (!titleMatch) continue;
    const title = stripTags(titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
    if (!title) continue;

    const linkMatch = block.match(/<link>(.*?)<\/link>/);
    const dateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);
    const link = linkMatch ? stripTags(linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : undefined;
    const parsed = dateMatch ? new Date(dateMatch[1]).getTime() : NaN;

    entries.push({
      title,
      link: link || undefined,
      publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined,
    });
  }

  return entries;
}

function toItems(entries: RssEntry[]): SentimentItem[] {
  return entries.map(e => ({
    text: e.title,
    url: e.link,
    publishedAt: e.publishedAt,
    score: scoreText(e.title).score,
  }));
}

function recencyWeight(publishedAt?: string): number {
  if (!publishedAt) return 0.35;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ageMs)) return 0.35;
  const days = ageMs / 86_400_000;
  if (days <= 0) return 1;
  if (days >= 7) return 0;
  return 1 - days / 7;
}

export function computeGroupScores(sources: SourceResult[]): { retail: GroupScore | null; news: GroupScore | null } {
  const group = (kind: SourceKind): GroupScore | null => {
    const list = sources.filter(s => s.kind === kind && s.count > 0);
    if (!list.length) return null;
    const items = list.reduce((a, s) => a + s.count, 0);
    const weights = list.map(s => Math.min(s.count, 30));
    const totalWeight = weights.reduce((a, w) => a + w, 0);
    const score = totalWeight > 0
      ? list.reduce((a, s, i) => a + s.score * weights[i], 0) / totalWeight
      : 0;
    return { score, items, sources: list.length };
  };

  return { retail: group('social'), news: group('news') };
}

export function detectDivergence(retail: GroupScore | null, news: GroupScore | null): Divergence {
  if (!retail || !news || retail.items < 3 || news.items < 3) return 'unknown';
  const r = toneOf(retail.score);
  const n = toneOf(news.score);
  if (r === 'neutral' || n === 'neutral') return 'unknown';
  if (r === n) return 'aligned';
  return r === 'bullish' ? 'retail-more-bullish' : 'retail-more-bearish';
}

export function computeAgreement(sources: SourceResult[], sentiment: SentimentTone): number {
  const directional = sources.filter(s => s.kind !== 'attention' && s.count > 0);
  if (!directional.length) return 0;
  const matching = directional.filter(s => toneOf(s.score) === sentiment).length;
  return matching / directional.length;
}

export function rankKeyQuotes(sources: SourceResult[], limit = 5): KeyQuote[] {
  const seen = new Set<string>();
  const pool: KeyQuote[] = [];

  for (const src of sources) {
    for (const item of src.items ?? []) {
      const text = item.text.trim();
      if (!text) continue;
      const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').slice(0, 64);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pool.push({
        ...item,
        text,
        source: src.name,
        tone: toneOf(item.label === 'Bullish' ? 1 : item.label === 'Bearish' ? -1 : item.score),
      });
    }
  }

  const weight = (q: KeyQuote) =>
    Math.abs(q.score) * 0.65 + recencyWeight(q.publishedAt) * 0.25 + (q.label ? 0.2 : 0);

  const sorted = [...pool].sort((a, b) => weight(b) - weight(a));
  const picks: KeyQuote[] = [];
  const bullish = sorted.find(q => q.tone === 'bullish');
  const bearish = sorted.find(q => q.tone === 'bearish');
  if (bullish) picks.push(bullish);
  if (bearish) picks.push(bearish);

  for (const quote of sorted) {
    if (picks.length >= limit) break;
    if (!picks.includes(quote)) picks.push(quote);
  }

  return picks.slice(0, limit);
}

// --- Keyword-based sentiment scoring --------------------------------

const BULLISH_WORDS = new Set([
  'surge', 'surges', 'surging', 'soar', 'soars', 'soaring', 'rally', 'rallies', 'rallying',
  'upgrade', 'upgrades', 'upgraded', 'outperform', 'overweight', 'buy', 'strong buy',
  'bull', 'bullish', 'momentum', 'breakout', 'record high', 'all-time high', 'ATH',
  'beat', 'beats', 'beating', 'exceeds', 'exceeded', 'outperform', 'growth', 'gains',
  'jump', 'jumps', 'jumping', 'spike', 'spikes', 'spiking', 'uptick', 'recovery',
  'rebound', 'rebounds', 'positive', 'optimism', 'optimistic', 'confident',
  'innovation', 'partnership', 'expansion', 'dividend', 'buyback', 'revenue growth',
  'profit', 'profits', 'profitable', 'undervalued', 'cheap', 'bargain', 'opportunity',
  'strong', 'strength', 'resilient', 'outlook', 'raise', 'raised', 'raises target',
]);

const BEARISH_WORDS = new Set([
  'crash', 'crashes', 'crashing', 'plunge', 'plunges', 'plunging', 'tumble', 'tumbles',
  'sell', 'sells', 'selling', 'downgrade', 'downgrades', 'downgraded', 'underweight',
  'bear', 'bearish', 'decline', 'declines', 'declining', 'drop', 'drops', 'dropping',
  'fall', 'falls', 'falling', 'slump', 'slumps', 'slumping', 'weakness', 'weak',
  'miss', 'misses', 'missed', 'disappoints', 'disappointed', 'shortfall',
  'fear', 'panic', 'selloff', 'sell-off', 'bloodbath', 'recession', 'inflation',
  'overvalued', 'bubble', 'risk', 'risks', 'risky', 'lawsuit', 'investigation',
  'fraud', 'scandal', 'ban', 'bans', 'tariff', 'tariffs', 'layoff', 'layoffs',
  'restructuring', 'bankruptcy', 'debt', 'loss', 'losses', 'lost', 'warning', 'cuts',
  'cut', 'revenue decline', 'guidance cut', 'lower guidance', 'cautious',
]);

function scoreText(text: string): { score: number; bullishHits: string[]; bearishHits: string[] } {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
  const bullishHits: string[] = [];
  const bearishHits: string[] = [];

  for (const word of words) {
    if (BULLISH_WORDS.has(word)) bullishHits.push(word);
    if (BEARISH_WORDS.has(word)) bearishHits.push(word);
  }

  const lower = text.toLowerCase();
  const bullishPhrases = ['record high', 'all-time high', 'strong buy', 'revenue growth', 'raise target', 'guidance raise'];
  const bearishPhrases = ['record low', 'sell-off', 'selloff', 'revenue decline', 'guidance cut', 'lower guidance', 'debt crisis'];

  for (const p of bullishPhrases) { if (lower.includes(p)) bullishHits.push(p); }
  for (const p of bearishPhrases) { if (lower.includes(p)) bearishHits.push(p); }

  const total = bullishHits.length + bearishHits.length || 1;
  const score = (bullishHits.length - bearishHits.length) / total;
  return { score, bullishHits, bearishHits };
}

// --- Source: Google News RSS ------------------------------------------

async function fetchGoogleNews(symbol: string, companyName?: string): Promise<SourceResult> {
  try {
    const url = `https://news.google.com/rss/search?q=${symbol}+stock&hl=en-US&gl=US&ceid=US:en`;
    const res = await proxyFetch(url);
    const xml = await res.text();
    const entries = parseRssEntries(xml, 30)
      .filter(e => isRelevantToSymbol(e.title, symbol, companyName));
    const items = toItems(entries);

    return {
      name: 'Google News',
      kind: 'news',
      score: averageScore(items),
      count: items.length,
      headlines: items.slice(0, 5).map(i => i.text),
      items,
      detail: `${items.length} recent headlines`,
    };
  } catch {
    return emptySource('Google News', 'news');
  }
}

// --- Source: StockTwits -----------------------------------------------

async function fetchStockTwits(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`;
    const res = await proxyFetch(url, 8000);
    const data = await res.json();
    const messages = data?.messages ?? [];

    const items: SentimentItem[] = [];
    let labeled = 0;
    for (const msg of messages.slice(0, 30)) {
      const text = (msg.body ?? '').trim();
      if (!text) continue;
      const label = msg?.entities?.sentiment?.basic;
      const tagged = label === 'Bullish' || label === 'Bearish' ? label : undefined;
      if (tagged) labeled++;
      const createdAt = msg.created_at ? new Date(msg.created_at) : null;
      items.push({
        text: text.slice(0, 220),
        url: msg.id ? `https://stocktwits.com/message/${msg.id}` : undefined,
        publishedAt: createdAt && Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : undefined,
        score: tagged ? (tagged === 'Bullish' ? 1 : -1) : scoreText(text).score,
        label: tagged,
      });
    }

    return {
      name: 'StockTwits',
      kind: 'social',
      score: averageScore(items),
      count: items.length,
      headlines: items.slice(0, 5).map(i => i.text),
      items,
      detail: labeled > 0 ? `${items.length} posts · ${labeled} self-labeled` : `${items.length} posts`,
    };
  } catch {
    return emptySource('StockTwits', 'social');
  }
}

// --- Source: Yahoo Finance news ---------------------------------------

async function fetchYahooNews(symbol: string, companyName?: string): Promise<SourceResult> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&quotes_count=0&news_count=20`;
    const res = await proxyFetch(url);
    const data = await res.json();
    const news = data?.news ?? [];

    const items: SentimentItem[] = [];
    for (const item of news) {
      const title = (item.title ?? '').trim();
      if (!title) continue;
      if (!isRelevantToSymbol(title, symbol, companyName)) continue;
      const published = typeof item.providerPublishTime === 'number'
        ? new Date(item.providerPublishTime * 1000)
        : null;
      items.push({
        text: title,
        url: item.link || undefined,
        publishedAt: published && Number.isFinite(published.getTime()) ? published.toISOString() : undefined,
        score: scoreText(title).score,
      });
    }

    return {
      name: 'Yahoo Finance',
      kind: 'news',
      score: averageScore(items),
      count: items.length,
      headlines: items.slice(0, 5).map(i => i.text),
      items,
      detail: `${items.length} recent headlines`,
    };
  } catch {
    return emptySource('Yahoo Finance', 'news');
  }
}

// --- Source: ApeWisdom (Reddit aggregated mentions) -------------------
// Tracks WSB + r/stocks + r/investing + r/options mentions
// Free, no API key, CORS-open

async function fetchApeWisdom(symbol: string): Promise<SourceResult> {
  try {
    const url = 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/1';
    const res = await proxyFetch(url, 8000);
    const data = await res.json();
    const results: Array<{
      ticker?: string;
      mentions?: string;
      mentions_24h_ago?: string;
      rank?: string;
      rank_24h_ago?: string;
    }> = data?.results ?? [];

    const tickerData = results.find(
      (r) => (r.ticker ?? '').toUpperCase() === symbol.toUpperCase()
    );

    if (!tickerData) {
      return emptySource('ApeWisdom (Reddit)', 'attention');
    }

    const mentions = parseInt(tickerData.mentions ?? '0', 10);
    const prevMentions = parseInt(tickerData.mentions_24h_ago ?? '0', 10);
    const rank = parseInt(tickerData.rank ?? '0', 10);
    const prevRank = parseInt(tickerData.rank_24h_ago ?? '0', 10);
    const changePct = prevMentions > 0 ? ((mentions - prevMentions) / prevMentions) * 100 : null;

    let score = 0;
    if (prevMentions > 0) {
      const mentionChange = (mentions - prevMentions) / prevMentions;
      score = Math.max(-1, Math.min(1, mentionChange));
    }
    if (prevRank > 0 && rank > 0) {
      const rankChange = (prevRank - rank) / prevRank;
      score = (score + rankChange) / 2;
    }

    const detail = `${mentions.toLocaleString()} mentions${changePct === null ? '' : ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(0)}% vs 24h)`} · rank #${rank}${prevRank ? ` (was #${prevRank})` : ''}`;
    const headlines: string[] = [
      `Mentioned ${mentions}x on Reddit (WSB, r/stocks, r/investing)`,
      `Rank #${rank} (was #${prevRank} 24h ago)`,
      `24h mentions: ${mentions} (was ${prevMentions})`,
    ];
    const items: SentimentItem[] = headlines.map(text => ({ text, score: 0 }));

    return {
      name: 'ApeWisdom (Reddit)',
      kind: 'attention',
      score: Math.max(-1, Math.min(1, score)),
      count: mentions,
      headlines,
      items,
      detail,
      attention: {
        label: 'Reddit mentions',
        detail,
        trend: changePct === null ? 'unknown' : changePct > 10 ? 'rising' : changePct < -10 ? 'fading' : 'steady',
      },
    };
  } catch {
    return emptySource('ApeWisdom (Reddit)', 'attention');
  }
}

// --- Source: SocialTickers (aggregated social score) ------------------
// Free, no API key, CORS-open. Social score 0-100.

async function fetchSocialTickers(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://socialtickers.com/api/v1/asset/${symbol}`;
    const res = await proxyFetch(url, 8000);
    const data = await res.json();

    if (!data || !data.ticker) {
      return emptySource('SocialTickers', 'attention');
    }

    const mentions = typeof data.mentions === 'number' ? data.mentions : 0;
    const upvotes = typeof data.upvotes === 'number' ? data.upvotes : 0;
    if (!mentions && !upvotes) {
      return emptySource('SocialTickers', 'attention');
    }

    const headlines: string[] = [
      `${mentions.toLocaleString()} mentions`,
      `${upvotes.toLocaleString()} upvotes`,
    ];

    return {
      name: 'SocialTickers',
      kind: 'attention',
      score: 0,
      count: Math.max(mentions, 1),
      headlines,
      items: headlines.map(text => ({ text, score: 0 })),
      detail: headlines.join(' · '),
    };
  } catch {
    return emptySource('SocialTickers', 'attention');
  }
}

// --- Source: Finnhub social sentiment --------------------------------
// Requires server-side proxy + FINNHUB_API_KEY env var

async function fetchFinnhubSentiment(symbol: string): Promise<SourceResult> {
  try {
    const url = `/api/finnhub/sentiment?symbol=${symbol}`;
    const res = await fetch(url);
    if (!res.ok) return { name: 'Finnhub', score: 0, count: 0, headlines: [] };

    const data = await res.json();
    const reddit = data?.reddit ?? [];
    const stocktwits = data?.stocktwits ?? [];

    const items: SentimentItem[] = [];

    if (Array.isArray(reddit)) {
      for (const item of reddit.slice(0, 10)) {
        const sentiment = item.sentiment ?? 50;
        const positive = item.positive ?? 0;
        const negative = item.negative ?? 0;
        items.push({
          text: `Reddit: ${item.symbol} sentiment ${sentiment}/100 (+${positive}/-${negative})`,
          score: (sentiment - 50) / 50,
        });
      }
    }

    if (Array.isArray(stocktwits)) {
      for (const item of stocktwits.slice(0, 10)) {
        const sentiment = item.sentiment ?? 50;
        const positive = item.positive ?? 0;
        const negative = item.negative ?? 0;
        items.push({
          text: `StockTwits: ${item.symbol} sentiment ${sentiment}/100 (+${positive}/-${negative})`,
          score: (sentiment - 50) / 50,
        });
      }
    }

    const score = items.length ? averageScore(items) : 0;

    return {
      name: 'Finnhub',
      kind: 'social',
      score: Math.max(-1, Math.min(1, score)),
      count: items.length,
      headlines: items.slice(0, 5).map(i => i.text),
      items,
      detail: `${items.length} social aggregates`,
    };
  } catch {
    return emptySource('Finnhub', 'social');
  }
}

// --- Source: Adanos aggregate sentiment -------------------------------
// Adanos (api.adanos.org) — Reddit/X/news/Polymarket aggregate per ticker.
// X-Api-Key auth (NOT Bearer). Verified response shape:
//   { found, buzz_score, mentions, sentiment_score (-1..1), bullish_pct,
//     bearish_pct, trend, top_subreddits: [{subreddit, mentions, sentiment_score}] }
//
// Key resolution order (secrets must NEVER be baked into the committed dist
// bundle — GitHub push protection blocks that):
//   1. `/api/api-keys` endpoint (ADANOS_API_KEY env var on Vercel — configure
//      once, every browser gets it)
//   2. per-browser Settings (localStorage `stockpulse_api_config` .adanos.api_key)

let adanosKeyPromise: Promise<string> | null = null;

function adanosKeyFromSettings(): string {
  try {
    const cfg = JSON.parse(localStorage.getItem('stockpulse_api_config') || '{}');
    const k = (cfg && cfg.adanos && cfg.adanos.api_key) || '';
    return typeof k === 'string' ? k.trim() : '';
  } catch {
    return '';
  }
}

function fetchAdanosKey(): Promise<string> {
  if (!adanosKeyPromise) {
    adanosKeyPromise = (async () => {
      try {
        const res = await fetch('/api/api-keys');
        if (res.ok) {
          const cfg = await res.json();
          const k = typeof cfg.adanosApiKey === 'string' ? cfg.adanosApiKey.trim() : '';
          if (k) return k;
        }
      } catch { /* server unreachable / cold start — retry next call */ }
      // Failure means don't cache: allow retry, fall back to Settings.
      adanosKeyPromise = null;
      return adanosKeyFromSettings();
    })();
  }
  return adanosKeyPromise;
}

async function fetchAdanosSentiment(symbol: string): Promise<SourceResult> {
  const apiKey = await fetchAdanosKey();
  if (!apiKey) return { name: 'Adanos', score: 0, count: 0, headlines: [] };
  try {
    const url = `https://api.adanos.org/reddit/stocks/v1/stock/${encodeURIComponent(symbol)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'X-Api-Key': apiKey },
      });
      if (!res.ok) return emptySource('Adanos', 'social');
      const d = await res.json();
      if (!d?.found) return emptySource('Adanos', 'social');

      const mentions: number = d.mentions ?? 0;
      const score: number = typeof d.sentiment_score === 'number'
        ? Math.max(-1, Math.min(1, d.sentiment_score))
        : 0;

      // Headlines: the top subreddits driving the sentiment, plus the trend.
      const headlines: string[] = [];
      const subs: Array<{ subreddit?: string; mentions?: number; sentiment_score?: number }> = d.top_subreddits ?? [];
      for (const s of subs.slice(0, 3)) {
        if (s?.subreddit) {
          headlines.push(`r/${s.subreddit}: ${s.mentions ?? 0} mentions, sentiment ${typeof s.sentiment_score === 'number' ? s.sentiment_score.toFixed(2) : '0.00'}`);
        }
      }
      if (d.trend) headlines.push(`Trend: ${d.trend} · buzz ${d.buzz_score ?? 0}/100`);
      if (typeof d.bullish_pct === 'number' && typeof d.bearish_pct === 'number') {
        headlines.push(`${d.bullish_pct}% bullish / ${d.bearish_pct}% bearish (7d)`);
      }

      const trend: AttentionTrend = /ris|up|surge/i.test(String(d.trend ?? ''))
        ? 'rising'
        : /fall|down|fad|declin/i.test(String(d.trend ?? ''))
          ? 'fading'
          : d.trend
            ? 'steady'
            : 'unknown';
      const buzz = typeof d.buzz_score === 'number' ? d.buzz_score : null;
      const detail = `${mentions.toLocaleString()} mentions · ${buzz === null ? 'buzz n/a' : `buzz ${buzz}/100`}${d.trend ? ` · ${d.trend}` : ''}`;

      return {
        name: 'Adanos',
        kind: 'social',
        score,
        // Weight for the aggregate: comparable to other sources (they report
        // ~5-30 items). Raw mention counts (100s-1000s) would dominate the
        // weighted average, so cap at 30.
        count: mentions > 0 ? Math.min(mentions, 30) : 1,
        headlines: headlines.slice(0, 5),
        items: headlines.slice(0, 5).map(text => ({ text, score })),
        detail,
        attention: {
          label: 'Social buzz',
          detail,
          trend,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return emptySource('Adanos', 'social');
  }
}

// --- Source: MarketWatch RSS -----------------------------------------

async function fetchMarketWatch(symbol: string, companyName?: string): Promise<SourceResult> {
  try {
    const url = 'https://feeds.marketwatch.com/marketwatch/marketpulse/';
    const res = await proxyFetch(url);
    const xml = await res.text();

    const entries = parseRssEntries(xml, 50)
      .filter(e => isRelevantToSymbol(e.title, symbol, companyName));
    const items = toItems(entries);

    return {
      name: 'MarketWatch',
      kind: 'news',
      score: averageScore(items),
      count: items.length,
      headlines: items.slice(0, 5).map(i => i.text),
      items,
      detail: items.length ? `${items.length} symbol headlines` : 'No symbol-specific headlines',
    };
  } catch {
    return emptySource('MarketWatch', 'news');
  }
}

// --- Source: CNBC RSS ------------------------------------------------

async function fetchCNBC(symbol: string, companyName?: string): Promise<SourceResult> {
  try {
    const url = `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114&q=${symbol}`;
    const res = await proxyFetch(url);
    const xml = await res.text();
    const entries = parseRssEntries(xml, 30)
      .filter(e => isRelevantToSymbol(e.title, symbol, companyName));
    const items = toItems(entries);

    return {
      name: 'CNBC',
      kind: 'news',
      score: averageScore(items),
      count: items.length,
      headlines: items.slice(0, 5).map(i => i.text),
      items,
      detail: `${items.length} recent headlines`,
    };
  } catch {
    return emptySource('CNBC', 'news');
  }
}

// --- Source: Google Trends (via server proxy) -------------------------

async function fetchGoogleTrends(symbol: string): Promise<SourceResult> {
  try {
    const url = `/api/google-trends?keyword=${encodeURIComponent(symbol + ' stock')}`;
    const res = await fetch(url);
    if (!res.ok) return emptySource('Google Trends', 'attention');

    const data = await res.json();
    const values: number[] = data.interestOverTime ?? [];
    const avg = data.avg ?? 0;
    const latest = data.latest ?? 0;
    const related: {
      top?: Array<{ query?: string }>;
      rising?: Array<{ query?: string }>;
    } = data.relatedQueries ?? { top: [], rising: [] };

    if (values.length === 0) {
      return emptySource('Google Trends', 'attention');
    }

    let score = 0;
    if (avg > 0) {
      score = (latest - avg) / avg;
      score = Math.max(-1, Math.min(1, score));
    }

    const headlines: string[] = [
      `Search interest: ${latest}/100 (4-week avg: ${avg.toFixed(0)})`,
    ];
    if (related.rising?.length > 0) {
      headlines.push(`Rising queries: ${related.rising.slice(0, 3).map(r => r.query).join(', ')}`);
    }

    const detail = `${latest}/100 · 4-week avg ${avg.toFixed(0)}`;
    const trend: AttentionTrend = avg > 0
      ? latest > avg * 1.1
        ? 'rising'
        : latest < avg * 0.9
          ? 'fading'
          : 'steady'
      : 'unknown';

    return {
      name: 'Google Trends',
      kind: 'attention',
      score,
      count: values.length,
      headlines,
      items: [{
        text: headlines[0],
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(`${symbol} stock`)}`,
        score,
      }, ...(headlines.length > 1 ? [{ text: headlines[1], score }] : [])],
      detail,
      attention: { label: 'Search interest', detail, trend },
    };
  } catch {
    return emptySource('Google Trends', 'attention');
  }
}

// --- Aggregate -------------------------------------------------------

function extractThemes(sources: SourceResult[]): string[] {
  const wordCounts = new Map<string, number>();
  for (const src of sources) {
    for (const h of src.headlines) {
      const words = h.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
      for (const w of words) {
        if (w.length < 4 || COMMON_WORDS.has(w)) continue;
        wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
      }
    }
  }
  return [...wordCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

const COMMON_WORDS = new Set([
  'that', 'with', 'this', 'have', 'from', 'they', 'been', 'said', 'each', 'which',
  'their', 'will', 'would', 'about', 'could', 'other', 'than', 'more', 'some', 'what',
  'when', 'your', 'them', 'than', 'then', 'into', 'just', 'also', 'over', 'such',
  'after', 'most', 'only', 'very', 'does', 'last', 'back', 'were', 'much', 'like',
  'stock', 'market', 'share', 'price', 'trade', 'trading', 'today', 'report', 'says',
  'may', 'its', 'are', 'has', 'not', 'but', 'can', 'for', 'the', 'and', 'that',
]);

export function aggregateSources(symbol: string, allSources: SourceResult[]): AggregatedSentiment {
  const sources = allSources.filter(s => s.count > 0);
  const unavailableSources = allSources.filter(s => s.count === 0).map(s => s.name);
  const directional = sources.filter(s => s.kind !== 'attention');
  const totalItems = directional.reduce((a, s) => a + s.count, 0);

  const weightOf = (s: SourceResult) => Math.min(s.count, 30);
  const totalWeight = directional.reduce((a, s) => a + weightOf(s), 0);
  const avgScore = totalWeight > 0
    ? directional.reduce((a, s) => a + s.score * weightOf(s), 0) / totalWeight
    : 0;

  const sentiment = toneOf(avgScore);
  const agreement = computeAgreement(sources, sentiment);
  const coverage = Math.min(directional.length / 6, 1);
  const volume = Math.min(totalItems / 40, 1);
  const strength = Math.min(Math.abs(avgScore) / 0.3, 1);
  const confidence = Math.min(95, Math.round(
    coverage * 25 + volume * 20 + strength * 25 + agreement * 30,
  ));

  const { retail, news } = computeGroupScores(sources);
  const divergence = detectDivergence(retail, news);
  const attention = sources.find(s => s.attention)?.attention ?? null;
  const keyQuotes = rankKeyQuotes(directional, 5);
  const themes = extractThemes(directional);

  const summary = directional.length > 0
    ? `Aggregated ${totalItems} scored items from ${directional.map(s => s.name).join(', ')}. Overall tone is ${sentiment} with ${confidence}% confidence.`
    : `No directional social or news data available for ${symbol} at this time.`;

  const briefSummary = generateBriefSummary({
    symbol,
    sentiment,
    sources,
    retail,
    news,
    divergence,
    agreement,
    attention,
    totalItems,
  });

  return {
    sentiment,
    confidence,
    sources,
    totalItems,
    themes,
    keyQuotes,
    retail,
    news,
    divergence,
    agreement,
    attention,
    unavailableSources,
    briefSummary,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

export async function fetchSentiment(symbol: string, companyName?: string): Promise<AggregatedSentiment> {
  const settled = await Promise.allSettled([
    fetchGoogleNews(symbol, companyName),
    fetchStockTwits(symbol),
    fetchYahooNews(symbol, companyName),
    fetchApeWisdom(symbol),
    fetchSocialTickers(symbol),
    fetchFinnhubSentiment(symbol),
    fetchMarketWatch(symbol, companyName),
    fetchCNBC(symbol, companyName),
    fetchGoogleTrends(symbol),
    fetchAdanosSentiment(symbol),
  ]);

  const fallbacks: Array<[string, SourceKind]> = [
    ['Google News', 'news'],
    ['StockTwits', 'social'],
    ['Yahoo Finance', 'news'],
    ['ApeWisdom (Reddit)', 'attention'],
    ['SocialTickers', 'social'],
    ['Finnhub', 'social'],
    ['MarketWatch', 'news'],
    ['CNBC', 'news'],
    ['Google Trends', 'attention'],
    ['Adanos', 'social'],
  ];

  const allSources = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const [name, kind] = fallbacks[i];
    return emptySource(name, kind);
  });

  return aggregateSources(symbol, allSources);
}

interface BriefSummaryInput {
  symbol: string;
  sentiment: SentimentTone;
  sources: SourceResult[];
  retail: GroupScore | null;
  news: GroupScore | null;
  divergence: Divergence;
  agreement: number;
  attention: AttentionInfo | null;
  totalItems: number;
}

function generateBriefSummary({
  symbol,
  sentiment,
  sources,
  retail,
  news,
  divergence,
  agreement,
  attention,
  totalItems,
}: BriefSummaryInput): string {
  const directionalCount = sources.filter(s => s.kind !== 'attention').length;

  if (totalItems === 0) {
    return attention
      ? `No directional chatter on ${symbol} right now — ${attention.label.toLowerCase()} is ${attention.trend} (${attention.detail}).`
      : `No live social or news data for ${symbol} right now.`;
  }

  const label = sentiment === 'bullish' ? 'Bullish' : sentiment === 'bearish' ? 'Bearish' : 'Neutral';
  const parts = [
    `${label} tone on ${symbol} — ${totalItems} scored items from ${directionalCount} live source${directionalCount === 1 ? '' : 's'}, ${Math.round(agreement * 100)}% agreement.`,
  ];

  if (retail && news) {
    const relation = divergence === 'aligned'
      ? 'in line with'
      : divergence === 'retail-more-bullish'
        ? 'more bullish than'
        : divergence === 'retail-more-bearish'
          ? 'more bearish than'
          : null;
    parts.push(relation
      ? `Retail chatter is ${relation} financial news (${formatPct(retail.score)} vs ${formatPct(news.score)}).`
      : `Retail ${formatPct(retail.score)} vs financial news ${formatPct(news.score)}.`);
  } else if (retail) {
    parts.push(`No financial-news read; retail chatter alone is ${toneOf(retail.score)} (${formatPct(retail.score)}).`);
  } else if (news) {
    parts.push(`No retail read; financial news alone is ${toneOf(news.score)} (${formatPct(news.score)}).`);
  }

  if (attention && attention.trend !== 'unknown') {
    parts.push(`${attention.label} is ${attention.trend} (${attention.detail}).`);
  }

  return parts.join(' ');
}
