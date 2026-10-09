/**
 * optionsFlow.ts — options-tape analytics for the /flow screen (greeksoup's
 * Flow port): put/call ratios, open-interest walls, max pain, expected move
 * from the ATM straddle, and unusual activity.
 *
 * Input is the normalized CBOE delayed-quote tape served by /api/cboe/options
 * (compact keys e/k/t/b/a/l/v/o/i/d). All math is deterministic rule-based
 * arithmetic — no AI/ML. Quotes are delayed ~15 minutes.
 */

export interface OptionQuote {
  expiry: string;      // YYYY-MM-DD
  strike: number;
  type: 'C' | 'P';
  bid: number;
  ask: number;
  last: number;
  volume: number;
  oi: number;
  iv: number | null;   // annualized decimal (0.26 = 26%)
  delta: number | null;
}

export interface OptionsTape {
  symbol: string;
  price: number | null;
  priceChangePercent: number | null;
  iv30: number | null;
  timestamp: string | null;
  contracts: OptionQuote[];
}

/** Compact wire row as produced by the /api/cboe/options endpoint. */
export interface RawContract {
  e?: unknown;
  k?: unknown;
  t?: unknown;
  b?: unknown;
  a?: unknown;
  l?: unknown;
  v?: unknown;
  o?: unknown;
  i?: unknown;
  d?: unknown;
}

export interface RawTape {
  symbol?: unknown;
  price?: unknown;
  priceChangePercent?: unknown;
  iv30?: unknown;
  timestamp?: unknown;
  contracts?: RawContract[] | unknown;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const nullableNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Map the server's compact payload into a typed tape (drops malformed rows). */
export function parseTape(raw: RawTape): OptionsTape | null {
  if (!raw || !Array.isArray(raw.contracts)) return null;
  const contracts: OptionQuote[] = [];
  for (const c of raw.contracts as RawContract[]) {
    if (!c || typeof c.e !== 'string' || typeof c.k !== 'number') continue;
    if (c.t !== 'C' && c.t !== 'P') continue;
    contracts.push({
      expiry: c.e,
      strike: num(c.k),
      type: c.t,
      bid: num(c.b),
      ask: num(c.a),
      last: num(c.l),
      volume: num(c.v),
      oi: num(c.o),
      iv: nullableNum(c.i),
      delta: nullableNum(c.d),
    });
  }
  return {
    symbol: typeof raw.symbol === 'string' ? raw.symbol : '',
    price: nullableNum(raw.price),
    priceChangePercent: nullableNum(raw.priceChangePercent),
    iv30: nullableNum(raw.iv30),
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : null,
    contracts,
  };
}

/** Unique expiries, ascending. */
export function listExpiries(tape: OptionsTape): string[] {
  return [...new Set(tape.contracts.map(c => c.expiry))].sort();
}

/**
 * Nearest expiry on/after `today` (ISO date); when every expiry is in the
 * past (stale tape) fall back to the last one.
 */
export function nearestExpiry(tape: OptionsTape, todayISO: string): string | null {
  const expiries = listExpiries(tape);
  if (!expiries.length) return null;
  return expiries.find(e => e >= todayISO) ?? expiries[expiries.length - 1];
}

export function contractsFor(tape: OptionsTape, expiry: string): OptionQuote[] {
  return tape.contracts.filter(c => c.expiry === expiry);
}

export interface ChainRow {
  strike: number;
  call: OptionQuote | null;
  put: OptionQuote | null;
}

/** One row per strike (call/put side by side), ascending. */
export function chainRows(contracts: OptionQuote[]): ChainRow[] {
  const byStrike = new Map<number, ChainRow>();
  for (const c of contracts) {
    let row = byStrike.get(c.strike);
    if (!row) {
      row = { strike: c.strike, call: null, put: null };
      byStrike.set(c.strike, row);
    }
    if (c.type === 'C' && !row.call) row.call = c;
    else if (c.type === 'P' && !row.put) row.put = c;
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

export interface PutCallRatios {
  /** put volume / call volume (null when the call side has no volume) */
  byVolume: number | null;
  /** put open interest / call open interest */
  byOi: number | null;
  callVolume: number;
  putVolume: number;
  callOi: number;
  putOi: number;
}

export function putCallRatios(contracts: OptionQuote[]): PutCallRatios {
  let callVolume = 0, putVolume = 0, callOi = 0, putOi = 0;
  for (const c of contracts) {
    if (c.type === 'C') { callVolume += c.volume; callOi += c.oi; }
    else { putVolume += c.volume; putOi += c.oi; }
  }
  return {
    byVolume: callVolume > 0 ? putVolume / callVolume : null,
    byOi: callOi > 0 ? putOi / callOi : null,
    callVolume,
    putVolume,
    callOi,
    putOi,
  };
}

export interface OiWall {
  strike: number;
  oi: number;
}

export interface OiWalls {
  call: OiWall | null;
  put: OiWall | null;
}

/** Highest open-interest strike per side (the "walls" price tends to pin to). */
export function oiWalls(contracts: OptionQuote[]): OiWalls {
  let call: OiWall | null = null;
  let put: OiWall | null = null;
  for (const c of contracts) {
    if (c.oi <= 0) continue;
    if (c.type === 'C' && (!call || c.oi > call.oi)) call = { strike: c.strike, oi: c.oi };
    if (c.type === 'P' && (!put || c.oi > put.oi)) put = { strike: c.strike, oi: c.oi };
  }
  return { call, put };
}

/**
 * Max pain: the strike where total written-option payout to holders is
 * minimal — the expiry's price-magnet candidate. Hand-computable examples
 * are covered by the unit tests.
 */
export function maxPainStrike(contracts: OptionQuote[]): number | null {
  const strikes = [...new Set(contracts.map(c => c.strike))].sort((a, b) => a - b);
  if (!strikes.length) return null;
  let best: number | null = null;
  let bestLoss = Infinity;
  for (const s of strikes) {
    let loss = 0;
    for (const c of contracts) {
      if (c.oi <= 0) continue;
      if (c.type === 'C' && s > c.strike) loss += c.oi * (s - c.strike);
      else if (c.type === 'P' && s < c.strike) loss += c.oi * (c.strike - s);
    }
    if (loss < bestLoss) {
      bestLoss = loss;
      best = s;
    }
  }
  return best;
}

/** Mid price with a last-price fallback; null when the market is unusable. */
export function midPrice(q: OptionQuote): number | null {
  if (q.bid > 0 && q.ask > 0) return (q.bid + q.ask) / 2;
  if (q.last > 0) return q.last;
  return null;
}

export interface ExpectedMove {
  amount: number;      // ± dollars
  pct: number;         // ± percent of spot
  expiry: string;
  strike: number;
  straddleMid: number;
}

/**
 * Expected move over an expiry from the ATM straddle, using the standard
 * rule of thumb that a one-standard-deviation (~68%) range is about 0.85×
 * the ATM straddle mid. Requires spot and both sides to quote at the ATM
 * strike; returns null otherwise.
 */
export function expectedMove(spot: number | null, contracts: OptionQuote[]): ExpectedMove | null {
  if (spot === null || !(spot > 0) || !contracts.length) return null;
  const rows = chainRows(contracts);
  if (!rows.length) return null;
  // ATM = strike nearest spot that quotes both sides
  let atm: ChainRow | null = null;
  let bestDist = Infinity;
  for (const row of rows) {
    if (!row.call || !row.put) continue;
    const dist = Math.abs(row.strike - spot);
    if (dist < bestDist) { bestDist = dist; atm = row; }
  }
  if (!atm || !atm.call || !atm.put) return null;
  const callMid = midPrice(atm.call);
  const putMid = midPrice(atm.put);
  if (callMid === null || putMid === null) return null;
  const straddleMid = callMid + putMid;
  const amount = straddleMid * 0.85;
  return {
    amount,
    pct: (amount / spot) * 100,
    expiry: atm.call.expiry,
    strike: atm.strike,
    straddleMid,
  };
}

export interface UnusualRow {
  quote: OptionQuote;
  /** volume ÷ open interest (Infinity when OI is 0 but volume traded) */
  turnover: number;
}

/**
 * Unusual activity: contracts trading at least 2× their open interest
 * (or with volume but no OI at all), busiest first.
 */
export function unusualActivity(contracts: OptionQuote[], limit = 12): UnusualRow[] {
  return contracts
    .filter(c => c.volume > 0 && (c.oi <= 0 || c.volume >= 2 * c.oi))
    .map(c => ({ quote: c, turnover: c.oi > 0 ? c.volume / c.oi : Infinity }))
    .sort((a, b) => b.quote.volume - a.quote.volume)
    .slice(0, limit);
}

/** Human verdict for a put/call ratio (>1 = more puts than calls traded). */
export function ratioVerdict(ratio: number | null): 'bullish' | 'bearish' | 'neutral' | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio >= 1.1) return 'bearish';
  if (ratio <= 0.8) return 'bullish';
  return 'neutral';
}
