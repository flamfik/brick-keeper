# Technical architecture

## Design goals

Brick Keeper is designed for static hosting, low startup cost and simple
community contributions. It uses browser standards only: HTML, CSS, ES modules,
the Dialog API, File System Access API, IndexedDB, `localStorage`, Blob
downloads and File input.

## Runtime flow

1. `index.html` loads `js/app.js` as an ES module.
2. The app selects a language from saved preferences or the browser locale.
3. `file-storage.js` restores a previously selected JSON file handle.
4. If file permission is active, the JSON file becomes the primary data source.
5. Otherwise `storage.js` checks the fallback copy in `localStorage`.
6. If no fallback exists, `data/bricks.json` is fetched and persisted.
7. The UI is rendered from the in-memory `state` object.
8. Mutations update the local fallback and are queued for ordered file writes.

## Modules

### `js/app.js`

Owns UI state, event binding and rendering. Inventory cards use one HTML
`template`; events from every card are handled by one listener on the grid.
This prevents listener count from growing with the collection.

### `js/storage.js`

Defines the persistence boundary. Data is stored in a versioned envelope:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-10T12:00:00.000Z",
  "items": []
}
```

The same validator is used for starter data and imported files. Future schema
changes should add a migration before increasing `schemaVersion`.

### `js/file-storage.js`

Wraps the File System Access API and stores the user-approved file handle in
IndexedDB. The app never receives access to other files or directories. File
writes are serialized in `app.js` so rapid quantity changes cannot race and
overwrite newer data with an older snapshot.

### `js/i18n.js`

Contains translation dictionaries and a small dotted-key resolver. Stored
records use stable keys such as `plates` and `red`; translated labels are
computed only when rendering.

### `data/catalog/*.json`

Read-only part metadata generated from the CSV database. Files are sharded by
the first three normalized characters of `part_num`. A lookup for `3001`, for
example, requests only `data/catalog/300.json`.

## Item schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable unique identifier |
| `name` | string | yes | Human-readable part name |
| `partNumber` | string | yes | Manufacturer/catalog number |
| `category` | string | yes | Key listed in `CATEGORY_KEYS` |
| `color` | string | yes | Key listed in `COLOR_MAP` |
| `quantity` | integer | yes | Number greater than or equal to zero |
| `location` | string | no | Physical storage location |
| `year` | integer/null | no | Release or production year |
| `notes` | string | no | Free-form note |
| `image` | data URL/null | no | Locally compressed WebP part photo |
| `catalog` | object/null | no | Source category and material from the reference catalog |
| `createdAt` | ISO date | recommended | Used by recent-first sorting |
| `updatedAt` | ISO date | recommended | Last edit timestamp |

## Adding a language

1. Add its code to `SUPPORTED_LANGUAGES` in `js/app.js`.
2. Add a complete dictionary in `js/i18n.js`.
3. Add an option to `#language-select` in `index.html`.
4. Test static labels, filters, form labels, notifications and result counts.

## Adding categories or colors

Categories are controlled by `CATEGORY_KEYS`; colors are controlled by
`COLOR_MAP`, both in `js/app.js`. Every new key needs a label in each language
dictionary.

## Security model

- user-provided text is assigned with `textContent`, not `innerHTML`;
- imported JSON is parsed and structurally validated;
- uploaded images are decoded and resized locally; they are never sent to a server;
- the application has no authentication, analytics or third-party requests;
- fallback data and remembered file handles are scoped to the browser origin;
- direct writes are limited to a file explicitly selected by the user;
- export requires an explicit user action.

The only `innerHTML` assignment is for trusted, developer-owned translation
strings containing the hero line break.

## Performance considerations

Rendering is intentionally direct. A filtered list is transformed into detached
card nodes, then attached with `replaceChildren()`. This minimizes layout
invalidations and keeps behavior easy to profile.

For collections beyond several thousand visible records:

1. debounce search input with a short delay;
2. virtualize off-screen cards;
3. move filtering to a Web Worker only if profiling proves it necessary;
4. consider IndexedDB if records or attachments outgrow `localStorage`.

Photos currently remain in JSON as data URLs to preserve simple import/export
and static hosting. If image-heavy collections become a primary use case,
moving binary images to IndexedDB while keeping metadata in JSON is the correct
next storage migration.

These measures are not included prematurely because they add code and failure
modes without improving normal collection sizes.
