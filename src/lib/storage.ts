/**
 * storage.ts — unified read/write layer
 *
 * Every write goes to localStorage (fast, sync, backward compat),
 * SQLite (via localDb, for .db file export), and — if enabled —
 * Supabase cloud (via supabaseDb, debounced 3 s).
 *
 * Reads come from localStorage (synchronous, zero latency).
 * On first load, localDb.ts migrates existing localStorage → SQLite.
 */

import { getConfig, setConfig, deleteConfig, getDocument, setDocument, deleteDocument } from './localDb';
import { CONFIG_KEYS, DOCUMENT_KEYS } from './syncKeys';
import { maybeSyncToSupabase } from './supabaseDb';

export { CONFIG_KEYS, DOCUMENT_KEYS };

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
  // And to Supabase cloud if configured + enabled (debounced, fire-and-forget)
  maybeSyncToSupabase(key);
}

export function removeItem(key: string): void {
  localStorage.removeItem(key);
  if (CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number])) {
    deleteConfig(key).catch(() => {});
  } else if (DOCUMENT_KEYS.includes(key as typeof DOCUMENT_KEYS[number])) {
    deleteDocument(key).catch(() => {});
  }
  // Cloud tombstone: overwrite with empty value (KV design — no deletes)
  maybeSyncToSupabase(key);
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
