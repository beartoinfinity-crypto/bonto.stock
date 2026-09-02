// ledgerView.ts — pure, testable projections + filters for the trade ledger
// tables (Decisions + All Transactions). Kept free of UI so the filter/sort
// semantics can be unit-tested for result verification.

import {
  PersonaId,
  PersonaDecision,
  DailyDecisionLog,
  Trade,
} from './tradeSimulator';

/** Filter/sort state shared by both ledger tables. */
export interface ViewFilters {
  persona: 'all' | PersonaId;
  action: 'all' | 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  search: string;
  date: 'all' | string;
  sort: string;
}

export const DEFAULT_VIEW_FILTERS: ViewFilters = {
  persona: 'all',
  action: 'all',
  symbol: '',
  search: '',
  date: 'all',
  sort: 'date-desc',
};

/** A single decision row with its owning day + persona attached. */
export interface FlatDecision extends PersonaDecision {
  date: string;
  personaId: PersonaId;
}

export function flatDecisions(logs: DailyDecisionLog[]): FlatDecision[] {
  return logs.flatMap(l =>
    l.decisions.map(d => ({ ...d, date: l.date, personaId: l.personaId }))
  );
}

/** Distinct dates present in the rows, newest first. */
export function distinctDates(rows: Array<{ date: string }>): string[] {
  return [...new Set(rows.map(r => r.date))].sort((a, b) => b.localeCompare(a));
}

function matchesSymbol(symbol: string, needle: string): boolean {
  const s = needle.trim().toUpperCase();
  return s === '' || symbol.toUpperCase().includes(s);
}

function matchesText(text: string, needle: string): boolean {
  const s = needle.trim().toLowerCase();
  return s === '' || (text ?? '').toLowerCase().includes(s);
}

/** Apply the shared filters to an accumulated trade history. */
export function filterTrades(trades: Trade[], f: ViewFilters): Trade[] {
  return trades.filter(t => {
    if (f.persona !== 'all' && t.personaId !== f.persona) return false;
    if (f.action !== 'all' && t.action !== f.action) return false;
    if (!matchesSymbol(t.symbol, f.symbol)) return false;
    if (f.date !== 'all' && t.date !== f.date) return false;
    if (!matchesText(t.note, f.search)) return false;
    return true;
  });
}

/** Apply the shared filters to the accumulated decision log. */
export function filterDecisions(rows: FlatDecision[], f: ViewFilters): FlatDecision[] {
  return rows.filter(r => {
    if (f.persona !== 'all' && r.personaId !== f.persona) return false;
    if (f.action !== 'all' && r.action !== f.action) return false;
    if (!matchesSymbol(r.symbol, f.symbol)) return false;
    if (f.date !== 'all' && r.date !== f.date) return false;
    if (!matchesText(r.reason, f.search)) return false;
    return true;
  });
}

export function sortTrades(trades: Trade[], sort: string): Trade[] {
  const copy = [...trades];
  switch (sort) {
    case 'date-asc':
      copy.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
      break;
    case 'symbol':
      copy.sort((a, b) => a.symbol.localeCompare(b.symbol) || b.date.localeCompare(a.date));
      break;
    case 'value':
      copy.sort((a, b) => b.value - a.value);
      break;
    case 'pnl':
      copy.sort((a, b) => b.realizedPnl - a.realizedPnl);
      break;
    default:
      copy.sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol));
  }
  return copy;
}

export function sortDecisions(rows: FlatDecision[], sort: string): FlatDecision[] {
  const copy = [...rows];
  switch (sort) {
    case 'date-asc':
      copy.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
      break;
    case 'symbol':
      copy.sort((a, b) => a.symbol.localeCompare(b.symbol) || b.date.localeCompare(a.date));
      break;
    case 'strength':
      copy.sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date));
      break;
    case 'action':
      copy.sort((a, b) => a.action.localeCompare(b.action) || b.date.localeCompare(a.date));
      break;
    default:
      copy.sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol));
  }
  return copy;
}