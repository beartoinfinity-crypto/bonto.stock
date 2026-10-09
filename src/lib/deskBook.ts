/**
 * deskBook.ts — pure math for the /book screen (greeksoup's Desk · Book port:
 * a hand-kept portfolio priced live).
 *
 * Positions are user-entered (shares + average cost); quotes arrive from the
 * page's batched fetch. Everything here is deterministic — no AI/ML.
 *
 * Units: money in the quote's currency, percentages as printed numbers
 * (+3.42 = 3.42%), drawdowns/P&L signed (negative = loss).
 */

export interface BookPosition {
  id: string;
  symbol: string;
  shares: number;
  /** average cost per share */
  costBasis: number;
}

export interface QuoteLike {
  ok: boolean;
  price: number | null;
  changePercent: number | null;
}

export interface BookRow extends BookPosition {
  price: number | null;
  changePercent: number | null;
  marketValue: number;      // price × shares (null price → 0)
  costValue: number;        // costBasis × shares
  unrealizedPnl: number;    // marketValue − costValue
  unrealizedPnlPct: number; // % of costValue (0 when no cost)
  dayChangeValue: number;   // today's $ move attributed to the position
  dayChangePct: number | null;
  weight: number;           // share of total market value (0..1)
}

export interface BookTotals {
  positions: number;
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  dayChangeValue: number;
  dayChangePct: number | null;
  /** positions whose quote could not be refreshed */
  unpriced: number;
}

export interface BookComputed {
  rows: BookRow[];
  totals: BookTotals;
}

/**
 * Mark every position to its latest quote and aggregate. Positions without a
 * usable quote keep their cost value but contribute 0 to market value (they
 * are counted in `unpriced` so the page can surface them).
 */
export function computeBook(
  positions: BookPosition[],
  quotes: Map<string, QuoteLike>,
): BookComputed {
  const rows: BookRow[] = positions.map(p => {
    const q = quotes.get(p.symbol);
    const price: number | null =
      q && q.ok && q.price !== null && Number.isFinite(q.price) ? q.price : null;
    const changePercent: number | null =
      price !== null && q && q.changePercent !== null && Number.isFinite(q.changePercent)
        ? q.changePercent
        : null;
    const marketValue = price !== null ? price * p.shares : 0;
    const costValue = Number.isFinite(p.costBasis) ? p.costBasis * p.shares : 0;
    const unrealizedPnl = marketValue - costValue;
    // Today's dollar move: derive yesterday's value from the day % so a
    // flat 0% contributes 0 and a missing quote contributes nothing.
    const dayChangeValue = price !== null && changePercent !== null && changePercent > -100
      ? marketValue - marketValue / (1 + changePercent / 100)
      : 0;
    return {
      ...p,
      price,
      changePercent,
      marketValue,
      costValue,
      unrealizedPnl,
      unrealizedPnlPct: costValue > 0 ? (unrealizedPnl / costValue) * 100 : 0,
      dayChangeValue,
      dayChangePct: changePercent,
      weight: 0, // filled below once totals are known
    };
  });

  const marketValue = rows.reduce((s, r) => s + r.marketValue, 0);
  const costValue = rows.reduce((s, r) => s + r.costValue, 0);
  const unrealizedPnl = marketValue - costValue;
  const dayChangeValue = rows.reduce((s, r) => s + r.dayChangeValue, 0);
  const prevValue = marketValue - dayChangeValue;

  for (const r of rows) {
    r.weight = marketValue > 0 ? r.marketValue / marketValue : 0;
  }

  return {
    rows,
    totals: {
      positions: rows.length,
      marketValue,
      costValue,
      unrealizedPnl,
      unrealizedPnlPct: costValue > 0 ? (unrealizedPnl / costValue) * 100 : 0,
      dayChangeValue,
      dayChangePct: prevValue > 0 ? (dayChangeValue / prevValue) * 100 : null,
      unpriced: rows.filter(r => r.price === null).length,
    },
  };
}

/** Merge a new lot into the book: same symbol → weighted-average cost. */
export function upsertPosition(
  positions: BookPosition[],
  input: { symbol: string; shares: number; costBasis: number; id?: string },
): BookPosition[] {
  const symbol = input.symbol.trim().toUpperCase();
  const existing = positions.find(p => p.symbol === symbol);
  if (existing) {
    const totalShares = existing.shares + input.shares;
    const blendedCost = totalShares > 0
      ? (existing.shares * existing.costBasis + input.shares * input.costBasis) / totalShares
      : input.costBasis;
    return positions.map(p =>
      p.id === existing.id ? { ...p, shares: totalShares, costBasis: blendedCost } : p,
    );
  }
  return [...positions, {
    id: input.id ?? `${symbol}-${Date.now()}`,
    symbol,
    shares: input.shares,
    costBasis: input.costBasis,
  }];
}

export function removePosition(positions: BookPosition[], id: string): BookPosition[] {
  return positions.filter(p => p.id !== id);
}

/** Input validation for the add form (page-level messages). */
export function validateLot(symbol: string, shares: number, costBasis: number): string | null {
  if (!symbol.trim()) return 'Symbol is required';
  if (!Number.isFinite(shares) || shares <= 0) return 'Shares must be greater than 0';
  if (!Number.isFinite(costBasis) || costBasis < 0) return 'Average cost cannot be negative';
  return null;
}

/** Sort rows for display without mutating the computed array. */
export type BookSort = 'value' | 'symbol' | 'day' | 'pnl';

export function sortBookRows(rows: BookRow[], sort: BookSort): BookRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'symbol':
      return copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
    case 'day':
      return copy.sort((a, b) => (b.dayChangePct ?? -Infinity) - (a.dayChangePct ?? -Infinity));
    case 'pnl':
      return copy.sort((a, b) => b.unrealizedPnlPct - a.unrealizedPnlPct);
    case 'value':
    default:
      return copy.sort((a, b) => b.marketValue - a.marketValue);
  }
}
