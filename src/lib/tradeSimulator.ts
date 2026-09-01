/**
 * tradeSimulator.ts — simulated multi-trader transaction ledger.
 *
 * A cast of named "people" (archetypes), each bound to a distinct analytic
 * engine (12 Masters / Matrix / Tactical / multi-agent), buy and sell across a
 * shared stock universe every trading day. Every transaction is recorded in a
 * persistent ledger, and each person's account (cash + positions) is
 * mark-to-market daily.
 *
 * Design (see docs/CODEBASE.md):
 *  - Personas: Value / Wealth / Contrarian (12 Masters), Momentum (Matrix
 *    rank/trend), Tactical (runEngine), Agent (runTradingAgents).
 *  - Decision: translate the bound engine's signal into BUY/SELL/HOLD gated by
 *    a per-person threshold.
 *  - Money: long-only, real-calendar; each person starts with $100k cash;
 *    fills at the day's quote; 10% of current equity per buy; -8% hard stop,
 *    +30% take-profit. No fees, no margin.
 *  - Universe: A shared daily set of symbols (e.g. the Master Matrix's ranked
 *    top-N). Personas apply their own thresholds on top.
 *
 * The signal layer is injected (`SignalSupplier`) so the pure account math is
 * unit-testable and the page can decide how to source each engine's output.
 */

export type Action = 'BUY' | 'SELL' | 'HOLD';

export type PersonaId = 'value' | 'wealth' | 'contrarian' | 'momentum' | 'tactical' | 'agent';

export interface Persona {
  id: PersonaId;
  name: string;
  engine: string;
  description: string;
}

export const PERSONAS: Persona[] = [
  { id: 'value', name: 'Warren', engine: '12 Masters', description: 'Bargain hunter — buys strong consensus' },
  { id: 'wealth', name: 'Eleanor', engine: '12 Masters', description: 'High-conviction value — only pristine setups' },
  { id: 'contrarian', name: 'Temple', engine: '12 Masters (inverted)', description: 'Buys the hated, sells the loved' },
  { id: 'momentum', name: 'Nancy', engine: 'Matrix rank', description: 'Rides leaders above the trend line' },
  { id: 'tactical', name: 'Jerry', engine: 'Tactical engine', description: 'Entries/exits with stops and sizing' },
  { id: 'agent', name: 'Ada', engine: 'Trading agents', description: 'Full analyst+debate pipeline' },
];

/** Per-person, per-symbol signal computed by the bound engine for a day. */
export interface SymbolSignal {
  symbol: string;
  price: number;
  changePercent: number;
  /** Engine's coarse call for this symbol today. */
  action: Action;
  /** 0-100 strength of the signal (confidence / conviction / score-derived). */
  strength: number;
  /** Masters consensus detail (for Value/Wealth/Contrarian). */
  buyCount?: number;
  sellCount?: number;
  avgConfidence?: number;
  /** Engine-provided exit guidance (Tactical). */
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Optional engine-provided fractional size (0-1 of equity). */
  sizeFraction?: number;
  /** Human-readable reason for the call (persisted in the decision log). */
  reason?: string;
}

/** Daily per-symbol signal set for a single persona. */
export interface PersonaDaySignals {
  date: string;
  personaId: PersonaId;
  /** signals that led to a BUY decision (the person buys when fired). */
  buySignals: SymbolSignal[];
  /** every symbol the person currently holds or is evaluating. */
  watch: SymbolSignal[];
}

/** A single recorded decision for one symbol on one day (incl. HOLD). */
export interface PersonaDecision {
  symbol: string;
  action: Action;
  price: number;
  changePercent: number;
  strength: number;
  buyCount?: number;
  sellCount?: number;
  avgConfidence?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  reason: string;
}

/** One persona's decision log for a given day. Accumulated across days. */
export interface DailyDecisionLog {
  date: string;
  personaId: PersonaId;
  decisions: PersonaDecision[];
}

/** A recorded fill. */
export interface Trade {
  id: string;
  date: string;
  personaId: PersonaId;
  symbol: string;
  action: 'BUY' | 'SELL';
  qty: number;
  price: number;
  value: number;
  realizedPnl: number; // 0 on buys; P/L on sells
  note: string;
}

/** An open holding. */
export interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  stop: number | null;
  target: number | null;
}

export interface PersonAccount {
  personaId: PersonaId;
  cash: number;
  positions: Position[];
  lastRunDate: string | null;
}

export interface LedgerStore {
  createdAt: string;
  initialCash: number;
  accounts: Record<PersonaId, PersonAccount>;
  trades: Trade[];
  /** date (YYYY-MM-DD) of the most recent completed simulation pass. */
  lastRunDate: string | null;
  /** symbol -> closing price snapshot from the last simulated day (for M2M). */
  prices: Record<string, number>;
  /** accumulated per-person, per-day decision logs (incl. HOLDs). */
  decisions: DailyDecisionLog[];
}

export const LEDGER_KEY = 'stockpulse_trade_ledger';

export const STARTING_CASH = 100_000;
export const POSITION_FRACTION = 0.1; // 10% of current equity per buy
export const STOP_LOSS = -0.08;
export const TAKE_PROFIT = 0.30;

/** Create a fresh empty ledger. */
export function createLedger(): LedgerStore {
  const accounts = {} as Record<PersonaId, PersonAccount>;
  for (const p of PERSONAS) {
    accounts[p.id] = { personaId: p.id, cash: STARTING_CASH, positions: [], lastRunDate: null };
  }
  return { createdAt: new Date().toISOString(), initialCash: STARTING_CASH, accounts, trades: [], lastRunDate: null, prices: {}, decisions: [] };
}

let tradeSeq = 0;
function nextTradeId(): string {
  tradeSeq += 1;
  return `t${Date.now()}_${tradeSeq}`;
}

/** Current mark-to-market equity of an account. */
export function accountEquity(acct: PersonAccount, prices: Record<string, number>): number {
  let equity = acct.cash;
  for (const pos of acct.positions) {
    const px = prices[pos.symbol] ?? pos.avgCost;
    equity += pos.qty * px;
  }
  return equity;
}

/** Total P/L (started at STARTING_CASH) for a person. */
export function personaPnl(acct: PersonAccount, prices: Record<string, number>): number {
  return accountEquity(acct, prices) - STARTING_CASH;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Apply one day's signals to a person's account. Pure: returns a new account
 * plus a list of trades; does not mutate the input.
 */
export function runDayForPerson(
  acct: PersonAccount,
  day: PersonaDaySignals,
): { account: PersonAccount; trades: Trade[] } {
  const trades: Trade[] = [];
  const account: PersonAccount = {
    personaId: acct.personaId,
    cash: acct.cash,
    positions: acct.positions.map(p => ({ ...p })),
    lastRunDate: day.date,
  };
  const prices: Record<string, number> = {};
  for (const s of day.watch) prices[s.symbol] = s.price;

  const positionsBySymbol = new Map(account.positions.map(p => [p.symbol.toUpperCase(), p]));

  // 1. Evaluate exits for existing positions (signal flip / stop / target).
  for (const s of day.watch) {
    const pos = positionsBySymbol.get(s.symbol.toUpperCase());
    if (!pos) continue;
    const sell = shouldSell(pos, s);
    if (sell) {
      const qty = pos.qty;
      const value = round2(qty * s.price);
      const cost = round2(qty * pos.avgCost);
      const realizedPnl = round2(value - cost);
      account.cash = round2(account.cash + value);
      account.positions = account.positions.filter(p => p.symbol.toUpperCase() !== s.symbol.toUpperCase());
      trades.push({
        id: nextTradeId(),
        date: day.date,
        personaId: day.personaId,
        symbol: s.symbol,
        action: 'SELL',
        qty,
        price: s.price,
        value,
        realizedPnl,
        note: `exit (${sell})`,
      });
    }
  }

  // 2. Evaluate buys.
  for (const s of day.buySignals) {
    if (positionsBySymbol.has(s.symbol.toUpperCase())) continue; // already holding — no doubling up
    if (s.action !== 'BUY') continue;
    const equity = accountEquity(account, prices);
    const budget = equity * (s.sizeFraction ?? POSITION_FRACTION);
    if (budget <= 0) continue;
    const available = budget < account.cash ? budget : account.cash;
    const qty = Math.floor(available / s.price);
    if (qty <= 0) continue;
    const value = round2(qty * s.price);
    const stop = s.stopLoss ?? round2(s.price * (1 + STOP_LOSS));
    const target = s.takeProfit ?? round2(s.price * (1 + TAKE_PROFIT));
    account.cash = round2(account.cash - value);
    account.positions.push({ symbol: s.symbol, qty, avgCost: s.price, stop, target });
    trades.push({
      id: nextTradeId(),
      date: day.date,
      personaId: day.personaId,
      symbol: s.symbol,
      action: 'BUY',
      qty,
      price: s.price,
      value,
      realizedPnl: 0,
      note: 'open',
    });
  }

  return { account, trades };
}

/** Decide whether an existing position should be sold today. */
function shouldSell(pos: Position, s: SymbolSignal): string | null {
  if (pos.stop != null && s.price <= pos.stop) return 'stop-loss hit';
  if (pos.target != null && s.price >= pos.target) return 'take-profit hit';
  if (s.action === 'SELL') return 'signal flipped to sell';
  return null;
}

/** Mark accounts to market using the day's prices (leaderboard). */
export function markToMarketDays(ledger: LedgerStore, prices: Record<string, number>): LedgerStore {
  const accts = {} as Record<PersonaId, PersonAccount>;
  for (const p of PERSONAS) {
    accts[p.id] = { ...ledger.accounts[p.id] };
  }
  return { ...ledger, accounts: accts };
}

// ─── Signal suppliers (per-engine decision functions) ──────────────

export interface MatrixRowLike {
  symbol: string;
  price: number;
  changePercent: number;
  score: number;
  buyCount: number;
  sellCount: number;
  name?: string;
}

/**
 * Value — buys only when the 12 Masters show a BUY-leaning consensus.
 */
export function valueDecision(r: MatrixRowLike): SymbolSignal {
  const VOTE_NEEDED = 2;
  const buy = r.buyCount >= VOTE_NEEDED;
  const strength = (r.buyCount / 12) * 100;
  const action: Action = buy ? 'BUY' : r.sellCount >= 4 ? 'SELL' : 'HOLD';
  const reason = buy
    ? `${r.buyCount}/${12} masters vote BUY — value consensus reached`
    : r.sellCount >= 4
      ? `${r.sellCount}/${12} masters vote SELL/AVOID — value broken`
      : `Only ${r.buyCount}/${12} BUY votes — below the ${VOTE_NEEDED} threshold`;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength, reason,
  };
}

/**
 * Wealth — a stricter value screen (needs a clear majority of BUY votes).
 */
export function wealthDecision(r: MatrixRowLike): SymbolSignal {
  const ratio = r.buyCount / 12;
  const action: Action = ratio >= 0.35 ? 'BUY' : r.sellCount >= 5 ? 'SELL' : 'HOLD';
  const strength = ratio * 100;
  const reason = action === 'BUY'
    ? `${r.buyCount}/${12} BUY votes (${(ratio * 100).toFixed(0)}%) — high-conviction value`
    : action === 'SELL'
      ? `${r.sellCount}/${12} SELL/AVOID — wealth-level weakness`
      : `${r.buyCount}/${12} BUY votes — below 35% bar`;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength, reason,
  };
}

/**
 * Contrarian — buys names the 12 Masters hate (high SELL/AVOID), sells when
 * they recover to a BUY-leaning consensus.
 */
export function contrarianDecision(r: MatrixRowLike): SymbolSignal {
  const hated = r.sellCount >= 4 && r.buyCount <= 2;
  const action: Action = hated ? 'BUY' : r.buyCount >= 3 ? 'SELL' : 'HOLD';
  const strength = Math.min(100, r.sellCount * 14);
  const reason = hated
    ? `${r.sellCount}/${12} SELL/AVOID — maximum pessimism, contrarian buy`
    : r.buyCount >= 3
      ? `${r.buyCount}/${12} BUY votes — the crowd has returned, contrarian sell`
      : `Sentiment flat (${r.sellCount} sell / ${r.buyCount} buy) — not yet hated enough`;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength, reason,
  };
}

/**
 * Momentum — buys strong Matrix rank (+ price above its 20-day SMA). The row
 * carries score and trend info; `trendUp` is derived by the caller (price vs SMA).
 */
export function momentumDecision(r: MatrixRowLike, trendUp: boolean): SymbolSignal {
  const inTop = r.score >= 25; // solid consensus-weighted score
  const action: Action = inTop && trendUp ? 'BUY' : !trendUp ? 'SELL' : 'HOLD';
  const strength = Math.min(100, r.score);
  const reason = action === 'BUY'
    ? `Score ${r.score.toFixed(1)} (≥25) and price above 20-SMA — leading momentum`
    : action === 'SELL'
      ? `Price below its 20-day SMA — momentum broken`
      : `Score ${r.score.toFixed(1)} below the 25 bar — no momentum edge`;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength, reason,
  };
}

/**
 * Tactical — the engine already returned BUY with sizing and exits.
 */
export function tacticalDecision(s: { symbol: string; price: number; action: Action; stopLoss: number | null; takeProfit: number | null; sizeFraction?: number }): SymbolSignal {
  const strength = s.action === 'BUY' ? 80 : s.action === 'SELL' ? 20 : 50;
  const reason = s.action === 'BUY'
    ? 'Tactical entry signal fired with a defined stop/target'
    : s.action === 'SELL'
      ? 'Tactical exit / trailing stop triggered'
      : 'No tactical entry or exit signal today';
  return {
    symbol: s.symbol, price: s.price, changePercent: 0,
    action: s.action, strength, stopLoss: s.stopLoss, takeProfit: s.takeProfit, sizeFraction: s.sizeFraction, reason,
  };
}

/**
 * Agent — buys on Buy/Overweight rating with strong conviction.
 */
export function agentDecision(r: {
  symbol: string; price: number; rating: 'Buy' | 'Overweight' | 'Hold' | 'Underweight' | 'Sell'; conviction: number;
}): SymbolSignal {
  const buy = r.rating === 'Buy' || r.rating === 'Overweight';
  const action: Action = buy ? 'BUY' : r.rating === 'Sell' || r.rating === 'Underweight' ? 'SELL' : 'HOLD';
  const reason = action === 'BUY'
    ? `Agent panel rated ${r.rating} (conviction ${r.conviction}) — initiate`
    : action === 'SELL'
      ? `Agent panel rated ${r.rating} (conviction ${r.conviction}) — reduce/exit`
      : `Agent panel rated ${r.rating} (conviction ${r.conviction}) — hold`;
  return {
    symbol: r.symbol, price: r.price, changePercent: 0,
    action, strength: r.conviction, reason,
  };
}

/** Build a default (empty) signal for a symbol so watch lists always have a price. */
export function holdSignal(symbol: string, price: number, changePercent = 0): SymbolSignal {
  return { symbol, price, changePercent, action: 'HOLD', strength: 0, reason: 'No signal evaluated' };
}

/** Convert a persona's daily signal set into a persistent decision log entry.
 *  Every evaluated symbol (incl. HOLD) is recorded with its action, price,
 *  strength and reason. */
export function buildDecisionLog(day: PersonaDaySignals): DailyDecisionLog {
  const bySymbol = new Map<string, SymbolSignal>();
  for (const s of day.watch) {
    const prev = bySymbol.get(s.symbol.toUpperCase());
    // Prefer the richer signal (a BUY/SELL over a bare HOLD placeholder).
    if (!prev || (s.action !== 'HOLD' && prev.action === 'HOLD')) bySymbol.set(s.symbol.toUpperCase(), s);
  }
  for (const s of day.buySignals) bySymbol.set(s.symbol.toUpperCase(), s);

  const decisions: PersonaDecision[] = [];
  for (const s of bySymbol.values()) {
    decisions.push({
      symbol: s.symbol,
      action: s.action,
      price: s.price,
      changePercent: s.changePercent ?? 0,
      strength: s.strength,
      buyCount: s.buyCount,
      sellCount: s.sellCount,
      avgConfidence: s.avgConfidence,
      stopLoss: s.stopLoss ?? null,
      takeProfit: s.takeProfit ?? null,
      reason: s.reason ?? (s.action === 'HOLD' ? 'Held' : `${s.action}`),
    });
  }
  decisions.sort((a, b) => b.strength - a.strength);
  return { date: day.date, personaId: day.personaId, decisions };
}
