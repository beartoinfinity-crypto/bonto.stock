# 01 — Switch reads from POST to GET

**What to build:** All read-only API endpoints (`/api/marksix`, `/api/marksix/history`) use GET with query parameters instead of POST with JSON body. Cacheable, bookmarkable, standard REST.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `GET /api/marksix?lastNDraw=N` replaces `POST /api/marksix` with JSON body
- [ ] `GET /api/marksix/history?year=&from=&to=&limit=` replaces `POST /api/marksix/history`
- [ ] `POST /api/marksix/refresh` remains POST (it triggers a write)
- [ ] Client updated to use GET with query params
- [ ] Old POST endpoints removed
