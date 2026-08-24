// Multi-source local sentiment analysis — no Supabase/AI needed

const SERVER_PROXY = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url: string, timeoutMs = 5000): Promise<Response> {
  // 1. Direct
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* CORS blocked — try proxies */ }

  // 2. Server-side proxy
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(SERVER_PROXY(url), { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return res;
  } catch { /* server proxy unavailable */ }

  // 3. Third-party CORS proxies (legacy fallback)
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

// ─── Keyword-based sentiment scoring ────────────────────────────────

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

  // Also check multi-word phrases
  const lower = text.toLowerCase();
  const bullishPhrases = ['record high', 'all-time high', 'strong buy', 'revenue growth', 'raise target', 'guidance raise'];
  const bearishPhrases = ['record low', 'sell-off', 'selloff', 'revenue decline', 'guidance cut', 'lower guidance', 'debt crisis'];

  for (const p of bullishPhrases) { if (lower.includes(p)) bullishHits.push(p); }
  for (const p of bearishPhrases) { if (lower.includes(p)) bearishHits.push(p); }

  const total = bullishHits.length + bearishHits.length || 1;
  const score = (bullishHits.length - bearishHits.length) / total;
  return { score, bullishHits, bearishHits };
}

// ─── Source: Google News RSS ─────────────────────────────────────────

async function fetchGoogleNews(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://news.google.com/rss/search?q=${symbol}+stock&hl=en-US&gl=US&ceid=US:en`;
    const res = await proxyFetch(url);
    const xml = await res.text();

    // Parse RSS items
    const items: string[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 30) {
      const titleMatch = match[1].match(/<title>(.*?)<\/title>/);
      if (titleMatch) {
        items.push(titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
      }
    }

    let totalScore = 0;
    let count = 0;
    const headlines: string[] = [];

    for (const item of items) {
      const { score } = scoreText(item);
      totalScore += score;
      count++;
      headlines.push(item);
    }

    return {
      name: 'Google News',
      score: count > 0 ? totalScore / count : 0,
      count,
      headlines: headlines.slice(0, 5),
    };
  } catch {
    return { name: 'Google News', score: 0, count: 0, headlines: [] };
  }
}

// ─── Source: StockTwits ──────────────────────────────────────────────

async function fetchStockTwits(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`;
    const res = await proxyFetch(url);
    const data = await res.json();
    const messages = data?.messages ?? [];

    let totalScore = 0;
    let count = 0;
    const headlines: string[] = [];

    for (const msg of messages.slice(0, 30)) {
      const text = msg.body ?? '';
      if (!text) continue;
      const { score } = scoreText(text);
      totalScore += score;
      count++;
      headlines.push(text.slice(0, 120));
    }

    return {
      name: 'StockTwits',
      score: count > 0 ? totalScore / count : 0,
      count,
      headlines: headlines.slice(0, 5),
    };
  } catch {
    return { name: 'StockTwits', score: 0, count: 0, headlines: [] };
  }
}

// ─── Source: Yahoo Finance trending + news page ──────────────────────

async function fetchYahooNews(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&quotes_count=0&news_count=20`;
    const res = await proxyFetch(url);
    const data = await res.json();
    const news = data?.news ?? [];

    let totalScore = 0;
    let count = 0;
    const headlines: string[] = [];

    for (const item of news) {
      const title = item.title ?? '';
      if (!title) continue;
      const { score } = scoreText(title);
      totalScore += score;
      count++;
      headlines.push(title);
    }

    return {
      name: 'Yahoo Finance',
      score: count > 0 ? totalScore / count : 0,
      count,
      headlines: headlines.slice(0, 5),
    };
  } catch {
    return { name: 'Yahoo Finance', score: 0, count: 0, headlines: [] };
  }
}

// ─── Source: Twitter/X (public syndication search) ───────────────────

async function fetchTwitter(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/search?q=%24${symbol}`;
    const res = await proxyFetch(url);
    const html = await res.text();

    // Extract tweet text from syndication HTML
    const tweets: string[] = [];
    const tweetRegex = /<p[^>]*class="[^"]*timeline-Tweet-text[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    while ((match = tweetRegex.exec(html)) !== null && tweets.length < 30) {
      const text = match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      if (text) tweets.push(text);
    }

    // Fallback: try extracting from data-tweet-id divs
    if (tweets.length === 0) {
      const altRegex = /data-tweet-id="[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g;
      while ((match = altRegex.exec(html)) !== null && tweets.length < 30) {
        const text = match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
        if (text) tweets.push(text);
      }
    }

    // Fallback 2: extract any text content that looks like tweets
    if (tweets.length === 0) {
      const textBlocks = html.match(/<div[^>]*class="[^"]*tweet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) ?? [];
      for (const block of textBlocks.slice(0, 30)) {
        const text = block.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
        if (text.length > 20) tweets.push(text.slice(0, 200));
      }
    }

    let totalScore = 0;
    let count = 0;
    const headlines: string[] = [];

    for (const tweet of tweets) {
      const { score } = scoreText(tweet);
      totalScore += score;
      count++;
      headlines.push(tweet.slice(0, 120));
    }

    return {
      name: 'Twitter/X',
      score: count > 0 ? totalScore / count : 0,
      count,
      headlines: headlines.slice(0, 5),
    };
  } catch {
    return { name: 'Twitter/X', score: 0, count: 0, headlines: [] };
  }
}

// ─── Source: Reddit (r/wallstreetbets only — 1 fast call) ────────────

async function fetchReddit(symbol: string): Promise<SourceResult> {
  try {
    const url = `https://www.reddit.com/r/wallstreetbets/search.json?q=${symbol}&sort=new&limit=25&restrict_sr=1`;
    const res = await proxyFetch(url);
    const data = await res.json();
    const posts = data?.data?.children ?? [];

    let totalScore = 0;
    let count = 0;
    const headlines: string[] = [];

    for (const post of posts) {
      const title = post.data?.title ?? '';
      const selftext = post.data?.selftext?.slice(0, 200) ?? '';
      const combined = `${title} ${selftext}`.trim();
      if (!combined) continue;
      const { score } = scoreText(combined);
      totalScore += score;
      count++;
      headlines.push(combined.slice(0, 120));
    }

    return {
      name: 'Reddit (WSB)',
      score: count > 0 ? totalScore / count : 0,
      count,
      headlines: headlines.slice(0, 5),
    };
  } catch {
    return { name: 'Reddit (WSB)', score: 0, count: 0, headlines: [] };
  }
}

// ─── Source: YouTube (RSS feed for stock-related video titles) ───────

async function fetchYouTube(symbol: string): Promise<SourceResult> {
  try {
    // YouTube public RSS search via Google Video search RSS
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=UCentqG1R2waqJM1gKm9q7xw`;
    // Alternative: use Invidious API (no auth, public instances)
    const invidiousUrls = [
      `https://vid.puffyan.us/api/v1/search?q=${symbol}+stock&type=video&sort_by=relevance`,
      `https://invidious.fdn.fr/api/v1/search?q=${symbol}+stock&type=video&sort_by=relevance`,
      `https://inv.nadeko.net/api/v1/search?q=${symbol}+stock&type=video&sort_by=relevance`,
    ];

    let videos: { title: string }[] = [];

    for (const apiUrl of invidiousUrls) {
      try {
        const res = await proxyFetch(apiUrl);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          videos = data.slice(0, 15).map((v: any) => ({ title: v.title ?? '' }));
          break;
        }
      } catch { continue; }
    }

    let totalScore = 0;
    let count = 0;
    const headlines: string[] = [];

    for (const v of videos) {
      if (!v.title) continue;
      const { score } = scoreText(v.title);
      totalScore += score;
      count++;
      headlines.push(v.title);
    }

    return {
      name: 'YouTube',
      score: count > 0 ? totalScore / count : 0,
      count,
      headlines: headlines.slice(0, 5),
    };
  } catch {
    return { name: 'YouTube', score: 0, count: 0, headlines: [] };
  }
}

// ─── Aggregate ───────────────────────────────────────────────────────

export interface SourceResult {
  name: string;
  score: number; // -1 to 1
  count: number;
  headlines: string[];
}

export interface AggregatedSentiment {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  sources: SourceResult[];
  totalItems: number;
  themes: string[];
  briefSummary: string;
  summary: string;
  checkedAt: string;
}

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

export async function fetchSentiment(symbol: string): Promise<AggregatedSentiment> {
  const results = await Promise.allSettled([
    fetchGoogleNews(symbol),
    fetchStockTwits(symbol),
    fetchYahooNews(symbol),
    fetchTwitter(symbol),
    fetchReddit(symbol),
    fetchYouTube(symbol),
  ]);

  const sources = results
    .filter((r): r is PromiseFulfilledResult<SourceResult> => r.status === 'fulfilled' && r.value.count > 0)
    .map(r => r.value);

  const totalItems = sources.reduce((a, s) => a + s.count, 0);

  // Weighted average: give more weight to sources with more data
  let weightedScore = 0;
  let totalWeight = 0;
  for (const src of sources) {
    weightedScore += src.score * src.count;
    totalWeight += src.count;
  }
  const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (avgScore > 0.08) sentiment = 'bullish';
  else if (avgScore < -0.08) sentiment = 'bearish';

  // Confidence based on: number of sources, number of items, and strength of signal
  const sourceCount = sources.length;
  const coverageScore = Math.min(sourceCount / 5, 1); // 5+ sources = full coverage
  const volumeScore = Math.min(totalItems / 40, 1); // 40+ items = full volume
  const strengthScore = Math.min(Math.abs(avgScore) / 0.3, 1); // 0.3+ = strong signal
  const confidence = Math.round(
    (coverageScore * 30 + volumeScore * 30 + strengthScore * 40)
  );

  const themes = extractThemes(sources);

  const sentimentLabel = sentiment === 'bullish' ? 'Bullish' : sentiment === 'bearish' ? 'Bearish' : 'Neutral';
  const sourceNames = sources.map(s => s.name).join(', ');
  const summary = sources.length > 0
    ? `Aggregated ${totalItems} mentions from ${sourceNames}. Overall sentiment is ${sentimentLabel.toLowerCase()} with ${confidence}% confidence.`
    : `No social media data available for ${symbol} at this time. Try again later.`;

  // Analyst-style brief summary
  const briefSummary = generateBriefSummary(symbol, sentiment, confidence, sources, themes, avgScore);

  return {
    sentiment,
    confidence: Math.min(confidence, 95),
    sources,
    totalItems,
    themes,
    briefSummary,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

function generateBriefSummary(
  symbol: string,
  sentiment: 'bullish' | 'bearish' | 'neutral',
  confidence: number,
  sources: SourceResult[],
  themes: string[],
  avgScore: number,
): string {
  if (sources.length === 0) {
    return `No social media or news data available for ${symbol} at this time. Sentiment analysis requires at least one active data source.`;
  }

  const totalItems = sources.reduce((a, s) => a + s.count, 0);
  const allHeadlines = sources.flatMap(s => s.headlines);
  const topics = extractTopics(allHeadlines);
  const bullishSources = sources.filter(s => s.score > 0.08);
  const bearishSources = sources.filter(s => s.score < -0.08);
  const strongest = sources.reduce((a, b) => a.score > b.score ? a : b);
  const weakest = sources.reduce((a, b) => a.score < b.score ? a : b);

  // ── Opening paragraph ───────────────────────────────────────────
  const srcNames = sources.map(s => s.name).join(', ');
  const parts: string[] = [];

  if (sentiment === 'bullish') {
    parts.push(
      `Based on an analysis of ${totalItems} mentions across ${srcNames}, the prevailing sentiment around ${symbol} is bullish. ` +
      `${bullishSources.length} of ${sources.length} data sources registered a positive tone, suggesting that market participants are positioning for near-term upside. ` +
      `The aggregate sentiment score of ${(avgScore * 100).toFixed(1)}% reflects a meaningful lean toward optimism rather than mere noise.`
    );
  } else if (sentiment === 'bearish') {
    parts.push(
      `Based on an analysis of ${totalItems} mentions across ${srcNames}, the prevailing sentiment around ${symbol} is bearish. ` +
      `${bearishSources.length} of ${sources.length} data sources registered a negative tone, indicating that investors and traders are increasingly cautious. ` +
      `The aggregate sentiment score of ${(avgScore * 100).toFixed(1)}% signals meaningful selling pressure or risk-off positioning in social and news channels.`
    );
  } else {
    const mixed = bullishSources.length > 0 && bearishSources.length > 0;
    parts.push(
      mixed
        ? `Based on an analysis of ${totalItems} mentions across ${srcNames}, sentiment on ${symbol} is divided. ` +
          `${bullishSources.length} source(s) lean positive while ${bearishSources.length} lean negative, resulting in a neutral aggregate. ` +
          `This type of split often precedes a directional breakout as the market digests competing narratives.`
        : `Based on an analysis of ${totalItems} mentions across ${srcNames}, sentiment on ${symbol} is flat. ` +
          `No strong directional conviction was detected across social media or news outlets. ` +
          `This could indicate a period of consolidation or a lack of meaningful catalysts in the current news cycle.`
    );
  }

  // ── Catalyst paragraph ──────────────────────────────────────────
  if (topics.catalysts.length > 0) {
    const catalystList = topics.catalysts.slice(0, 4).join(', ');
    parts.push(
      `Key catalysts driving the conversation include ${catalystList}. ` +
      `These themes are dominating social feeds and news headlines, shaping the directional bias for ${symbol} in the near term.`
    );
  }

  // ── Bull/bear evidence paragraph ────────────────────────────────
  if (topics.priceTalk.bullish.length > 0 || topics.priceTalk.bearish.length > 0) {
    const evidenceParts: string[] = [];
    if (topics.priceTalk.bullish.length > 0) {
      evidenceParts.push(
        `On the bullish side, notable mentions include: "${topics.priceTalk.bullish[0].slice(0, 80)}"` +
        (topics.priceTalk.bullish.length > 1 ? ` and "${topics.priceTalk.bullish[1].slice(0, 80)}"` : '')
      );
    }
    if (topics.priceTalk.bearish.length > 0) {
      evidenceParts.push(
        `On the bearish side, concerns center on: "${topics.priceTalk.bearish[0].slice(0, 80)}"` +
        (topics.priceTalk.bearish.length > 1 ? ` and "${topics.priceTalk.bearish[1].slice(0, 80)}"` : '')
      );
    }
    parts.push(`The narrative tug-of-war is clear. ${evidenceParts.join(' Meanwhile, ')}.`);
  }

  // ── Source breakdown paragraph ──────────────────────────────────
  if (sources.length >= 2) {
    const srcBreakdown = sources.map(s => {
      const tone = s.score > 0.08 ? 'bullish' : s.score < -0.08 ? 'bearish' : 'neutral';
      return `${s.name} (${tone}, ${s.count} items)`;
    }).join(', ');
    parts.push(
      `Source-level breakdown: ${srcBreakdown}. ` +
      `${strongest.name} is the most optimistic signal at +${(strongest.score * 100).toFixed(0)}%, ` +
      `while ${weakest.name} is the most cautious at ${(weakest.score * 100).toFixed(0)}%.`
    );
  }

  // ── Confidence and actionable closing ───────────────────────────
  if (confidence >= 70) {
    parts.push(
      `Confidence is high at ${confidence}%, supported by strong coverage across multiple independent platforms. ` +
      `The convergence of signals suggests this is a reliable sentiment reading worth factoring into your analysis.`
    );
  } else if (confidence >= 40) {
    parts.push(
      `Moderate confidence at ${confidence}% — the signal is present but not overwhelming. ` +
      `Cross-reference this with technicals and fundamentals before acting on sentiment alone.`
    );
  } else {
    parts.push(
      `Low confidence at ${confidence}% — data coverage is sparse or contradictory. ` +
      `This reading should be treated as preliminary and may shift materially as more data becomes available.`
    );
  }

  // ── Final actionable take ───────────────────────────────────────
  if (sentiment === 'bullish' && confidence >= 50) {
    parts.push(
      `Takeaway: Social sentiment supports a bullish lean on ${symbol}. ` +
      `Watch for confirmation from price action — a break above recent resistance on elevated volume would validate the positive social momentum.`
    );
  } else if (sentiment === 'bearish' && confidence >= 50) {
    parts.push(
      `Takeaway: Social sentiment supports a bearish lean on ${symbol}. ` +
      `Watch for confirmation from price action — a break below recent support would validate the negative social momentum. ` +
      `Contrarian traders may view extreme bearishness as a potential contrarian signal if fundamentals remain intact.`
    );
  } else if (sentiment === 'neutral') {
    parts.push(
      `Takeaway: No clear social edge on ${symbol} at this time. ` +
      `Wait for a clearer signal — either a catalyst-driven shift in sentiment or a decisive technical breakout — before committing capital based on social data.`
    );
  }

  return parts.join('\n\n');
}

// ─── Topic extraction from headlines ─────────────────────────────────

interface Topics {
  catalysts: string[];
  priceTalk: { bullish: string[]; bearish: string[] };
}

function extractTopics(headlines: string[]): Topics {
  const catalysts: string[] = [];
  const bullish: string[] = [];
  const bearish: string[] = [];

  // Catalyst patterns
  const catalystPatterns = [
    { regex: /earnings|revenue|profit|eps|quarterly/i, label: 'earnings report' },
    { regex: /upgrade|upgraded|raise.*target|price target.*\$/i, label: 'analyst upgrade' },
    { regex: /downgrade|downgraded|cut.*target|lower.*target/i, label: 'analyst downgrade' },
    { regex: /federal\s*reserve|fed|rate\s*cut|rate\s*hike|interest\s*rate/i, label: 'Fed/rates' },
    { regex: /tariff|trade\s*war|sanction|import\s*duty/i, label: 'tariffs/trade' },
    { regex: /acquisition|acquire|merger|deal|buyout/i, label: 'M&A activity' },
    { regex: /dividend|buyback|share\s*repurchase/i, label: 'capital return' },
    { regex: /ipo|listing|going\s*public/i, label: 'IPO' },
    { regex: /launch|new\s*product|release|unveil/i, label: 'product launch' },
    { regex: /partnership|collaboration|joint\s*venture/i, label: 'partnership' },
    { regex: /lawsuit|sec|investigation|regulat/i, label: 'regulatory/legal' },
    { regex: /layoff|job\s*cut|restructur/i, label: 'restructuring' },
    { regex: /insider\s*(buy|sell)|ceo\s*(buy|sell)/i, label: 'insider activity' },
    { regex: /guidance|forecast|outlook|projection/i, label: 'guidance update' },
  ];

  const seen = new Set<string>();

  for (const h of headlines) {
    for (const { regex, label } of catalystPatterns) {
      if (regex.test(h) && !seen.has(label)) {
        catalysts.push(label);
        seen.add(label);
      }
    }

    // Price direction extraction
    const lower = h.toLowerCase();
    if (/\b(bull|buy|long|upside|surge|rally|beat|upgrade|record high)\b/i.test(h)) {
      if (bullish.length < 3) bullish.push(h.slice(0, 80));
    }
    if (/\b(bear|sell|short|downside|crash|miss|downgrade|fear)\b/i.test(h)) {
      if (bearish.length < 3) bearish.push(h.slice(0, 80));
    }
  }

  return { catalysts, priceTalk: { bullish, bearish } };
}
