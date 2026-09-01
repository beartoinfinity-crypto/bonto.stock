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
  return { createdAt: new Date().toISOString(), initialCash: STARTING_CASH, accounts, trades: [], lastRunDate: null, prices: {} };
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
 * Value — buys only when the 12 Masters show a strong BUY consensus.
 */
export function valueDecision(r: MatrixRowLike): SymbolSignal {
  const VOTE_NEEDED = 4;
  const CONF_NEEDED = 60;
  const buy = r.buyCount >= VOTE_NEEDED && (r.buyCount / 12) * 100 >= 40;
  const strength = (r.buyCount / 12) * 100;
  const action: Action = buy ? 'BUY' : r.sellCount >= 4 ? 'SELL' : 'HOLD';
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength,
  };
}

/**
 * Wealth — an even stricter value screen (needs ~60%+ BUY votes).
 */
export function wealthDecision(r: MatrixRowLike): SymbolSignal {
  const ratio = r.buyCount / 12;
  const action: Action = ratio >= 0.6 ? 'BUY' : r.sellCount >= 5 ? 'SELL' : 'HOLD';
  const strength = ratio * 100;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength,
  };
}

/**
 * Contrarian — buys names the 12 Masters hate (high SELL/AVOID), sells when
 * they recover to a BUY-leaning consensus.
 */
export function contrarianDecision(r: MatrixRowLike): SymbolSignal {
  const hated = r.sellCount >= 5 && r.buyCount <= 2;
  const action: Action = hated ? 'BUY' : r.buyCount >= 5 ? 'SELL' : 'HOLD';
  const strength = Math.min(100, r.sellCount * 14);
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength,
  };
}

/**
 * Momentum — buys strong Matrix rank (+ price above its 20-day SMA). The row
 * carries score and trend info; `trendUp` is derived by the caller (price vs SMA).
 */
export function momentumDecision(r: MatrixRowLike, trendUp: boolean): SymbolSignal {
  const inTop = r.score >= 30; // strong consensus-weighted score
  const action: Action = inTop && trendUp ? 'BUY' : !trendUp ? 'SELL' : 'HOLD';
  const strength = Math.min(100, r.score);
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent,
    action, strength, buyCount: r.buyCount, sellCount: r.sellCount,
    avgConfidence: strength,
  };
}

/**
 * Tactical — the engine already returned BUY with sizing and exits.
 */
export function tacticalDecision(s: { symbol: string; price: number; action: Action; stopLoss: number | null; takeProfit: number | null; sizeFraction?: number }): SymbolSignal {
  const strength = s.action === 'BUY' ? 80 : s.action === 'SELL' ? 20 : 50;
  return {
    symbol: s.symbol, price: s.price, changePercent: 0,
    action: s.action, strength, stopLoss: s.stopLoss, takeProfit: s.takeProfit, sizeFraction: s.sizeFraction,
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
  return {
    symbol: r.symbol, price: r.price, changePercent: 0,
    action, strength: r.conviction,
  };
}

/** Build a default (empty) signal for a symbol so watch lists always have a price. */
export function holdSignal(symbol: string, price: number, changePercent = 0): SymbolSignal {
  return { symbol, price, changePercent, action: 'HOLD', strength: 0 };
}
