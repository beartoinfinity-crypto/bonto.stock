# 03 — Simplify refresh to append-only

**What to build:** `POST /api/marksix/refresh` scrapes only the latest draw from lotteryextreme.com, compares to the highest draw number in the DB, and inserts if new. The lottery.hk year-loop and GitHub bulk-load are removed from the refresh path. A separate `POST /api/marksix/backfill` endpoint handles one-time historical import.

**Blocked by:** 01 (GET reads), 02 (ISO dates)

**Status:** ready-for-agent

- [ ] Refresh scrapes lotteryextreme for latest draw only
- [ ] Compares scraped draw number to DB max — inserts only if newer
- [ ] lottery.hk year-loop removed from refresh (moved to backfill)
- [ ] GitHub bulk-load removed from refresh (moved to backfill or startup only)
- [ ] `POST /api/marksix/backfill` endpoint added for one-time historical import
- [ ] Client refresh button calls the simplified refresh endpoint
