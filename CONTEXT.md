# Mark Six PWA

A PWA that displays Hong Kong Mark Six lottery results, refreshes daily, and stores historical data in SQLite.

## Language

**Draw**:
A single lottery event identified by a year/sequence number (e.g. `26/089`). The primary key in the database.
_Avoid_: Lottery, event, round

**Draw number**:
The sequence identifier within a year (e.g. `26/089` means draw 89 of 2026). Stored as `draw` in the DB.
_Avoid_: ID, number

**Numbers**:
The six main balls drawn in a draw. Stored as a JSON array of integers.
_Avoid_: Main numbers, balls, drawn numbers

**Special number**:
The single bonus ball drawn after the six main numbers. Displayed with a `+` prefix.
_Avoid_: Bonus, extra, supplemental

**Refresh**:
Scraping the latest draw from an external source and appending it to the database if newer than what's stored.
_Avoid_: Update, sync, fetch

**Backfill**:
A one-time historical import of draws from an external source to populate the database.
_Avoid_: Import, bulk load, migration

**Scrape**:
Extracting draw data from an external website's HTML or JSON.
_Avoid_: Crawl, parse, fetch (use "scrape" for the full action, "parse" for the HTML→object step)

**Draw day**:
A day when Mark Six draws occur: Tuesday, Thursday, Saturday.
_Avoid_: Lottery day, event day
