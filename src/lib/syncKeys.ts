/**
 * syncKeys.ts — single source of truth for keys mirrored across
 * localStorage / SQLite / Supabase. Imported by both storage.ts and
 * supabaseDb.ts to avoid circular dependencies.
 */

// ─── Config keys (small values, stored in SQLite `config` table) ──

export const CONFIG_KEYS = [
  'stockpulse_watchlist',
  'stockpulse_users',
  'stockpulse_auth',
  'stockpulse_admin_auth',
  'stockpulse_api_config',
  'sp-lang',
  'stockpulse_recent_stocks',
] as const;

// ─── Document keys (large JSON, stored in SQLite `documents` table) ─

export const DOCUMENT_KEYS = [
  'stockpulse_screener_results',
  'stockpulse_avs_results',
  'stockpulse_politician_trades',
  'stockpulse_trump_trades',
  'stockpulse_featured_trades',
  'stockpulse_cron_history',
  'stockpulse_alerts',
  'stockpulse_alert_config',
  'stockpulse_market_snapshot',
  'stockpulse_master_matrix',
  'stockpulse_trade_ledger',
] as const;
