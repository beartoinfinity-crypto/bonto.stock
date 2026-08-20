/**
 * storage.ts — unified read/write layer
 *
 * Every write goes to BOTH localStorage (fast, sync, backward compat)
 * and SQLite (via localDb, for .db file export).
 *
 * Reads come from localStorage (synchronous, zero latency).
 * On first load, localDb.ts migrates existing localStorage → SQLite.
 */

import { getConfig, setConfig, deleteConfig, getDocument, setDocument, deleteDocument } from './localDb';

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
  'stockpulse_cron_history',
  'stockpulse_alerts',
  'stockpulse_alert_config',
  'stockpulse_market_snapshot',
] as const;

// ─── Unified get/set ──────────────────────────────────────────────

export function getItem(key: string): string | null {
  return localStorage.getItem(key);
}

export function setItem(key: string, value: string): void {
  localStorage.setItem(key, value);
  // Also persist to SQLite (fire-and-forget)
  if (CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number])) {
    setConfig(key, value).catch(() => {});
  } else if (DOCUMENT_KEYS.includes(key as typeof DOCUMENT_KEYS[number])) {
    setDocument(key, value).catch(() => {});
  }
}

export function removeItem(key: string): void {
  localStorage.removeItem(key);
  if (CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number])) {
    deleteConfig(key).catch(() => {});
  } else if (DOCUMENT_KEYS.includes(key as typeof DOCUMENT_KEYS[number])) {
    deleteDocument(key).catch(() => {});
  }
}

// ─── Convenience: typed helpers for specific keys ─────────────────

export function getJson<T = unknown>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown): void {
  setItem(key, JSON.stringify(value));
}
