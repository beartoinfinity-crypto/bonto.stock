# 0001 — SQLite for shared draw storage

The PWA needed persistent storage shared across multiple clients. A JSON file caused race conditions and full-file rewrites on every refresh. SQLite with WAL mode provides atomic upserts, concurrent reads, and append-only semantics — new draws are inserted without touching existing rows. The database grows linearly with draw count (one row per draw) and queries are simple SQL with no application-level sorting needed when using ISO dates.

## Considered Options

- **JSON file** (original): Simple but causes full-file rewrites, race conditions between concurrent clients, and no query capability without loading the entire file.
- **SQLite**: Atomic upserts, concurrent reads via WAL, SQL queries for year/range filtering, append-only by nature.
- **Server-side API only** (no local DB): Would require the upstream API to be always available, which it isn't (HKJC is IP-whitelisted).

## Consequences

- All clients share one `data/marksix.db` file
- History only grows — no data is ever deleted
- Scraper parsers convert dates to ISO at ingest; API converts back to `+08:00` format for responses
