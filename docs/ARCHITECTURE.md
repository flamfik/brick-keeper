# Technical architecture

## Design goals

Brick Keeper is designed for static hosting, low startup cost and simple
community contributions. It uses browser standards only: HTML, CSS, ES modules,
the Dialog API, File System Access API, IndexedDB, `localStorage`, Blob
downloads and File input.

## Runtime flow

1. `index.html` loads `js/app.js` as an ES module.
2. The app selects a saved language or defaults to English.
3. `file-storage.js` restores a previously selected JSON file handle.
4. If file permission is active, the JSON file becomes the primary data source.
5. Otherwise `storage.js` checks the fallback copy in `localStorage`.
6. If no fallback exists, `data/bricks.json` is fetched and persisted.
7. The UI is rendered from the in-memory `state` object.
8. Mutations update the local fallback and are queued for ordered file writes.
9. The app requests persistent storage where the browser supports it.
10. A service worker caches the versioned application shell for offline use.
11. A waiting service worker is activated only from the in-app update prompt.

## Modules

### `js/app.js`

Owns UI state, event binding and rendering. Inventory cards use one HTML
`template`; events from every card are handled by one listener on the grid.
This prevents listener count from growing with the collection.

### `js/storage.js`

Defines the persistence boundary. Data is stored in a versioned envelope:

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

Wraps the File System Access API and stores the user-approved file handle in
IndexedDB. The app never receives access to other files or directories. File
writes are serialized in `app.js` so rapid quantity changes cannot race and
overwrite newer data with an older snapshot.

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

Loads the compact set index, sharded inventories and sharded catalog-photo
lookup. Missing quantities are calculated against canonical part/color keys.

### `js/scanner.js`

Owns camera lifecycle and `BarcodeDetector` polling. Camera tracks are stopped
whenever the scanner dialog closes.

### PWA updates

The service worker precaches a shell identified by release version. It does not
call `skipWaiting()` during installation. When a replacement reaches the
waiting state, `app.js` displays the localized update banner. The worker is
activated only after receiving the `SKIP_WAITING` message, then
`controllerchange` reloads the page once.

### `data/catalog/*.json`

Read-only part metadata generated from the CSV database. Files are grouped by
the first normalized character of `part_num`. A lookup for `3001`, for example,
requests `data/catalog/3.json`.

Set inventories use 10,000-ID groups, and photo references use the first
normalized part-number character. This reduces the reference database from
2,273 files to 76 grouped files plus the set index, without a runtime dependency.

### `data/colors.json`

Compact records generated from `BrickKeeper_DB/colors.csv`. Each record stores
the stable color ID, official name, RGB value, transparency flag and popularity
count. The UI resolves legacy color keys to these IDs at runtime.

## Item schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable unique identifier |
| `name` | string | yes | Human-readable part name |
| `partNumber` | string | yes | Manufacturer/catalog number |
| `category` | string | yes | Key listed in `CATEGORY_KEYS` |
| `color` | string | yes | Stable ID from `data/colors.json` or a supported legacy key |
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
- uploaded images are decoded and resized locally; they are never sent to a server;
- the application has no authentication or analytics;
- only catalog and set images are requested from Rebrickable's CDN;
- fallback data and remembered file handles are scoped to the browser origin;
- direct writes are limited to a file explicitly selected by the user;
- export requires an explicit user action.

## Automated validation

GitHub Actions runs syntax checks, pure inventory tests, schema migration tests,
full JSON parsing and record-count checks for generated catalogs. A Playwright
smoke test then loads the English interface in Chromium, searches part `3001`
and verifies set `75192`.

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

Photos currently remain in JSON as data URLs to preserve simple import/export
and static hosting. If image-heavy collections become a primary use case,
moving binary images to IndexedDB while keeping metadata in JSON is the correct
next storage migration.

The remaining measures are intentionally deferred until profiling shows that
they improve real collections enough to justify their additional complexity.
