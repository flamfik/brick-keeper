# Technical architecture

## Design goals

Brick Keeper uses a Tauri 2 desktop shell backed by SQLite. The shared frontend
still uses HTML, CSS and ES modules, while durable storage and reference lookup
are exposed through narrow Tauri commands. A browser build served by WAMP can
optionally store the active inventory in MySQL/MariaDB through a local PHP API.

## Runtime flow

1. `index.html` loads `js/app.js` as an ES module.
2. The app selects a saved language or defaults to English.
3. In Tauri, Rust opens `brick-keeper.sqlite3`, applies the schema and imports
   bundled CSV seed files when the reference version changes.
4. `sql-storage.js` loads colors, inventory, part lookup, set lookup, set parts
   and catalog photos through SQLite commands.
5. Outside Tauri, `mysql-storage.js` probes the local WAMP PHP API and uses
   MySQL/MariaDB when it is configured and reachable.
6. If SQL inventory is empty, the app can still migrate data from JSON/local
   fallback.
7. Otherwise `storage.js` checks the fallback copy in `localStorage`.
8. If no fallback exists, `data/bricks.json` is fetched and persisted into SQL.
9. The UI is rendered from the in-memory `state` object.
10. Mutations update the local fallback and are queued for ordered SQL writes.
11. The app requests persistent storage where the browser supports it.
12. A service worker caches the versioned application shell for offline use.
13. A waiting service worker is activated only from the in-app update prompt.

## Modules

### `js/app.js`

Owns UI state, event binding and rendering. Inventory cards use one HTML
`template`; events from every card are handled by one listener on the grid.
This prevents listener count from growing with the collection.

### `js/storage.js`

Defines the portable import/export boundary. JSON data is stored in a versioned
envelope:

```json
{
  "schemaVersion": 2,
  "appVersion": "1.0b",
  "updatedAt": "2026-06-10T12:00:00.000Z",
  "items": []
}
```

All inputs pass through `migrateInventory()` before current-schema validation.
The migration chain accepts schema version 1, unversioned envelopes and early
array-only exports. New schema changes must add the next explicit migration
before increasing `CURRENT_SCHEMA_VERSION`.

### `js/file-storage.js`

Provides one interface for two storage backends. In a compatible browser it
wraps the File System Access API and stores the user-approved handle in
IndexedDB. In Tauri it invokes narrow Rust commands responsible for restoring,
choosing, validating, reading and writing the selected JSON file. File writes
are serialized in `app.js` so rapid quantity changes cannot race and overwrite
newer data with an older snapshot.

### `js/sql-storage.js`

Wraps the Tauri SQLite commands: database status, inventory loading and
replacement, color loading, part-number search, set search, required set parts
and catalog-photo lookup. The frontend saves inventory changes to SQLite
whenever the Tauri bridge is present.

### `js/mysql-storage.js`

Wraps the optional WAMP/PHP API used by the browser build. The browser never
opens a direct MySQL connection. It calls `api/database.php` for configuration
and schema initialization, then `api/inventory.php` for inventory load/replace
operations. This mode is ignored in Tauri, where SQLite remains the native
stand-alone backend.

### `src-tauri/`

Contains the Tauri 2 application shell. `src/database.rs` opens
`brick-keeper.sqlite3`, applies `src-tauri/sql/schema.sql`, imports bundled CSV
seed files into reference tables and exposes narrow SQL commands. Legacy JSON
file commands remain for migration and import/export workflows. The frontend is
copied to `dist/` before release builds, and `withGlobalTauri` provides the small
`window.__TAURI__.core.invoke` bridge without adding a frontend bundler.

The service worker is disabled inside Tauri because the desktop bundle already
ships the application shell locally. The same frontend remains a normal PWA
when served over HTTP.

### `api/`

Contains the optional PHP bridge for WAMP. `database.php` accepts status checks
from private LAN clients, but configuration requests remain localhost-only. It
can create the configured MySQL/MariaDB database and applies
`api/schema/mysql.sql`. `inventory.php` loads and replaces the active inventory
inside a transaction and is available to localhost/private LAN clients. Runtime
credentials are written to `api/config/database.local.php`, which is ignored by
Git.

This API is intentionally local-first. It is not an authentication layer and
should not be exposed as a public internet service. LAN devices reach the app
through WAMP/Apache; MySQL itself stays bound to the WAMP computer.

### `js/inventory.js`

Contains pure collection identity and merge rules. Keeping this logic outside
the DOM controller makes legacy color normalization and duplicate behavior
directly testable with Node.js.

### `js/i18n.js`

Contains translation dictionaries and a small dotted-key resolver. Stored
records use stable keys such as `plates` and `red`; translated labels are
computed only when rendering.

### `js/backups.js`

Stores up to twenty pre-change snapshots in a dedicated IndexedDB database.
Undo consumes the newest snapshot, while the backups dialog can restore any
retained version.

### `js/set-catalog.js`

Uses SQLite in Tauri for set search, set inventories and catalog-photo lookup.
The compact CSV set index, sharded inventories and sharded photo files remain
as the static web fallback. Missing quantities are calculated against canonical
part/color keys.

### `js/csv.js`

Provides the small CSV parser/stringifier used by browser modules and Node data
builders. Keeping this local avoids a runtime dependency in the static web
fallback and keeps generated reference seed files readable outside the app.

### `js/scanner.js`

Owns camera lifecycle and `BarcodeDetector` polling. Camera tracks are stopped
whenever the scanner dialog closes.

### PWA updates

The service worker precaches a shell identified by release version. It does not
call `skipWaiting()` during installation. When a replacement reaches the
waiting state, `app.js` displays the localized update banner. The worker is
activated only after receiving the `SKIP_WAITING` message, then
`controllerchange` reloads the page once.

### `data/catalog/*.csv`

Generated part metadata used as the seed source for SQL imports and as the web
fallback. Files are grouped by the first normalized character of `part_num`. In
the static web build, a lookup for `3001` requests `data/catalog/3.csv`.

Set inventories use 10,000-ID groups, and photo references use the first
normalized part-number character. This keeps the seed/fallback file count small
without adding a browser runtime dependency.

### `data/colors.csv`

Compact records generated from `BrickKeeper_DB/colors.csv`. Each record stores
the stable color ID, official name, RGB value, transparency flag and popularity
count. Tauri imports these records into SQLite; the static web build reads the
CSV directly. The UI resolves legacy color keys to these IDs at runtime.

## Item schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable unique identifier |
| `name` | string | yes | Human-readable part name |
| `partNumber` | string | yes | Manufacturer/catalog number |
| `category` | string | yes | Key listed in `CATEGORY_KEYS` |
| `color` | string | yes | Stable ID from `data/colors.csv` or a supported legacy key |
| `quantity` | integer | yes | Number greater than or equal to zero |
| `location` | string | no | Physical storage location |
| `year` | integer/null | no | Release or production year |
| `notes` | string | no | Free-form note |
| `image` | data URL/null | no | Locally compressed WebP part photo |
| `catalogImage` | HTTPS URL/null | no | Read-only reference catalog photo |
| `catalog` | object/null | no | Source category and material from the reference catalog |
| `createdAt` | ISO date | recommended | Used by recent-first sorting |
| `updatedAt` | ISO date | recommended | Last edit timestamp |

## Adding a language

1. Add its code to `SUPPORTED_LANGUAGES` in `js/app.js`.
2. Add a complete dictionary in `js/i18n.js`.
3. Add an option to `#language-select` in `index.html`.
4. Test static labels, filters, form labels, notifications and result counts.

English is the default for a new browser profile. A previously selected
language remains stored in `localStorage`.

## Adding categories or colors

Categories are controlled by `CATEGORY_KEYS` in `js/app.js`. Colors are rebuilt
from `colors.csv`; only the common legacy names have localized labels, while
the remaining catalog entries display their official source names.

## Duplicate identity

Two records are duplicates when their trimmed, case-insensitive part numbers
and canonical color IDs match. Saving a duplicate adds its quantity to the
existing record. Editing one record into another duplicate removes the edited
record and merges it into the existing target.

## Security model

- user-provided text is assigned with `textContent`, not `innerHTML`;
- imported JSON is parsed and structurally validated;
- the MySQL/PHP configurator is restricted to localhost requests;
- the MySQL/PHP inventory API is limited to localhost and private LAN clients;
- database passwords are stored only in ignored local PHP config;
- uploaded images are decoded and resized locally; they are never sent to a server;
- the application has no authentication or analytics;
- only catalog and set images are requested from Rebrickable's CDN;
- fallback data and remembered file handles are scoped to the browser origin;
- direct writes are limited to a file explicitly selected by the user;
- the Tauri frontend does not receive a general-purpose filesystem API;
- export requires an explicit user action.

## Automated validation

GitHub Actions runs syntax checks, pure inventory tests, schema migration tests,
file-adapter tests, SQL-adapter tests, MySQL-adapter tests, full CSV/JSON
parsing and record-count checks for generated catalogs. A Playwright smoke test then loads the English interface in Chromium,
opens the visible suggestions for `300`, selects part `3001` and verifies set
`75192`.

The only `innerHTML` assignment is for trusted, developer-owned translation
strings containing the hero line break.

## Performance considerations

Rendering uses fixed-size windows of detached card nodes. An
`IntersectionObserver` appends the next window near the end of the grid, which
keeps initial DOM, layout and paint work bounded for large collections.

For collections beyond several thousand visible records:

1. debounce search input with a short delay;
2. virtualize off-screen cards;
3. move filtering to a Web Worker only if profiling proves it necessary;
4. consider IndexedDB if records or attachments outgrow `localStorage`.

Photos currently remain as data URLs in the SQLite `inventory_items.image`
column and in exported JSON to preserve simple import/export. If image-heavy
collections become a primary use case, moving binary images to separate files or
SQLite BLOBs while keeping metadata in rows is the correct next storage
migration for Tauri.

The remaining measures are intentionally deferred until profiling shows that
they improve real collections enough to justify their additional complexity.
