import { describe, expect, it } from 'vitest';
import {
  aggregateSources,
  computeAgreement,
  computeGroupScores,
  detectDivergence,
  isRelevantToSymbol,
  rankKeyQuotes,
  toneOf,
  type AttentionInfo,
  type SentimentItem,
  type SourceKind,
  type SourceResult,
} from './sentimentAnalysis';

function item(
  text: string,
  score: number,
  extra: Partial<SentimentItem> = {},
): SentimentItem {
  return { text, score, ...extra };
}

function source(
  name: string,
  kind: SourceKind,
  score: number,
  items: SentimentItem[],
  extra: Partial<SourceResult> = {},
): SourceResult {
  return {
    name,
    kind,
    score,
    count: items.length,
    headlines: items.map(i => i.text),
    items,
    ...extra,
  };
}

function attentionSource(detail = '500 mentions · rank #3'): SourceResult {
  const attention: AttentionInfo = {
    label: 'Reddit mentions',
    detail,
    trend: 'rising',
  };
  return source('ApeWisdom (Reddit)', 'attention', -1, [item('mentions', 0)], {
    count: 500,
    attention,
  });
}

describe('toneOf', () => {
  it('maps scores to tones at the documented thresholds', () => {
    expect(toneOf(0.09)).toBe('bullish');
    expect(toneOf(0.08)).toBe('neutral');
    expect(toneOf(-0.09)).toBe('bearish');
    expect(toneOf(-0.08)).toBe('neutral');
    expect(toneOf(0)).toBe('neutral');
  });
});

describe('isRelevantToSymbol', () => {
  it('matches the ticker or a company-name token', () => {
    expect(isRelevantToSymbol('Apple (AAPL) stock jumps', 'AAPL')).toBe(true);
    expect(isRelevantToSymbol('Apple gets a downgrade', 'AAPL', 'Apple Inc.')).toBe(true);
    expect(isRelevantToSymbol('SpaceX shares soar on Tesla tie-up', 'AAPL', 'Apple Inc.')).toBe(false);
    expect(isRelevantToSymbol('Meta Platforms beats estimates', 'META', 'Meta Platforms, Inc.')).toBe(true);
  });

  it('avoids false positives for one-letter tickers', () => {
    expect(isRelevantToSymbol('A big market rally', 'A', 'Agilent Technologies Inc.')).toBe(false);
    expect(isRelevantToSymbol('Agilent raises guidance', 'A', 'Agilent Technologies Inc.')).toBe(true);
  });
});

describe('computeGroupScores', () => {
  it('splits retail from financial news and ignores attention sources', () => {
    const { retail, news } = computeGroupScores([
      source('Google News', 'news', 0.4, [item('a', 0.4)]),
      source('Yahoo Finance', 'news', 0.2, [item('b', 0.2)]),
      source('StockTwits', 'social', -0.6, [item('c', -0.6), item('d', -0.6)]),
      attentionSource(),
    ]);

    expect(retail).not.toBeNull();
    expect(retail!.score).toBeCloseTo(-0.6);
    expect(retail!.items).toBe(2);
    expect(retail!.sources).toBe(1);

    expect(news).not.toBeNull();
    expect(news!.score).toBeCloseTo(0.3);
    expect(news!.items).toBe(2);
    expect(news!.sources).toBe(2);
  });

  it('returns null when a side has no live sources', () => {
    const { retail, news } = computeGroupScores([
      source('Google News', 'news', 0.2, [item('a', 0.2)]),
    ]);
    expect(retail).toBeNull();
    expect(news?.items).toBe(1);
  });
});

describe('detectDivergence', () => {
  it('flags retail ahead of the news when signs differ', () => {
    expect(detectDivergence(
      { score: 0.5, items: 10, sources: 2 },
      { score: -0.3, items: 8, sources: 2 },
    )).toBe('retail-more-bullish');
    expect(detectDivergence(
      { score: -0.5, items: 10, sources: 2 },
      { score: 0.3, items: 8, sources: 2 },
    )).toBe('retail-more-bearish');
  });

  it('marks aligned and unknown cases', () => {
    expect(detectDivergence(
      { score: 0.4, items: 10, sources: 2 },
      { score: 0.2, items: 8, sources: 2 },
    )).toBe('aligned');
    expect(detectDivergence(
      { score: 0.4, items: 2, sources: 1 },
      { score: -0.2, items: 8, sources: 2 },
    )).toBe('unknown');
    expect(detectDivergence(
      { score: 0.05, items: 10, sources: 2 },
      { score: -0.3, items: 8, sources: 2 },
    )).toBe('unknown');
  });
});

describe('computeAgreement', () => {
  it('counts only directional sources that match the call', () => {
    const sources = [
      source('Google News', 'news', 0.5, [item('a', 0.5)]),
      source('StockTwits', 'social', 0.4, [item('b', 0.4)]),
      source('CNBC', 'news', -0.4, [item('c', -0.4)]),
      attentionSource(),
    ];
    expect(computeAgreement(sources, 'bullish')).toBeCloseTo(2 / 3);
    expect(computeAgreement(sources, 'neutral')).toBe(0);
  });

  it('returns zero without directional sources', () => {
    expect(computeAgreement([attentionSource()], 'neutral')).toBe(0);
  });
});

describe('rankKeyQuotes', () => {
  it('dedupes quotes, surfaces both sides, and respects the limit', () => {
    const sources = [
      source('StockTwits', 'social', 0.5, [
        item('$ACME breakout looks strong', 0.8, { label: 'Bullish', url: 'https://example.com/1' }),
        item('$ACME breakout looks strong', 0.8),
        item('$ACME calls are cheap', 0.2),
      ]),
      source('Google News', 'news', -0.3, [
        item('ACME warns on margins', -0.9, { url: 'https://example.com/2' }),
        item('ACME faces a probe', -0.7),
      ]),
    ];

    const quotes = rankKeyQuotes(sources, 3);
    expect(quotes).toHaveLength(3);
    expect(quotes[0].tone).toBe('bullish');
    expect(quotes[1].tone).toBe('bearish');
    expect(new Set(quotes.map(q => q.text)).size).toBe(quotes.length);
    expect(quotes[0].source).toBe('StockTwits');
    expect(quotes[0].url).toBe('https://example.com/1');
  });
});

describe('aggregateSources', () => {
  const bullishNews = source('Google News', 'news', 0.6, [
    item('ACME beats estimates', 0.6),
    item('ACME raises guidance', 0.6),
    item('ACME announces buyback', 0.6),
    item('ACME hits record high', 0.6),
  ]);
  const bullishYahoo = source('Yahoo Finance', 'news', 0.5, [
    item('ACME upgrade to overweight', 0.5),
    item('ACME growth accelerates', 0.5),
  ]);
  const bullishRetail = source('StockTwits', 'social', 0.4, [
    item('$ACME squeeze setup', 0.4, { label: 'Bullish' }),
    item('$ACME long into earnings', 0.4),
    item('$ACME trend is up', 0.4),
  ]);
  const missing = {
    name: 'Finnhub',
    kind: 'social' as const,
    score: 0,
    count: 0,
    headlines: [],
  };

  it('builds a directional read from live sources and excludes attention from direction', () => {
    const result = aggregateSources('ACME', [
      bullishNews,
      bullishYahoo,
      bullishRetail,
      attentionSource(),
      missing,
    ]);

    expect(result.sentiment).toBe('bullish');
    expect(result.totalItems).toBe(9);
    expect(result.sources.map(s => s.name)).not.toContain('Finnhub');
    expect(result.unavailableSources).toEqual(['Finnhub']);
    expect(result.retail?.items).toBe(3);
    expect(result.news?.items).toBe(6);
    expect(result.retail?.score).toBeCloseTo(0.4);
    expect(result.news?.score).toBeCloseTo((0.6 * 4 + 0.5 * 2) / 6);
    expect(result.divergence).toBe('aligned');
    expect(result.attention?.label).toBe('Reddit mentions');
    expect(result.keyQuotes.length).toBeGreaterThan(0);
    expect(result.keyQuotes.length).toBeLessThanOrEqual(5);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(95);
    expect(result.briefSummary).toContain('ACME');
    expect(result.briefSummary).toContain('scored items');
  });

  it('does not let attention volume flip the directional call', () => {
    const result = aggregateSources('ACME', [
      source('CNBC', 'news', 0.2, [item('ACME steady', 0.2)]),
      attentionSource('10,000 mentions · rank #1'),
    ]);

    expect(result.totalItems).toBe(1);
    expect(result.sentiment).toBe('bullish');
  });

  it('handles attention-only and fully empty results honestly', () => {
    const attentionOnly = aggregateSources('ZZZ', [attentionSource()]);
    expect(attentionOnly.totalItems).toBe(0);
    expect(attentionOnly.sentiment).toBe('neutral');
    expect(attentionOnly.briefSummary).toContain('No directional chatter');

    const empty = aggregateSources('ZZZ', [missing]);
    expect(empty.sources).toHaveLength(0);
    expect(empty.sentiment).toBe('neutral');
    expect(empty.briefSummary).toContain('No live social or news data');
    expect(empty.unavailableSources).toEqual(['Finnhub']);
  });
});
