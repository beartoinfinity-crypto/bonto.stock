// Tactical Engine — structured implementation of the trading blueprint:
// market regime state machine, three entry weapons, dynamic position sizing,
// adaptive trailing exits and iceberg execution planning.

import { StockData } from './stockData';

export interface EngineParams {
  atrLength: number;          // ATR_Length
  volatilityFactor: number;   // Volatility_Factor
  maxRiskPerTrade: number;    // Max_Risk_Per_Trade (fraction)
  icebergSlices: number;      // Iceberg_Slices
  timeStopMinutes: number;    // Time_Stop_Minutes
  adxThreshold: number;       // ADX_Threshold
  bandwidthThreshold: number; // Bandwidth_Threshold
  accelerator: number;        // Accelerator base
  accountEquity: number;
  initialEquity: number;
  minDepth: number;           // liquidity floor (contracts/lots)
  minutesHeld: number;        // simulated holding time for exit module
}

export const DEFAULT_PARAMS: EngineParams = {
  atrLength: 14,
  volatilityFactor: 1.2,
  maxRiskPerTrade: 0.02,
  icebergSlices: 5,
  timeStopMinutes: 30,
  adxThreshold: 25,
  bandwidthThreshold: 0.05,
  accelerator: 0.02,
  accountEquity: 100000,
  initialEquity: 100000,
  minDepth: 50,
  minutesHeld: 35,
};

/* ------------------------------------------------------------------ */
/* Indicators                                                          */
/* ------------------------------------------------------------------ */

export function trueRanges(data: StockData[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const h = data[i].high, l = data[i].low, pc = data[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return tr;
}

export function atr(data: StockData[], period = 14): number {
  const tr = trueRanges(data);
  if (tr.length === 0) return 0;
  const slice = tr.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

/** Average of the ATR series over the last `lookback` bars (Avg_ATR_100). */
export function avgAtr(data: StockData[], period = 14, lookback = 100): number {
  const values: number[] = [];
  for (let i = data.length - lookback; i < data.length; i++) {
    if (i - period - 1 < 0) continue;
    values.push(atr(data.slice(0, i + 1), period));
  }
  if (values.length === 0) return atr(data, period);
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export interface AdxResult { adx: number; plusDI: number; minusDI: number }

export function adx(data: StockData[], period = 14): AdxResult {
  if (data.length < period + 2) return { adx: 0, plusDI: 0, minusDI: 0 };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const up = data[i].high - data[i - 1].high;
    const down = data[i - 1].low - data[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const h = data[i].high, l = data[i].low, pc = data[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const smooth = (arr: number[]) => {
    const seed = arr.slice(0, period).reduce((s, v) => s + v, 0);
    const out = [seed];
    for (let i = period; i < arr.length; i++) {
      out.push(out[out.length - 1] - out[out.length - 1] / period + arr[i]);
    }
    return out;
  };
  const strS = smooth(tr), pdmS = smooth(plusDM), mdmS = smooth(minusDM);
  const dx: number[] = [];
  let plusDI = 0, minusDI = 0;
  for (let i = 0; i < strS.length; i++) {
    const trs = strS[i] || 1e-9;
    plusDI = (pdmS[i] / trs) * 100;
    minusDI = (mdmS[i] / trs) * 100;
    dx.push((Math.abs(plusDI - minusDI) / (plusDI + minusDI + 1e-9)) * 100);
  }
  const last = dx.slice(-period);
  const adxVal = last.reduce((s, v) => s + v, 0) / (last.length || 1);
  return { adx: adxVal, plusDI, minusDI };
}

export interface Bands { upper: number; middle: number; lower: number; bandwidth: number }

export function bollinger(data: StockData[], period = 20, mult = 2): Bands {
  const closes = data.slice(-period).map(d => d.close);
  const middle = closes.reduce((s, v) => s + v, 0) / (closes.length || 1);
  const variance = closes.reduce((s, v) => s + (v - middle) ** 2, 0) / (closes.length || 1);
  const sd = Math.sqrt(variance);
  const upper = middle + mult * sd, lower = middle - mult * sd;
  return { upper, middle, lower, bandwidth: (upper - lower) / (middle || 1) };
}

export function rsi(data: StockData[], period = 14): number {
  if (data.length < period + 1) return 50;
  let gains = 0, losses = 0;
  const slice = data.slice(-(period + 1));
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i].close - slice[i - 1].close;
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/* ------------------------------------------------------------------ */
/* Module 1 — Microstructure: liquidity & order-book imbalance          */
/* ------------------------------------------------------------------ */

export interface BookLevel { price: number; volume: number }
export interface OrderBook { bids: BookLevel[]; asks: BookLevel[] }

export interface LiquidityCheck {
  canTrade: boolean;
  reason: 'OK' | 'Liquidity_Too_Low' | 'Extreme_Imbalance';
  imbalanceRatio: number;
  totalBidVol: number;
  totalAskVol: number;
  avgDepth: number;
}

export function checkLiquidityAndImbalance(book: OrderBook, minDepth = 50): LiquidityCheck {
  const totalBidVol = book.bids.reduce((s, l) => s + l.volume, 0);
  const totalAskVol = book.asks.reduce((s, l) => s + l.volume, 0);
  const imbalanceRatio = (totalBidVol - totalAskVol) / (totalBidVol + totalAskVol + 1e-9);
  const avgDepth = (totalBidVol + totalAskVol) / 10;

  if (avgDepth < minDepth) {
    return { canTrade: false, reason: 'Liquidity_Too_Low', imbalanceRatio, totalBidVol, totalAskVol, avgDepth };
  }
  if (Math.abs(imbalanceRatio) > 0.85) {
    return { canTrade: false, reason: 'Extreme_Imbalance', imbalanceRatio, totalBidVol, totalAskVol, avgDepth };
  }
  return { canTrade: true, reason: 'OK', imbalanceRatio, totalBidVol, totalAskVol, avgDepth };
}

/**
 * Level-2 depth is not available from the daily EOD feed, so the book is
 * reconstructed as a proxy: depth scales with recent volume vs. its 20-day
 * average, and the bid/ask skew follows where the close sits inside the bar
 * range plus short-term momentum. Clearly a model, not exchange data.
 */
export function deriveOrderBook(data: StockData[]): OrderBook {
  const last = data[data.length - 1];
  if (!last) return { bids: [], asks: [] };
  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / Math.min(20, data.length);
  const volRatio = avgVol > 0 ? last.volume / avgVol : 1;
  const range = Math.max(last.high - last.low, 1e-9);
  const closeLocation = (last.close - last.low) / range;      // 0..1
  const prev = data[data.length - 2]?.close ?? last.close;
  const mom = (last.close - prev) / (prev || 1);
  const skew = Math.max(-0.8, Math.min(0.8, (closeLocation - 0.5) * 1.2 + mom * 8));

  const baseDepth = Math.max(20, Math.round(120 * volRatio));
  const bids: BookLevel[] = [], asks: BookLevel[] = [];
  const tick = Math.max(0.01, last.close * 0.0005);
  for (let i = 0; i < 5; i++) {
    const decay = 1 - i * 0.12;
    bids.push({ price: +(last.close - tick * (i + 1)).toFixed(2), volume: Math.round(baseDepth * decay * (1 + skew)) });
    asks.push({ price: +(last.close + tick * (i + 1)).toFixed(2), volume: Math.round(baseDepth * decay * (1 - skew)) });
  }
  return { bids, asks };
}

/* ------------------------------------------------------------------ */
/* Module 2 — Regime filter                                            */
/* ------------------------------------------------------------------ */

export type MarketState = 'STRONG_UPTREND' | 'STRONG_DOWNTREND' | 'SIDEWAYS_TIGHT' | 'TRANSITIONING';

export interface RegimeResult {
  state: MarketState;
  adx: number;
  plusDI: number;
  minusDI: number;
  bandwidth: number;
  bands: Bands;
}

export function marketRegime(data: StockData[], p: EngineParams): RegimeResult {
  const { adx: adxVal, plusDI, minusDI } = adx(data, 14);
  const bands = bollinger(data, 20, 2);
  let state: MarketState;
  if (adxVal > p.adxThreshold) {
    state = plusDI > minusDI ? 'STRONG_UPTREND' : 'STRONG_DOWNTREND';
  } else if (adxVal < p.adxThreshold - 5 && bands.bandwidth < p.bandwidthThreshold) {
    state = 'SIDEWAYS_TIGHT';
  } else {
    state = 'TRANSITIONING';
  }
  return { state, adx: adxVal, plusDI, minusDI, bandwidth: bands.bandwidth, bands };
}

/* ------------------------------------------------------------------ */
/* Module 3 — Entry signal engine                                      */
/* ------------------------------------------------------------------ */

export type EntryAction = 'BUY' | 'SELL' | 'HOLD';

export interface EntrySignal {
  action: EntryAction;
  scenario: 'A_BREAKOUT_PULLBACK' | 'B_MEAN_REVERSION' | 'C_VOLATILITY_BURST' | 'NONE';
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  checks: { label: string; passed: boolean; detail: string }[];
  note: string;
}

export function entrySignal(
  data: StockData[],
  regime: RegimeResult,
  imbalanceRatio: number,
  p: EngineParams,
): EntrySignal {
  const price = data[data.length - 1]?.close ?? 0;
  const a = atr(data, p.atrLength);
  const checks: EntrySignal['checks'] = [];

  if (regime.state === 'STRONG_UPTREND' || regime.state === 'STRONG_DOWNTREND') {
    const window = data.slice(-20);
    const hhv = Math.max(...window.map(d => d.high));
    const llv = Math.min(...window.map(d => d.low));
    const long = regime.state === 'STRONG_UPTREND';
    const breakout = long
      ? data.slice(-3).some(d => d.close >= hhv * 0.999)
      : data.slice(-3).some(d => d.close <= llv * 1.001);
    const fib = long ? hhv - (hhv - llv) * 0.618 : llv + (hhv - llv) * 0.618;
    const atSupport = price <= fib * 1.01 && price >= fib * 0.99;
    const bookOk = long ? imbalanceRatio > 0.2 : imbalanceRatio < -0.2;

    checks.push({ label: '20-bar breakout (last 3 bars)', passed: breakout, detail: `HHV20 ${hhv.toFixed(2)} / LLV20 ${llv.toFixed(2)}` });
    checks.push({ label: 'Pullback to Fib 0.618', passed: atSupport, detail: `target ${fib.toFixed(2)} vs price ${price.toFixed(2)}` });
    checks.push({ label: 'Order-book imbalance confirms', passed: bookOk, detail: `${(imbalanceRatio * 100).toFixed(1)}% (need ${long ? '>+20%' : '<-20%'})` });

    if (breakout && atSupport && bookOk) {
      return {
        action: long ? 'BUY' : 'SELL',
        scenario: 'A_BREAKOUT_PULLBACK',
        entryPrice: price,
        stopLoss: long ? price - a * 1.5 : price + a * 1.5,
        takeProfit: long ? price + a * 3 : price - a * 3,
        checks,
        note: 'Trend continuation: breakout then 0.618 retracement with book support.',
      };
    }
    return { action: 'HOLD', scenario: 'A_BREAKOUT_PULLBACK', entryPrice: null, stopLoss: null, takeProfit: null, checks, note: 'Trend regime, but the pullback entry is not armed yet.' };
  }

  if (regime.state === 'SIDEWAYS_TIGHT') {
    const wide = bollinger(data, 20, 2.5);
    const r = rsi(data, 14);
    const longSetup = price <= wide.lower && r < 30 && imbalanceRatio > 0.1;
    const shortSetup = price >= wide.upper && r > 70 && imbalanceRatio < -0.1;

    checks.push({ label: 'Price at 2.5σ band', passed: price <= wide.lower || price >= wide.upper, detail: `${wide.lower.toFixed(2)} / ${wide.upper.toFixed(2)}` });
    checks.push({ label: 'RSI extreme (<30 or >70)', passed: r < 30 || r > 70, detail: `RSI ${r.toFixed(1)}` });
    checks.push({ label: 'Imbalance turning with the trade', passed: longSetup || shortSetup, detail: `${(imbalanceRatio * 100).toFixed(1)}%` });

    if (longSetup) {
      return { action: 'BUY', scenario: 'B_MEAN_REVERSION', entryPrice: price, stopLoss: wide.lower - a, takeProfit: wide.middle, checks, note: 'Mean reversion long; profit target at the band middle.' };
    }
    if (shortSetup) {
      return { action: 'SELL', scenario: 'B_MEAN_REVERSION', entryPrice: price, stopLoss: wide.upper + a, takeProfit: wide.middle, checks, note: 'Mean reversion short; profit target at the band middle.' };
    }
    return { action: 'HOLD', scenario: 'B_MEAN_REVERSION', entryPrice: null, stopLoss: null, takeProfit: null, checks, note: 'Tight range, waiting for a 2.5σ + RSI extreme.' };
  }

  // TRANSITIONING — volatility burst with a delayed confirmation
  const prev = data[data.length - 2]?.close ?? price;
  const recentChange = a > 0 ? Math.abs(price - prev) / a : 0;
  const burst = recentChange > 1.5;
  const followThrough = price > (data[data.length - 2]?.high ?? price);
  checks.push({ label: 'Move > 1.5 × ATR', passed: burst, detail: `${recentChange.toFixed(2)} × ATR` });
  checks.push({ label: 'Confirmation: new high after the delay', passed: followThrough, detail: followThrough ? 'above prior bar high' : 'no follow-through' });

  if (burst && followThrough) {
    return { action: 'BUY', scenario: 'C_VOLATILITY_BURST', entryPrice: price, stopLoss: price - a * 2, takeProfit: price + a * 4, checks, note: 'Delayed momentum chase after a volatility burst held its highs.' };
  }
  return { action: 'HOLD', scenario: 'C_VOLATILITY_BURST', entryPrice: null, stopLoss: null, takeProfit: null, checks, note: 'Transitioning regime — stand aside or size down until the burst confirms.' };
}

/* ------------------------------------------------------------------ */
/* Module 4 — Dynamic position sizing                                  */
/* ------------------------------------------------------------------ */

export interface SizingResult {
  riskDollars: number;
  riskPerShare: number;
  baseSize: number;
  volatilityScaling: number;
  liquidityCap: number;
  finalSize: number;
  notional: number;
  cappedBy: 'risk' | 'liquidity';
}

export function calculatePositionSize(
  entryPrice: number,
  stopLoss: number,
  data: StockData[],
  totalBidVol: number,
  p: EngineParams,
): SizingResult {
  const riskDollars = p.accountEquity * p.maxRiskPerTrade;
  const riskPerShare = Math.max(Math.abs(entryPrice - stopLoss), 1e-9);
  const baseSize = riskDollars / riskPerShare;
  const currentAtr = atr(data, p.atrLength) || 1e-9;
  const scalingRaw = avgAtr(data, p.atrLength, 100) / currentAtr;
  const volatilityScaling = Math.min(Math.max(scalingRaw, 0.5), 1.5);
  const sized = Math.floor(baseSize * volatilityScaling);
  const liquidityCap = Math.floor(totalBidVol * 0.05);
  const finalSize = Math.max(0, Math.min(sized, liquidityCap));
  return {
    riskDollars,
    riskPerShare,
    baseSize,
    volatilityScaling,
    liquidityCap,
    finalSize,
    notional: finalSize * entryPrice,
    cappedBy: liquidityCap < sized ? 'liquidity' : 'risk',
  };
}

/* ------------------------------------------------------------------ */
/* Module 5 — Exit management                                          */
/* ------------------------------------------------------------------ */

export interface ExitPlan {
  action: 'EXIT' | 'HOLD';
  reason: 'Time_Stop' | 'Trailing_Stop' | 'Active' | null;
  trailingStopPrice: number;
  acceleratorUsed: number;
  minutesHeld: number;
  timeStopArmed: boolean;
  extremePrice: number;
  hardStop: number;
}

export function manageExit(
  position: 'LONG' | 'SHORT',
  currentPrice: number,
  entryPrice: number,
  data: StockData[],
  p: EngineParams,
  hardStop: number,
): ExitPlan {
  const currentAtr = atr(data, p.atrLength);
  const minutesHeld = p.minutesHeld;
  const accelerator = p.accelerator + (minutesHeld / 60) * 0.01;

  // Extreme excursion since entry, proxied by the last 5 bars.
  const window = data.slice(-5);
  const extremePrice = position === 'LONG'
    ? Math.max(currentPrice, ...window.map(d => d.high))
    : Math.min(currentPrice, ...window.map(d => d.low));

  const trailingStopPrice = position === 'LONG'
    ? extremePrice - accelerator * currentAtr * 10
    : extremePrice + accelerator * currentAtr * 10;

  const priceChange = (currentPrice - entryPrice) / (entryPrice || 1);
  const timeStopArmed = minutesHeld > p.timeStopMinutes && Math.abs(priceChange) < 0.001;

  if (timeStopArmed) {
    return { action: 'EXIT', reason: 'Time_Stop', trailingStopPrice, acceleratorUsed: accelerator, minutesHeld, timeStopArmed, extremePrice, hardStop };
  }
  const breached = position === 'LONG' ? currentPrice < trailingStopPrice : currentPrice > trailingStopPrice;
  if (breached) {
    return { action: 'EXIT', reason: 'Trailing_Stop', trailingStopPrice, acceleratorUsed: accelerator, minutesHeld, timeStopArmed, extremePrice, hardStop };
  }
  return { action: 'HOLD', reason: 'Active', trailingStopPrice, acceleratorUsed: accelerator, minutesHeld, timeStopArmed, extremePrice, hardStop };
}

/* ------------------------------------------------------------------ */
/* Module 6 — Iceberg execution plan                                   */
/* ------------------------------------------------------------------ */

export interface IcebergSlice { index: number; price: number; quantity: number; delaySeconds: number }

export function buildIcebergPlan(side: 'BUY' | 'SELL', price: number, totalQuantity: number, p: EngineParams): IcebergSlice[] {
  const tick = Math.max(0.01, price * 0.0005);
  if (totalQuantity <= 1) {
    return [{ index: 1, price: +(side === 'BUY' ? price + tick : price - tick).toFixed(2), quantity: totalQuantity, delaySeconds: 0 }];
  }
  const sliceQty = Math.floor(totalQuantity / p.icebergSlices);
  const slices: IcebergSlice[] = [];
  let allocated = 0;
  for (let i = 0; i < p.icebergSlices; i++) {
    const offset = i * 0.5 * tick;
    const qty = i === p.icebergSlices - 1 ? totalQuantity - allocated : sliceQty;
    allocated += sliceQty;
    slices.push({
      index: i + 1,
      price: +(side === 'BUY' ? price - offset : price + offset).toFixed(2),
      quantity: Math.max(0, qty),
      delaySeconds: i * 8,
    });
  }
  return slices;
}

/* ------------------------------------------------------------------ */
/* Kill switch + main loop orchestration                               */
/* ------------------------------------------------------------------ */

export interface KillSwitch { triggered: boolean; drawdownPct: number }

export function killSwitch(p: EngineParams): KillSwitch {
  const drawdownPct = ((p.initialEquity - p.accountEquity) / (p.initialEquity || 1)) * 100;
  return { triggered: p.accountEquity < p.initialEquity * 0.95, drawdownPct };
}

export interface EngineResult {
  price: number;
  atr: number;
  book: OrderBook;
  liquidity: LiquidityCheck;
  regime: RegimeResult;
  entry: EntrySignal;
  sizing: SizingResult | null;
  exit: ExitPlan | null;
  iceberg: IcebergSlice[];
  kill: KillSwitch;
  blocked: string | null;
}

/** One pass of the main loop against the latest bar. */
export function runEngine(data: StockData[], p: EngineParams): EngineResult | null {
  if (!data || data.length < 30) return null;
  const price = data[data.length - 1].close;
  const kill = killSwitch(p);
  const book = deriveOrderBook(data);
  const liquidity = checkLiquidityAndImbalance(book, p.minDepth);
  const regime = marketRegime(data, p);
  const entry = entrySignal(data, regime, liquidity.imbalanceRatio, p);

  let blocked: string | null = null;
  if (kill.triggered) blocked = 'Kill switch: equity drawdown ≥ 5% — all orders cancelled.';
  else if (!liquidity.canTrade) blocked = liquidity.reason === 'Liquidity_Too_Low'
    ? 'Book depth below the liquidity floor — no orders sent.'
    : 'Extreme one-sided book (>85%) — false-breakout risk, no orders sent.';

  const tradable = !blocked && entry.action !== 'HOLD' && entry.entryPrice !== null && entry.stopLoss !== null;
  const sizing = tradable
    ? calculatePositionSize(entry.entryPrice!, entry.stopLoss!, data, liquidity.totalBidVol, p)
    : null;
  const exit = tradable
    ? manageExit(entry.action === 'BUY' ? 'LONG' : 'SHORT', price, entry.entryPrice!, data, p, entry.stopLoss!)
    : null;
  const iceberg = tradable && sizing && sizing.finalSize > 0
    ? buildIcebergPlan(entry.action as 'BUY' | 'SELL', entry.entryPrice!, sizing.finalSize, p)
    : [];

  return { price, atr: atr(data, p.atrLength), book, liquidity, regime, entry, sizing, exit, iceberg, kill, blocked };
}

/* ------------------------------------------------------------------ */
/* End-of-day replay — full session buy/sell action history            */
/* ------------------------------------------------------------------ */

export interface DayAction {
  date: string;
  close: number;
  state: MarketState;
  action: EntryAction;
  scenario: EntrySignal['scenario'];
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  size: number | null;
  imbalanceRatio: number;
  adx: number;
  blocked: string | null;
  note: string;
  /** Position lifecycle event produced on this bar, if any. */
  event: 'ENTRY' | 'EXIT' | 'HOLD' | 'FLAT';
  eventDetail: string;
}

export interface ReplayTrade {
  side: 'LONG' | 'SHORT';
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  size: number;
  barsHeld: number;
  reason: 'Take_Profit' | 'Hard_Stop' | 'Trailing_Stop' | 'Time_Stop' | 'Open';
  pnl: number;
  pnlPct: number;
}

export interface ReplayResult {
  rows: DayAction[];
  trades: ReplayTrade[];
  summary: {
    sessions: number;
    buySignals: number;
    sellSignals: number;
    blockedSessions: number;
    closedTrades: number;
    wins: number;
    winRate: number;
    netPnl: number;
    openTrade: ReplayTrade | null;
  };
}

/**
 * Walk the engine bar by bar over the last `lookback` sessions, as it would run
 * once each trading day closes, and log every buy/sell action plus the
 * resulting position lifecycle (entry, trailing/hard stop, target, time stop).
 */
export function replayEngine(data: StockData[], p: EngineParams, lookback = 30): ReplayResult | null {
  if (!data || data.length < 40) return null;
  const start = Math.max(30, data.length - lookback);

  // ── Pre-compute indicator series once ──────────────────────────
  const atrSeries = precomputeAtr(data, p.atrLength);
  const adxSeries = precomputeAdx(data, 14);
  const rsiSeries = precomputeRsi(data, 14);

  const rows: DayAction[] = [];
  const trades: ReplayTrade[] = [];

  let open: { side: 'LONG' | 'SHORT'; entryIdx: number; entryPrice: number; stop: number; target: number; size: number } | null = null;

  const closeTrade = (idx: number, exitPrice: number, reason: ReplayTrade['reason']) => {
    if (!open) return;
    const dir = open.side === 'LONG' ? 1 : -1;
    const pnl = (exitPrice - open.entryPrice) * dir * open.size;
    trades.push({
      side: open.side,
      entryDate: data[open.entryIdx].date,
      entryPrice: open.entryPrice,
      exitDate: data[idx].date,
      exitPrice,
      size: open.size,
      barsHeld: idx - open.entryIdx,
      reason,
      pnl,
      pnlPct: ((exitPrice - open.entryPrice) * dir) / (open.entryPrice || 1) * 100,
    });
    open = null;
  };

  for (let i = start; i < data.length; i++) {
    const slice = data.slice(0, i + 1);
    const bar = data[i];
    const res = runEngine(slice, p);
    if (!res) continue;

    let event: DayAction['event'] = 'FLAT';
    let eventDetail = '';

    if (open) {
      const dir = open.side === 'LONG' ? 1 : -1;
      const barsHeld = i - open.entryIdx;
      const currentAtrVal = atrSeries[i] || res.atr;
      const accel = p.accelerator + (barsHeld / 60) * 0.01;

      // Compute trailing stop from pre-computed ATR
      const window = slice.slice(-5);
      const extremePrice = open.side === 'LONG'
        ? Math.max(bar.close, ...window.map(d => d.high))
        : Math.min(bar.close, ...window.map(d => d.low));
      const trailingStopPrice = open.side === 'LONG'
        ? extremePrice - accel * currentAtrVal * 10
        : extremePrice + accel * currentAtrVal * 10;

      const hitTarget = dir === 1 ? bar.high >= open.target : bar.low <= open.target;
      const hitStop = dir === 1 ? bar.low <= open.stop : bar.high >= open.stop;
      const flat = Math.abs((bar.close - open.entryPrice) / (open.entryPrice || 1)) < 0.005;

      if (hitTarget) {
        closeTrade(i, open.target, 'Take_Profit');
        event = 'EXIT'; eventDetail = 'Take profit reached';
      } else if (hitStop) {
        closeTrade(i, open.stop, 'Hard_Stop');
        event = 'EXIT'; eventDetail = 'Hard stop hit intrabar';
      } else if (dir === 1 ? bar.close < trailingStopPrice : bar.close > trailingStopPrice) {
        closeTrade(i, bar.close, 'Trailing_Stop');
        event = 'EXIT'; eventDetail = `Trailing stop ${trailingStopPrice.toFixed(2)}`;
      } else if (barsHeld >= 5 && flat) {
        closeTrade(i, bar.close, 'Time_Stop');
        event = 'EXIT'; eventDetail = 'Time stop — position went nowhere';
      } else {
        event = 'HOLD'; eventDetail = `Held ${barsHeld} session(s), trail ${trailingStopPrice.toFixed(2)}`;
      }
    }

    if (!open && res.entry.action !== 'HOLD' && res.entry.entryPrice && res.entry.stopLoss && res.entry.takeProfit && res.sizing && res.sizing.finalSize > 0) {
      open = {
        side: res.entry.action === 'BUY' ? 'LONG' : 'SHORT',
        entryIdx: i,
        entryPrice: res.entry.entryPrice,
        stop: res.entry.stopLoss,
        target: res.entry.takeProfit,
        size: res.sizing.finalSize,
      };
      event = 'ENTRY';
      eventDetail = `${res.entry.action} ${res.sizing.finalSize} @ ${res.entry.entryPrice.toFixed(2)}`;
    }

    rows.push({
      date: bar.date,
      close: bar.close,
      state: res.regime.state,
      action: res.entry.action,
      scenario: res.entry.scenario,
      entryPrice: res.entry.entryPrice,
      stopLoss: res.entry.stopLoss,
      takeProfit: res.entry.takeProfit,
      size: res.sizing?.finalSize ?? null,
      imbalanceRatio: res.liquidity.imbalanceRatio,
      adx: res.regime.adx,
      blocked: res.blocked,
      note: res.entry.note,
      event,
      eventDetail,
    });
  }

  let openTrade: ReplayTrade | null = null;
  if (open) {
    const last = data[data.length - 1];
    const dir = open.side === 'LONG' ? 1 : -1;
    openTrade = {
      side: open.side,
      entryDate: data[open.entryIdx].date,
      entryPrice: open.entryPrice,
      exitDate: last.date,
      exitPrice: last.close,
      size: open.size,
      barsHeld: data.length - 1 - open.entryIdx,
      reason: 'Open',
      pnl: (last.close - open.entryPrice) * dir * open.size,
      pnlPct: ((last.close - open.entryPrice) * dir) / (open.entryPrice || 1) * 100,
    };
  }

  const wins = trades.filter(t => t.pnl > 0).length;
  return {
    rows: rows.slice().reverse(),
    trades: trades.slice().reverse(),
    summary: {
      sessions: rows.length,
      buySignals: rows.filter(r => r.action === 'BUY').length,
      sellSignals: rows.filter(r => r.action === 'SELL').length,
      blockedSessions: rows.filter(r => r.blocked).length,
      closedTrades: trades.length,
      wins,
      winRate: trades.length ? (wins / trades.length) * 100 : 0,
      netPnl: trades.reduce((s, t) => s + t.pnl, 0),
    openTrade,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pre-computed indicator series (for replay optimisation)             */
/* ------------------------------------------------------------------ */

function precomputeAtr(data: StockData[], period: number): number[] {
  const tr = trueRanges(data);
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (i === period - 1) {
      sum = tr.slice(0, period).reduce((s, v) => s + v, 0);
    } else {
      sum = sum - sum / period + tr[i];
    }
    result.push(sum / period);
  }
  // Pad the front (tr is data.length-1 long, result is too)
  return [NaN, ...result];
}

function precomputeAdx(data: StockData[], period: number): number[] {
  if (data.length < period + 2) return data.map(() => 0);
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const up = data[i].high - data[i - 1].high;
    const down = data[i - 1].low - data[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const h = data[i].high, l = data[i].low, pc = data[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const smooth = (arr: number[]) => {
    const seed = arr.slice(0, period).reduce((s, v) => s + v, 0);
    const out = [seed];
    for (let i = period; i < arr.length; i++) {
      out.push(out[out.length - 1] - out[out.length - 1] / period + arr[i]);
    }
    return out;
  };
  const strS = smooth(tr), pdmS = smooth(plusDM), mdmS = smooth(minusDM);
  const dx: number[] = [];
  let plusDI = 0, minusDI = 0;
  for (let i = 0; i < strS.length; i++) {
    const trs = strS[i] || 1e-9;
    plusDI = (pdmS[i] / trs) * 100;
    minusDI = (mdmS[i] / trs) * 100;
    dx.push((Math.abs(plusDI - minusDI) / (plusDI + minusDI + 1e-9)) * 100);
  }
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period + 1) { result.push(0); continue; }
    const dxIdx = i - 1;
    const window = dx.slice(Math.max(0, dxIdx - period + 1), dxIdx + 1);
    result.push(window.reduce((s, v) => s + v, 0) / (window.length || 1));
  }
  return result;
}

function precomputeRsi(data: StockData[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(50); continue; }
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].close - data[j - 1].close;
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period, avgLoss = losses / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}
