# 04 — Drop unused fields from API response

**What to build:** API response shape simplified to `{ id, drawDate, drawResult: { drawnNo, xDrawnNo } }`. Removes `year`, `no`, and `status` fields that the client does not use.

**Blocked by:** 01 (GET reads)

**Status:** ready-for-agent

- [ ] `toResponse` drops `year` field
- [ ] `toResponse` drops `no` field
- [ ] `toResponse` drops `status` field
- [ ] Client verified to not depend on any dropped fields
- [ ] Response contract documented in README
