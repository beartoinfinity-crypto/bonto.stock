/**
 * ledgerMerge.ts — conflict-free merge of two ledgers.
 *
 * The trade ledger can be written from several machines; without a true merge
 * the last writer's full snapshot would win and destroy the other machine's
 * accumulated days. `mergeLedgers` reconciles two `LedgerStore` snapshots so
 * no recorded history is lost:
 *
 *  - trades:   union by trade id (keep every fill from both sides), THEN
 *              collapse same-day (persona, symbol, side) duplicates produced
 *              by parallel machines so merged accounts never double-count
 *  - decisions: per (personaId, date) — keep the fuller log (same-day re-runs
 *    replace, so a larger decision set on the same day wins)
 *  - accounts: rebuilt by REPLAYING the merged trades from initial cash, so
 *    cash/positions are always consistent with the union of fills
 *  - prices:   the snapshot belonging to the latest `lastRunDate`
 *  - createdAt: earliest; lastRunDate: latest
 *
 * Pure and unit-tested; importable from both the page and supabaseDb.ts
 * (tradeSimulator.ts has no imports, so there is no cycle).
 */

import {
  LedgerStore, Trade, PersonaId, PersonAccount, Position, PERSONAS,
  STARTING_CASH, STOP_LOSS, TAKE_PROFIT,
} from './tradeSimulator';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Replay a chronological fill list into per-persona accounts. */
export function replayAccounts(trades: Trade[], initialCash = STARTING_CASH): Record<PersonaId, PersonAccount> {
  const accounts = {} as Record<PersonaId, PersonAccount>;
  for (const p of PERSONAS) {
    accounts[p.id] = { personaId: p.id, cash: initialCash, positions: [], lastRunDate: null };
  }

  const sorted = [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of sorted) {
    const acct = accounts[t.personaId];
    if (!acct) continue;
    acct.lastRunDate = t.date;
    const pos = acct.positions.find(x => x.symbol.toUpperCase() === t.symbol.toUpperCase());
    if (t.action === 'BUY') {
      if (pos) continue; // no doubling up — mirrors runDayForPerson
      acct.cash = round2(acct.cash - t.value);
      acct.positions.push({
        symbol: t.symbol,
        qty: t.qty,
        avgCost: t.price,
        stop: round2(t.price * (1 + STOP_LOSS)),
        target: round2(t.price * (1 + TAKE_PROFIT)),
      });
    } else {
      // SELL — remove the (fully-fledged) position
      acct.cash = round2(acct.cash + t.value);
      if (pos) acct.positions = acct.positions.filter(x => x !== pos);
    }
  }
  return accounts;
}

/** Merge two `LedgerStore` snapshots into one lossless ledger. */
export function mergeLedgers(a: LedgerStore, b: LedgerStore): LedgerStore {
  const aTrades = a.trades ?? [];
  const bTrades = b.trades ?? [];
  const trades = new Map<string, Trade>();
  for (const t of [...aTrades, ...bTrades]) if (t.id) trades.set(t.id, t);
  const union = [...trades.values()];

  // Same (persona, date, symbol, side) from different machines is the *same
  // logical fill* produced by parallel same-day runs (with machine-specific
  // ids — e.g. t<ts>_1 vs t<later-ts>_1). Keep one canonical fill so merged
  // accounts never double-buy the same day; a single machine can't produce two
  // of these (buys skip symbols already held, sells remove the position).
  const canonical = new Map<string, Trade>();
  for (const t of union) {
    const key = `${t.personaId}|${t.date}|${t.symbol.toUpperCase()}|${t.action}`;
    const prev = canonical.get(key);
    if (!prev || t.value > prev.value || (t.value === prev.value && t.qty > prev.qty)) canonical.set(key, t);
  }
  const mergedTrades = [...canonical.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  const decisions = new Map<string, (typeof a.decisions)[number]>();
  for (const d of [...(a.decisions ?? []), ...(b.decisions ?? [])]) {
    const key = `${d.personaId}|${d.date}`;
    const prev = decisions.get(key);
    if (!prev || (d.decisions?.length ?? 0) >= (prev.decisions?.length ?? 0)) decisions.set(key, d);
  }

  const { latest, latestSide } = pickLatestRun(a.lastRunDate, b.lastRunDate);
  const prices = latestSide === 'a'
    ? a.prices ?? {}
    : latestSide === 'b'
      ? b.prices ?? {}
      : { ...(a.prices ?? {}), ...(b.prices ?? {}) };

  const initialCash = a.initialCash ?? b.initialCash ?? STARTING_CASH;

  return {
    createdAt: a.createdAt && b.createdAt
      ? (a.createdAt < b.createdAt ? a.createdAt : b.createdAt)
      : (a.createdAt ?? b.createdAt),
    initialCash,
    accounts: replayAccounts(mergedTrades, initialCash),
    trades: mergedTrades,
    lastRunDate: latest,
    prices,
    decisions: [...decisions.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)),
  };
}

function pickLatestRun(
  a: string | null,
  b: string | null,
): { latest: string | null; latestSide: 'a' | 'b' | 'both' } {
  if (!a && !b) return { latest: null, latestSide: 'both' };
  if (!a) return { latest: b, latestSide: 'b' };
  if (!b) return { latest: a, latestSide: 'a' };
  if (a === b) return { latest: a, latestSide: 'both' };
  return a > b ? { latest: a, latestSide: 'a' } : { latest: b, latestSide: 'b' };
}