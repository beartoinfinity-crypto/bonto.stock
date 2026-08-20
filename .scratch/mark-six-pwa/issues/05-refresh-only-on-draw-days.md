# 05 — Client refreshes only on draw days (Tue/Thu/Sat)

**What to build:** Client checks day-of-week before auto-refreshing at midnight. Skips Mon/Wed/Fri/Sun. Manual refresh button still works any time.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `scheduleMidnightRefresh` checks day-of-week before triggering refresh
- [ ] Refresh fires only on Tue (2), Thu (4), Sat (6)
- [ ] Mon/Wed/Fri/Sun midnights skip the refresh
- [ ] Manual refresh button works regardless of day
- [ ] If app is opened on a non-draw day, no auto-refresh until next draw day
