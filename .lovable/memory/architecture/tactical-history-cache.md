---
name: Tactical action history cache
description: Backend precompute + cache for the Tactical Engine after-close session action history, refreshed nightly by cron
type: feature
---
The Tactical Engine "收市後行動紀錄 / Session action history" is precomputed server-side, not on every visit.

- `tactical_action_history` table: one row per (symbol, lookback) with the full `ReplayResult` payload, `last_bar_date` and `computed_at`. Public read, service_role write, no deletes.
- `compute-tactical-history` edge function: ports `src/lib/tacticalEngine.ts` into `engine.ts` (duplicate of the client engine — keep both in sync when the engine changes). POST `{symbol}` recomputes one ticker; empty body / `{all:true}` walks the screener universe.
- Cached lookbacks: 10, 30, 60, 120 sessions, computed with `DEFAULT_PARAMS`.
- pg_cron job `tactical-action-history-after-close` runs weekdays 21:45 UTC (~15 min after US close).
- `useTacticalHistory` reads the cache when params equal `DEFAULT_PARAMS`; custom params or an uncached symbol fall back to an in-browser replay, and an uncached symbol also triggers a one-time warm call to the function.
