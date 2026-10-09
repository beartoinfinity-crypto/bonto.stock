/**
 * backtestMetrics.ts — performance & risk metric suite (spec §2.4).
 *
 * Turns a replay's closed trades (+ the bar series + the still-open position)
 * into the standard quant metrics, computed from real fills only:
 *   - Return profile:  total return, CAGR
 *   - Risk:            max drawdown, max drawdown duration, annualized volatility
 *   - Risk-adjusted:   Sharpe, Sortino, Calmar
 *   - Trade stats:     win rate, profit factor, avg win / loss, expectancy
 *
 * The equity curve is mark-to-market per session: realized P/L from closed
 * trades plus the unrealized P/L of the position currently open, so drawdowns
 * reflect open-position heat rather than only settled outcomes.
 *
 * Convention: per-session simple returns, 252 sessions/year, risk-free rate 0
 * by default (configurable). Metrics are plain finite numbers; the only values
 * that can be non-finite are profit factor / Calmar in the degenerate
 * "no losing trades / no drawdown" case — callers format with Number.isFinite.
 */

import type { StockData } from './stockData';
import type { ReplayTrade } from './tacticalEngine';

export interface BacktestMetrics {
  totalReturn: number;           // % of initial equity (mark-to-market)
  cagr: number;                  // % annualized
  maxDrawdown: number;           // % (negative, 0 when never underwater)
  maxDrawdownDuration: number;   // sessions spent below the running peak
  volatility: number;            // % annualized (std of per-session returns)
  sharpe: number;                // annualized, (mean - rf) / std
  sortino: number;               // annualized, downside-deviation version
  calmar: number;                // CAGR / |max drawdown|
  winRate: number;               // %
  profitFactor: number;          // gross win / gross loss
  avgWin: number;                // $ per winning trade
  avgLoss: number;               // $ per losing trade (negative)
  expectancy: number;            // $ per trade (mean realized P/L)
  totalTrades: number;           // closed trades
  netPnl: number;                // $ realized
}

export interface ComputeMetricsInput {
  trades: ReplayTrade[];                 // closed trades (any order)
  bars: StockData[];                     // chronological daily bars of the replay window
  initialEquity?: number;                // default 100000 (matches DEFAULT_PARAMS)
  openPosition?: ReplayTrade | null;     // still-open trade, marked to market
  sessionsPerYear?: number;              // default 252
  riskFreeRate?: number;                 // default 0
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const std = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};

/**
 * Per-session mark-to-market equity curve. The open position (if any) is
 * appended as a trade that "realizes" on the final bar, which marks it at the
 * last close while contributing no spurious intermediate jumps.
 */
export function buildEquityCurve(
  trades: ReplayTrade[],
  bars: StockData[],
  initialEquity = 100000,
  openPosition?: ReplayTrade | null,
): number[] {
  if (!bars || bars.length === 0) return [];
  const idx = new Map(bars.map((b, i) => [b.date, i]));
  const at = (d: string): number | undefined => idx.get(d);

  const curveTrades = [...trades, ...(openPosition ? [openPosition] : [])];
  const realized: { exitIdx: number; pnl: number }[] = [];
  const openMtm: { entryIdx: number; exitIdx: number; dir: number; entry: number; size: number }[] = [];
  for (const t of curveTrades) {
    const ei = at(t.entryDate), xi = at(t.exitDate);
    if (ei === undefined || xi === undefined) continue;
    realized.push({ exitIdx: xi, pnl: t.pnl });
    openMtm.push({
      entryIdx: ei,
      exitIdx: xi,
      dir: t.side === 'LONG' ? 1 : -1,
      entry: t.entryPrice,
      size: t.size,
    });
  }
  realized.sort((a, b) => a.exitIdx - b.exitIdx);

  const curve: number[] = [];
  let cum = 0;
  let r = 0;
  for (let t = 0; t < bars.length; t++) {
    while (r < realized.length && realized[r].exitIdx <= t) {
      cum += realized[r].pnl;
      r++;
    }
    let mtm = 0;
    for (const o of openMtm) {
      if (o.entryIdx <= t && t < o.exitIdx) {
        mtm += (bars[t].close - o.entry) * o.dir * o.size;
      }
    }
    curve.push(initialEquity + cum + mtm);
  }
  return curve;
}

/** Peak-to-trough drawdown (%) and the longest underwater streak (sessions). */
export function maxDrawdownStats(curve: number[]): { maxDrawdown: number; duration: number } {
  let peak = -Infinity;
  let maxDrawdown = 0;
  let underwater = 0;
  let duration = 0;
  for (const c of curve) {
    if (c > peak) {
      peak = c;
      underwater = 0;
    } else {
      underwater++;
      if (underwater > duration) duration = underwater;
    }
    const dd = peak > 0 ? (c / peak - 1) * 100 : 0;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  return { maxDrawdown, duration };
}

export function computeBacktestMetrics(input: ComputeMetricsInput): BacktestMetrics {
  const bars = input.bars ?? [];
  const eq = input.initialEquity ?? 100000;
  const spy = input.sessionsPerYear ?? 252;
  const rf = input.riskFreeRate ?? 0;

  // Trade statistics are computed on closed trades only; the open position is
  // never counted as a win or a loss even though it is marked in the curve.
  const closed = input.trades.filter(t => t.reason !== 'Open');
  const total = closed.length;
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losses.reduce((s, t) => s + t.pnl, 0);
  const netPnl = closed.reduce((s, t) => s + t.pnl, 0);

  const curve = buildEquityCurve(closed, bars, eq, input.openPosition);
  const { maxDrawdown, duration } = maxDrawdownStats(curve);

  const n = curve.length;
  const finalEquity = n ? curve[n - 1] : eq;
  const totalReturn = eq > 0 ? ((finalEquity - eq) / eq) * 100 : 0;
  const cagr = n > 1 && finalEquity > 0 && eq > 0
    ? (Math.pow(finalEquity / eq, spy / n) - 1) * 100
    : 0;

  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    rets.push(curve[i - 1] > 0 ? (curve[i] - curve[i - 1]) / curve[i - 1] : 0);
  }
  const sd = std(rets);
  const volatility = sd * Math.sqrt(spy) * 100;
  const sharpe = sd > 0 ? ((mean(rets) - rf) / sd) * Math.sqrt(spy) : 0;
  const downside = rets.filter(r => r < 0);
  const ddev = downside.length ? Math.sqrt(mean(downside.map(r => r * r))) : 0;
  const sortino = ddev > 0 ? ((mean(rets) - rf) / ddev) * Math.sqrt(spy) : 0;
  const calmar = maxDrawdown < 0
    ? cagr / Math.abs(maxDrawdown)
    : (cagr > 0 ? Infinity : 0);

  return {
    totalReturn,
    cagr,
    maxDrawdown,
    maxDrawdownDuration: duration,
    volatility,
    sharpe,
    sortino,
    calmar,
    winRate: total ? (wins.length / total) * 100 : 0,
    profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : (grossWin > 0 ? Infinity : 0),
    avgWin: wins.length ? mean(wins.map(t => t.pnl)) : 0,
    avgLoss: losses.length ? mean(losses.map(t => t.pnl)) : 0,
    expectancy: total ? netPnl / total : 0,
    totalTrades: total,
    netPnl,
  };
}
