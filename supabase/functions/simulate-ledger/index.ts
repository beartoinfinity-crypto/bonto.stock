// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: simulate-ledger
//
// Runs the simulated-traders day ONCE, server-side, from cloud data only:
//   universe  <- stockpulse_kv key `stockpulse_master_matrix` (latest snapshot)
//   prices    <- stock_quotes / stock_historical (refreshed by sync-stock-data)
//   ledger    <- stockpulse_kv key `stockpulse_trade_ledger` (upsert back)
//
// Mirrors the browser semantics of useTradeLedger.simulateDay + tradeSimulator:
//   - write-protected: a day runs at most once (lastRunDate === date -> no-op)
//   - personas: value / wealth / contrarian (12-master votes), momentum
//     (score + 20-SMA trend), tactical (ported engine), agent (bounded rating)
//   - fills at the day's price, 10% equity per buy, -8% stop / +30% target
//   - heals legacy same-day BUY+SELL conflicts on write
// Scheduled via pg_cron (see supabase/schedules.sql).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { runEngine, DEFAULT_PARAMS, StockData } from '../compute-tactical-history/engine.ts';

// ─── Constants (mirror tradeSimulator.ts) ──────────────────────────

const LEDGER_KEY = 'stockpulse_trade_ledger';
const MATRIX_KEY = 'stockpulse_master_matrix';
const STARTING_CASH = 100_000;
const POSITION_FRACTION = 0.1;
const STOP_LOSS = -0.08;
const TAKE_PROFIT = 0.30;
const HEAVY_TOPN = 8;

type PersonaId = 'value' | 'wealth' | 'contrarian' | 'momentum' | 'tactical' | 'agent';
const PERSONA_IDS: PersonaId[] = ['value', 'wealth', 'contrarian', 'momentum', 'tactical', 'agent'];

// ─── Ledger types (mirror tradeSimulator.ts) ────────────────────────

interface Position { symbol: string; qty: number; avgCost: number; stop: number | null; target: number | null; }
interface PersonAccount { personaId: PersonaId; cash: number; positions: Position[]; lastRunDate: string | null; }
interface Trade {
  id: string; date: string; personaId: PersonaId; symbol: string;
  action: 'BUY' | 'SELL'; qty: number; price: number; value: number;
  realizedPnl: number; note: string;
}
interface PersonaDecision {
  symbol: string; action: string; price: number; changePercent: number;
  strength: number; buyCount?: number; sellCount?: number; avgConfidence?: number;
  stopLoss: number | null; takeProfit: number | null; reason: string;
}
interface DailyDecisionLog { date: string; personaId: PersonaId; decisions: PersonaDecision[]; }
interface LedgerStore {
  createdAt: string; initialCash: number;
  accounts: Record<PersonaId, PersonAccount>;
  trades: Trade[]; lastRunDate: string | null;
  prices: Record<string, number>; decisions: DailyDecisionLog[];
}

interface SymbolSignal {
  symbol: string; price: number; changePercent: number; action: 'BUY' | 'SELL' | 'HOLD';
  strength: number; buyCount?: number; sellCount?: number; avgConfidence?: number;
  stopLoss?: number | null; takeProfit?: number | null; sizeFraction?: number; reason: string;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function freshAccounts(): Record<PersonaId, PersonAccount> {
  const accounts = {} as Record<PersonaId, PersonAccount>;
  for (const p of PERSONA_IDS) accounts[p] = { personaId: p, cash: STARTING_CASH, positions: [], lastRunDate: null };
  return accounts;
}

function createLedger(): LedgerStore {
  return {
    createdAt: new Date().toISOString(), initialCash: STARTING_CASH,
    accounts: freshAccounts(), trades: [], lastRunDate: null, prices: {}, decisions: [],
  };
}

// ─── Account math (mirror tradeSimulator.runDayForPerson) ─────────

function accountEquity(acct: PersonAccount, prices: Record<string, number>): number {
  let px = 0;
  for (const pos of acct.positions) px += pos.qty * (prices[pos.symbol] ?? pos.avgCost);
  return acct.cash + px;
}

function shouldSell(pos: Position, s: SymbolSignal): string | null {
  if (pos.stop != null && s.price <= pos.stop) return 'stop-loss hit';
  if (pos.target != null && s.price >= pos.target) return 'take-profit hit';
  if (s.action === 'SELL') return 'signal flipped to sell';
  return null;
}

let tradeSeq = 0;
function nextTradeId(): string {
  tradeSeq += 1;
  return `t${Date.now()}_${tradeSeq}`;
}

interface PersonaDaySignals { date: string; personaId: PersonaId; buySignals: SymbolSignal[]; watch: SymbolSignal[]; }

function runDayForPerson(acct: PersonAccount, day: PersonaDaySignals): { account: PersonAccount; trades: Trade[] } {
  const trades: Trade[] = [];
  const account: PersonAccount = {
    personaId: acct.personaId, cash: acct.cash,
    positions: acct.positions.map(p => ({ ...p })), lastRunDate: day.date,
  };
  const prices: Record<string, number> = {};
  for (const s of day.watch) prices[s.symbol] = s.price;
  const positionsBySymbol = new Map(account.positions.map(p => [p.symbol.toUpperCase(), p]));

  // 1. Exits first (sells) — stop / target / signal flip.
  for (const s of day.watch) {
    const pos = positionsBySymbol.get(s.symbol.toUpperCase());
    if (!pos) continue;
    const why = shouldSell(pos, s);
    if (why) {
      const qty = pos.qty;
      const value = round2(qty * s.price);
      const cost = round2(qty * pos.avgCost);
      account.cash = round2(account.cash + value);
      account.positions = account.positions.filter(p => p.symbol.toUpperCase() !== s.symbol.toUpperCase());
      positionsBySymbol.delete(s.symbol.toUpperCase());
      trades.push({
        id: nextTradeId(), date: day.date, personaId: day.personaId, symbol: s.symbol,
        action: 'SELL', qty, price: s.price, value, realizedPnl: round2(value - cost), note: `exit (${why})`,
      });
    }
  }

  // 2. Buys — never double up a held symbol.
  for (const s of day.buySignals) {
    if (positionsBySymbol.has(s.symbol.toUpperCase())) continue;
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
    positionsBySymbol.set(s.symbol.toUpperCase(), account.positions[account.positions.length - 1]);
    trades.push({
      id: nextTradeId(), date: day.date, personaId: day.personaId, symbol: s.symbol,
      action: 'BUY', qty, price: s.price, value, realizedPnl: 0, note: 'open',
    });
  }

  return { account, trades };
}

function buildDecisionLog(day: PersonaDaySignals): DailyDecisionLog {
  const bySymbol = new Map<string, SymbolSignal>();
  for (const s of day.watch) {
    const prev = bySymbol.get(s.symbol.toUpperCase());
    if (!prev || (s.action !== 'HOLD' && prev.action === 'HOLD')) bySymbol.set(s.symbol.toUpperCase(), s);
  }
  for (const s of day.buySignals) bySymbol.set(s.symbol.toUpperCase(), s);

  const decisions: PersonaDecision[] = [];
  for (const s of bySymbol.values()) {
    decisions.push({
      symbol: s.symbol, action: s.action, price: s.price,
      changePercent: s.changePercent ?? 0, strength: s.strength,
      buyCount: s.buyCount, sellCount: s.sellCount, avgConfidence: s.avgConfidence,
      stopLoss: s.stopLoss ?? null, takeProfit: s.takeProfit ?? null,
      reason: s.reason ?? (s.action === 'HOLD' ? 'Held' : `${s.action}`),
    });
  }
  decisions.sort((a, b) => b.strength - a.strength);
  return { date: day.date, personaId: day.personaId, decisions };
}

// ─── Persona decisions (mirror tradeSimulator suppliers) ───────────

interface MatrixRowLike { symbol: string; price: number; changePercent: number; score: number; buyCount: number; sellCount: number; }

function valueDecision(r: MatrixRowLike): SymbolSignal {
  const buy = r.buyCount >= 2;
  const strength = (r.buyCount / 12) * 100;
  const action = buy ? 'BUY' as const : r.sellCount >= 4 ? 'SELL' as const : 'HOLD' as const;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent, action, strength,
    buyCount: r.buyCount, sellCount: r.sellCount, avgConfidence: strength,
    reason: buy
      ? `${r.buyCount}/12 masters vote BUY — value consensus reached`
      : r.sellCount >= 4
        ? `${r.sellCount}/12 masters vote SELL/AVOID — value broken`
        : `Only ${r.buyCount}/12 BUY votes — below the 2 threshold`,
  };
}

function wealthDecision(r: MatrixRowLike): SymbolSignal {
  const ratio = r.buyCount / 12;
  const action = ratio >= 0.35 ? 'BUY' as const : r.sellCount >= 5 ? 'SELL' as const : 'HOLD' as const;
  const strength = ratio * 100;
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent, action, strength,
    buyCount: r.buyCount, sellCount: r.sellCount, avgConfidence: strength,
    reason: action === 'BUY'
      ? `${r.buyCount}/12 BUY votes (${(ratio * 100).toFixed(0)}%) — high-conviction value`
      : action === 'SELL'
        ? `${r.sellCount}/12 SELL/AVOID — wealth-level weakness`
        : `${r.buyCount}/12 BUY votes — below 35% bar`,
  };
}

function contrarianDecision(r: MatrixRowLike): SymbolSignal {
  const hated = r.sellCount >= 4 && r.buyCount <= 2;
  const action = hated ? 'BUY' as const : r.buyCount >= 3 ? 'SELL' as const : 'HOLD' as const;
  const strength = Math.min(100, r.sellCount * 14);
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent, action, strength,
    buyCount: r.buyCount, sellCount: r.sellCount, avgConfidence: strength,
    reason: hated
      ? `${r.sellCount}/12 SELL/AVOID — maximum pessimism, contrarian buy`
      : r.buyCount >= 3
        ? `${r.buyCount}/12 BUY votes — the crowd has returned, contrarian sell`
        : `Sentiment flat (${r.sellCount} sell / ${r.buyCount} buy) — not yet hated enough`,
  };
}

function momentumDecision(r: MatrixRowLike, trendUp: boolean): SymbolSignal {
  const inTop = r.score >= 25;
  const action = inTop && trendUp ? 'BUY' as const : !trendUp ? 'SELL' as const : 'HOLD' as const;
  const strength = Math.min(100, r.score);
  return {
    symbol: r.symbol, price: r.price, changePercent: r.changePercent, action, strength,
    buyCount: r.buyCount, sellCount: r.sellCount, avgConfidence: strength,
    reason: action === 'BUY'
      ? `Score ${r.score.toFixed(1)} (≥25) and price above 20-SMA — leading momentum`
      : action === 'SELL'
        ? `Price below its 20-day SMA — momentum broken`
        : `Score ${r.score.toFixed(1)} below the 25 bar — no momentum edge`,
  };
}

function tacticalDecision(s: { symbol: string; price: number; action: 'BUY' | 'SELL' | 'HOLD'; stopLoss: number | null; takeProfit: number | null; sizeFraction?: number }): SymbolSignal {
  const strength = s.action === 'BUY' ? 80 : s.action === 'SELL' ? 20 : 50;
  return {
    symbol: s.symbol, price: s.price, changePercent: 0, action: s.action, strength,
    stopLoss: s.stopLoss, takeProfit: s.takeProfit, sizeFraction: s.sizeFraction,
    reason: s.action === 'BUY'
      ? 'Tactical entry signal fired with a defined stop/target'
      : s.action === 'SELL'
        ? 'Tactical exit / trailing stop triggered'
        : 'No tactical entry or exit signal today',
  };
}

function agentDecision(r: { symbol: string; price: number; rating: string; conviction: number }): SymbolSignal {
  const buy = r.rating === 'Buy' || r.rating === 'Overweight';
  const action = buy ? 'BUY' as const : (r.rating === 'Sell' || r.rating === 'Underweight') ? 'SELL' as const : 'HOLD' as const;
  return {
    symbol: r.symbol, price: r.price, changePercent: 0, action, strength: r.conviction,
    reason: action === 'BUY'
      ? `Agent panel rated ${r.rating} (conviction ${r.conviction}) — initiate`
      : action === 'SELL'
        ? `Agent panel rated ${r.rating} (conviction ${r.conviction}) — reduce/exit`
        : `Agent panel rated ${r.rating} (conviction ${r.conviction}) — hold`,
  };
}

function holdSignal(symbol: string, price: number, changePercent = 0): SymbolSignal {
  return { symbol, price, changePercent, action: 'HOLD', strength: 0, reason: 'No signal evaluated' };
}

// ─── Heal (mirror ledgerMerge.healSameDayConflicts) ────────────────

function healSameDayConflicts(trades: Trade[]): Trade[] {
  const byKey = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = `${t.personaId}|${t.date}|${t.symbol.toUpperCase()}`;
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }
  const drop = new Set<string>();
  for (const group of byKey.values()) {
    const buys = group.filter(t => t.action === 'BUY');
    const sells = group.filter(t => t.action === 'SELL');
    if (buys.length === 0 || sells.length === 0) continue;
    const buyPrice = buys[0].price;
    if (sells.some(s => Math.abs(s.price - buyPrice) > 0.5)) {
      for (const s of sells) drop.add(s.id);
    }
  }
  if (drop.size === 0) return trades;
  return trades.filter(t => !drop.has(t.id));
}

// ─── Cloud inputs ──────────────────────────────────────────────────

interface MatrixStock { price: number; changePercent: number; verdicts: Record<string, string>; buyCount: number; sellCount: number; score: number; }

async function loadUniverse(supabase: any): Promise<{ symbol: string; price: number; changePercent: number; score: number; buyCount: number; sellCount: number; name?: string }[]> {
  const { data, error } = await supabase.from('stockpulse_kv').select('value').eq('key', MATRIX_KEY).limit(1);
  if (error || !data?.length) return [];
  try {
    const parsed = JSON.parse(data[0].value);
    const snaps = parsed?.snapshots;
    if (!Array.isArray(snaps) || snaps.length === 0) return [];
    const latest = snaps[snaps.length - 1];
    const stocks = latest?.stocks;
    if (!stocks) return [];
    const rows = [];
    for (const [symbol, s] of Object.entries(stocks) as [string, MatrixStock][]) {
      if (!s || typeof s.price !== 'number' || s.price <= 0) continue;
      rows.push({
        symbol, price: s.price, changePercent: s.changePercent ?? 0,
        score: s.score ?? 0, buyCount: s.buyCount ?? 0, sellCount: s.sellCount ?? 0,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

async function loadCloudPrice(supabase: any, symbol: string): Promise<number> {
  const { data } = await supabase.from('stock_quotes').select('data').eq('symbol', symbol.toUpperCase()).limit(1);
  try {
    const q = data?.[0] ? JSON.parse(data[0].data) : null;
    if (q?.price && q.price > 0) return q.price;
  } catch { /* fall through */ }
  const { data: bars } = await supabase.from('stock_historical')
    .select('close').eq('symbol', symbol.toUpperCase()).order('date', { ascending: false }).limit(1);
  const last = bars?.[0]?.close;
  return typeof last === 'number' && last > 0 ? last : 0;
}

async function loadBars(supabase: any, symbol: string): Promise<StockData[]> {
  const { data } = await supabase.from('stock_historical')
    .select('date,open,high,low,close,volume')
    .eq('symbol', symbol.toUpperCase())
    .order('date', { ascending: true })
    .limit(300);
  if (!Array.isArray(data)) return [];
  return data.map((b: any) => ({
    date: String(b.date).slice(0, 10),
    open: b.open ?? b.close, high: b.high ?? b.close,
    low: b.low ?? b.close, close: b.close, volume: b.volume ?? 0,
  })).filter((b: any) => typeof b.close === 'number');
}

async function loadLedger(supabase: any): Promise<LedgerStore | null> {
  const { data } = await supabase.from('stockpulse_kv').select('value').eq('key', LEDGER_KEY).limit(1);
  if (!data?.length) return null;
  try {
    const parsed = JSON.parse(data[0].value) as LedgerStore;
    if (parsed && parsed.accounts && parsed.trades) {
      if (!parsed.decisions) parsed.decisions = [];
      if (!parsed.prices) parsed.prices = {};
      return parsed;
    }
  } catch { /* corrupted row */ }
  return null;
}

async function saveLedger(supabase: any, ledger: LedgerStore): Promise<void> {
  const { error } = await supabase.from('stockpulse_kv').upsert(
    { key: LEDGER_KEY, value: JSON.stringify(ledger), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) throw new Error(`ledger upsert failed: ${error.message}`);
}

// ─── Main ──────────────────────────────────────────────────────────

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return true;
  return req.headers.get('x-cron-secret') === secret;
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return jsonRes({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const date = new Date().toISOString().slice(0, 10);

  // 1. Load ledger (or start fresh) — write-protect check.
  const ledger = (await loadLedger(supabase)) ?? createLedger();
  if (ledger.lastRunDate === date) {
    return jsonRes({ ok: true, simulated: false, reason: `already simulated ${date}`, date });
  }

  // 2. Universe + day prices (cloud snapshot).
  const universe = await loadUniverse(supabase);
  if (universe.length === 0) {
    return jsonRes({ ok: false, simulated: false, reason: 'master matrix snapshot empty in cloud', date }, 503);
  }

  const rows = new Map(universe.map(r => [r.symbol.toUpperCase(), r]));
  const allSymbols = new Set(rows.keys());
  for (const p of PERSONA_IDS) {
    for (const pos of ledger.accounts[p].positions) allSymbols.add(pos.symbol.toUpperCase());
  }
  const rankedList = [...rows.values()].sort((a, b) => b.score - a.score);
  const heavySymbols = rankedList.slice(0, HEAVY_TOPN).map(r => r.symbol.toUpperCase());

  const prices: Record<string, number> = {};
  for (const sym of allSymbols) {
    const row = rows.get(sym);
    prices[sym] = row && row.price > 0 ? row.price : await loadCloudPrice(supabase, sym);
  }

  const histCache = new Map<string, StockData[]>();
  const barsFor = async (sym: string): Promise<StockData[]> => {
    if (!histCache.has(sym)) histCache.set(sym, await loadBars(supabase, sym));
    return histCache.get(sym)!;
  };

  const trendUpFor = async (sym: string): Promise<boolean> => {
    const bars = await barsFor(sym);
    if (bars.length < 20) return false;
    const last20 = bars.slice(-20);
    const sma20 = last20.reduce((s, b) => s + b.close, 0) / 20;
    return bars[bars.length - 1].close > sma20;
  };

  const watch = (sym: string, changePercent = 0): SymbolSignal =>
    holdSignal(sym, prices[sym] ?? 0, changePercent);

  // 3. Resolve each persona's daily signals.
  const days: PersonaDaySignals[] = [];
  for (const p of PERSONA_IDS) {
    const held = new Set(ledger.accounts[p].positions.map(x => x.symbol.toUpperCase()));
    const universeHere = new Set([...allSymbols, ...held]);
    const buySignals: SymbolSignal[] = [];
    const dayWatch: SymbolSignal[] = [];

    for (const sym of universeHere) {
      const row = rows.get(sym);
      if (!row) { dayWatch.push(watch(sym)); continue; }
      const price = prices[sym] ?? row.price;

      if (p === 'tactical' || p === 'agent') {
        const isHeavy = heavySymbols.includes(sym) || held.has(sym);
        if (!isHeavy) { dayWatch.push(holdSignal(sym, price, row.changePercent)); continue; }
      }

      let sig: SymbolSignal;
      if (p === 'value') sig = valueDecision(row);
      else if (p === 'wealth') sig = wealthDecision(row);
      else if (p === 'contrarian') sig = contrarianDecision(row);
      else if (p === 'momentum') sig = momentumDecision(row, await trendUpFor(sym));
      else if (p === 'tactical') {
        const hist = await barsFor(sym);
        const eng = runEngine(hist, { ...DEFAULT_PARAMS, accountEquity: 100_000, initialEquity: 100_000 });
        if (!eng) { sig = holdSignal(sym, price, row.changePercent); }
        else {
          const action = eng.blocked ? 'HOLD' as const : eng.entry.action === 'BUY' ? 'BUY' as const : (eng.exit ? 'SELL' as const : 'HOLD' as const);
          const sizeFraction = eng.sizing?.finalSize && price > 0 ? Math.min(1, (eng.sizing.finalSize * price) / 100_000) : undefined;
          sig = tacticalDecision({ symbol: sym, price, action, stopLoss: eng.entry.stopLoss, takeProfit: eng.entry.takeProfit, sizeFraction });
        }
      } else {
        // agent — bounded rating from the matrix consensus (the browser's
        // bounded path for non-holdings; the full pipeline is too heavy for
        // the edge budget). Rating mirrors agentDecision's 5-tier mapping.
        const ratio = row.buyCount / 12;
        const rating = ratio >= 0.5 ? 'Buy' : ratio >= 0.35 ? 'Overweight' : row.sellCount >= 5 ? 'Sell' : row.sellCount >= 3 ? 'Underweight' : 'Hold';
        const conviction = Math.round(Math.min(100, Math.max(5, row.score)));
        sig = agentDecision({ symbol: sym, price, rating, conviction });
      }

      dayWatch.push(sig);
      if (sig.action === 'BUY') buySignals.push(sig);
    }
    days.push({ date, personaId: p, buySignals, watch: dayWatch });
  }

  // 4. Apply each persona's day.
  const next: LedgerStore = JSON.parse(JSON.stringify(ledger));
  for (const day of days) {
    const { account, trades } = runDayForPerson(next.accounts[day.personaId], day);
    next.accounts[day.personaId] = account;
    next.trades.push(...trades);
    const logEntry = buildDecisionLog(day);
    next.decisions = (next.decisions ?? []).filter(d => !(d.personaId === day.personaId && d.date === day.date));
    next.decisions.push(logEntry);
  }
  next.lastRunDate = date;
  next.prices = prices;
  next.trades = healSameDayConflicts(next.trades);

  // 5. Write back.
  await saveLedger(supabase, next);

  const summary = PERSONA_IDS.map(p => ({
    persona: p,
    buys: next.trades.filter(t => t.date === date && t.personaId === p && t.action === 'BUY').length,
    sells: next.trades.filter(t => t.date === date && t.personaId === p && t.action === 'SELL').length,
  }));

  console.log(`[simulate-ledger] simulated ${date}: ${JSON.stringify(summary)}`);
  return jsonRes({ ok: true, simulated: true, date, universe: universe.length, summary });
});
