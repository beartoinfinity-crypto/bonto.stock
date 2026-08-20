# 02 — Store dates as ISO (YYYY-MM-DD)

**What to build:** Database stores dates in ISO format (`YYYY-MM-DD`). Sorting becomes simple `ORDER BY date DESC` without `substr()` gymnastics. Scraper parsers convert dates at ingest. Existing rows migrated in a one-time script.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] DB schema stores `YYYY-MM-DD` in the `date` column
- [ ] `parseLotteryExtreme` converts `DD/MM/YYYY` → `YYYY-MM-DD`
- [ ] `parseLotteryHk` converts `DD/MM/YYYY` → `YYYY-MM-DD`
- [ ] `parseGitHubData` converts `YYYY-MM-DD` (already ISO, just verify)
- [ ] Sort queries use `ORDER BY date DESC` instead of `substr()` manipulation
- [ ] One-time migration converts existing `DD/MM/YYYY` rows to ISO
- [ ] `toResponse` converts ISO back to `YYYY-MM-DD+08:00` for API output
