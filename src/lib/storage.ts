/**
 * storage.ts — unified read/write layer
 *
 * HIERARCHY (cloud-first):
 *   1. Supabase  — PRIMARY store. Source of truth. Written first (debounced 3 s).
 *   2. SQLite    — LOCAL BACKUP / ARCHIVE. Written second (fire-and-forget).
 *                  The .db file (File System Access) or IndexedDB copy is the
 *                  offline archive of everything.
 *   3. localStorage — sync read cache only. Instant reads, zero latency.
 *
 * On boot, App.tsx hydrates localStorage/SQLite FROM Supabase (pullAll),
 * so the cloud always wins as source of truth when sync is enabled.
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
  // 0. Sync read cache (always)
  localStorage.setItem(key, value);

  const isConfig = CONFIG_KEYS.includes(key as typeof CONFIG_KEYS[number]);
  const isDocument = DOCUMENT_KEYS.includes(key as typeof DOCUMENT_KEYS[number]);
  if (!isConfig && !isDocument) return;

  // 1. PRIMARY: Supabase cloud (debounced, fire-and-forget)
  maybeSyncToSupabase(key);

  // 2. BACKUP: local SQLite archive (fire-and-forget)
  if (isConfig) {
    setConfig(key, value).catch(() => {});
  } else {
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
