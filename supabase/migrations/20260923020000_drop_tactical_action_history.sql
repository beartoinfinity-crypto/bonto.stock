-- The nightly compute-tactical-history edge fn and pg_cron job were removed
-- (2ebc4a0, 2026-09-08). The UI now replays fully in-browser; this table is orphaned.
DROP TABLE IF EXISTS public.tactical_action_history;
