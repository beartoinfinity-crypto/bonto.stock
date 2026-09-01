// Rule-based port of the ai-hedge-fund PEAD (Post-Earnings Announcement Drift)
// alpha model. Forms a view from quarterly earnings surprises: bullish after a
// BEAT, bearish after a MISS, on the theory the market underreacts and the stock
// keeps drifting in the surprise direction for weeks. Pure math — no AI/ML/LLM.

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type EarningsSurpriseDirection = 'BEAT' | 'MISS' | 'INLINE';

export interface QuarterlyEarnings {
  /** Yahoo-style period label, e.g. "1Q2024" (or "Q1 2024"). */
  period: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null; // actual minus estimate, absolute EPS
  surprisePercent: number | null; // surprise as % of estimate
}

export interface PEADEvent {
  period: string;
  quarterEnd: string | null; // ISO date of the quarter end (approx filing point)
  surprise: number | null;
  surprisePercent: number | null;
  direction: EarningsSurpriseDirection;
}

export interface PEADResult {
  symbol: string;
  asOf: string;
  recentEvent: PEADEvent | null;
  /** Whether the drift window around the most recent qualifying event is still fresh. */
  windowOpen: boolean;
  /** Conviction in [-1, +1]. 0 means "no view" (abstain). */
  signal: number;
  direction: EarningsSurpriseDirection | 'NO_VIEW';
  reasoning: string;
  history: PEADEvent[];
}

export interface PEADOptions {
  /** Events older than this many days are treated as no-longer-fresh (drift expired). */
  windowDays?: number;
  /** Surprise % that maps to full ±1 conviction (beyond it saturates). */
  fullConvictionPct?: number;
  /** Absolute surprise % below this is considered INLINE (no drift). */
  inlineBandPct?: number;
}

/** Thresholds — f(config): tolerance for treating a surprise as effectively flat. */
const DEFAULT_INLINE_BAND_PCT = 1;

// Quarter number -> last calendar day of that quarter.
const QUARTER_END: Record<number, { month: number; day: number }> = {
  1: { month: 2, day: 31 },
  2: { month: 5, day: 30 },
  3: { month: 8, day: 30 },
  4: { month: 11, day: 31 },
};

/**
 * Parse a period label like "1Q2024" or "Q1 2024" into the last day of that
 * quarter (as an ISO date). Returns null if the label can't be understood.
 */
export function parseQuarterEnd(period: string): string | null {
  const m = /(?:(\d)[Qq]|Q[Qq]?(\d))\s*[-/]?\s*(20\d\d)/.exec(period.trim().replace(/\s+/g, ' '));
  const qNum = m ? Number(m[1] ?? m[2]) : NaN;
  const year = m ? Number(m[3]) : NaN;
  if (!Number.isFinite(qNum) || qNum < 1 || qNum > 4 || !Number.isFinite(year)) return null;
  const { month, day } = QUARTER_END[qNum];
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days between two ISO dates (b - a). */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO);
  const b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/** Classify a surprise % into BEAT / MISS / INLINE. */
export function classifySurprise(
  surprisePercent: number | null,
  inlineBandPct: number = DEFAULT_INLINE_BAND_PCT,
): EarningsSurpriseDirection {
  if (surprisePercent == null || !Number.isFinite(surprisePercent)) return 'INLINE';
  if (surprisePercent > inlineBandPct) return 'BEAT';
  if (surprisePercent < -inlineBandPct) return 'MISS';
  return 'INLINE';
}

/** Map a surprise % to a conviction in [-1, +1], saturating at fullConvictionPct. */
export function surpriseToConviction(
  surprisePercent: number | null,
  fullConvictionPct: number = 25,
): number {
  if (surprisePercent == null || !Number.isFinite(surprisePercent)) return 0;
  return clamp(surprisePercent / fullConvictionPct, -1, 1);
}

export function toPEADEvents(quarterly: QuarterlyEarnings[]): PEADEvent[] {
  return quarterly
    .filter((q) => q.actual != null && q.estimate != null)
    .map((q) => ({
      period: q.period,
      quarterEnd: parseQuarterEnd(q.period),
      surprise: q.surprise,
      surprisePercent: q.surprisePercent,
      direction: classifySurprise(q.surprisePercent),
    }))
    .sort((a, b) => (a.quarterEnd && b.quarterEnd ? a.quarterEnd.localeCompare(b.quarterEnd) : 0));
}

export function computePEAD(
  symbol: string,
  quarterly: QuarterlyEarnings[],
  asOf: string,
  options: PEADOptions = {},
): PEADResult {
  const { windowDays = 45, fullConvictionPct = 25, inlineBandPct = DEFAULT_INLINE_BAND_PCT } = options;
  const history = toPEADEvents(quarterly);

  // Most recent qualifying (non-INLINE) event as of asOf.
  const qualifying = history.filter(
    (e) => e.direction !== 'INLINE' && e.quarterEnd && daysBetween(e.quarterEnd, asOf) >= 0,
  );
  const recentEvent = qualifying.length ? qualifying[qualifying.length - 1] : null;

  if (!recentEvent) {
    return {
      symbol,
      asOf,
      recentEvent: null,
      windowOpen: false,
      signal: 0,
      direction: 'NO_VIEW',
      reasoning: 'No qualifying earnings surprise (BEAT/MISS) on record within the window — the PEAD model abstains.',
      history,
    };
  }

  const ageDays = daysBetween(recentEvent.quarterEnd!, asOf);
  const windowOpen = ageDays <= windowDays;

  const rawSignal = surpriseToConviction(recentEvent.surprisePercent, fullConvictionPct);
  // Even a fresh but stale-looking window saturates to a firm view; an expired
  // window still reports a residual drift but is flagged not-fresh.
  const signal = windowOpen ? rawSignal : clamp(rawSignal * 0.5, -1, 1);

  const direction: PEADResult['direction'] = windowOpen
    ? recentEvent.direction
    : recentEvent.direction === 'BEAT'
      ? 'BEAT'
      : 'MISS';

  const why = recentEvent.direction === 'BEAT' ? 'earnings beat' : 'earnings miss';
  const recency = windowOpen
    ? `the surprise is fresh (${ageDays} day(s) old, within the ${windowDays}-day drift window)`
    : `the surprise is stale (${ageDays} day(s) old, beyond the ${windowDays}-day drift window)`;
  const pct = recentEvent.surprisePercent != null ? ` (+${recentEvent.surprisePercent.toFixed(1)}%)` : '';
  const lean = recentEvent.direction === 'BEAT' ? 'long' : 'short/flat';

  return {
    symbol,
    asOf,
    recentEvent,
    windowOpen,
    signal,
    direction,
    reasoning:
      `${symbol} reported a ${why} for ${recentEvent.period}${pct} and ${recency}, so ` +
      `PEAD leans ${lean} (conviction ${Math.round(signal * 100)}%).`,
    history,
  };
}
